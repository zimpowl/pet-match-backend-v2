import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  CONTESTS,
  COUNTERS,
  JUDGES,
  PARTICIPANTS,
  PETS,
  SEQUENCES,
  USERS,
  VOTES,
  db,
} from "../firebase";
import { CONTEST_DAYS, DAY_MILLIS } from "../core/allocation";
import { computeMaxVotesPerJudge, computeVotesPerDay } from "../core/cap";
import { DEFAULT_K_FACTOR } from "../core/elo";
import { compareJudges, compareParticipants, rank as ranked } from "../core/ranking";
import { CountedVote, judgeResults, medalFromRank } from "../core/results";
import { toMillisOrZero } from "../core/time";
import { StatsDoc } from "../models/user";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
  ContestVoteDoc,
} from "../models/contest";
import { JsonResponse, forbidden, respond } from "../http/respond";
import {
  ClosingNews,
  EveningNews,
  composeClosing,
  composeEvening,
  resolveLocale,
} from "../core/notifications";
import { Delivery, DeliveryReport, deliver, loadRecipients } from "../data/notify";

/**
 * 18 h est la seule horloge du jeu (§4.2 bis). Un concours démarre à 18 h, il
 * se termine à 18 h, et chaque soir à 18 h il se passe quelque chose. Un seul
 * job pour tous les concours, sept exécutions par cycle.
 *
 * Ce job est le **seul écrivain** des instantanés — `rank`, `rankPrevious`,
 * `eloSnapshot`, `votesReceivedSnapshot`, `votesSnapshot`, `snapshotAt`. Les
 * endpoints d'écriture ne touchent jamais ces champs, et rien ne recalcule un
 * rang à la lecture : le champ `rank` *est* l'instantané (D54).
 *
 * Le 7ᵉ soir n'est pas un instantané, c'est la clôture : ELO révélés, justesse
 * calculée, médailles, agrégats. Le rythme d'un cycle est donc six instantanés
 * puis un dénouement.
 */

const BATCH_SIZE = 400;
/** Le concours suivant est ouvert une semaine à l'avance (D88). */
const NEXT_CONTEST_LEAD = CONTEST_DAYS * DAY_MILLIS;

export interface CycleReport {
  activated: string[];
  snapshotted: string[];
  closed: string[];
  created: string[];
  warnings: string[];
  notifications: DeliveryReport;
}

/**
 * Ce qu'il y a à annoncer, accumulé pendant que le cycle écrit. Un joueur ne
 * reçoit qu'**une** notification par concours et par soir, même s'il est à la
 * fois participant et juré : la clé de cette carte est son uid.
 */
interface Announcements {
  readonly evening: Map<string, EveningNews>;
  readonly closing: Map<string, ClosingNews>;
  readonly contestUidByUser: Map<string, string>;
}

interface Batcher {
  set(ref: FirebaseFirestore.DocumentReference, data: unknown, merge: boolean): void;
  flush(): Promise<void>;
}

function batcher(): Batcher {
  const pending: { ref: FirebaseFirestore.DocumentReference; data: unknown; merge: boolean }[] = [];
  return {
    set(ref, data, merge) {
      pending.push({ ref, data, merge });
    },
    async flush() {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const item of pending.slice(i, i + BATCH_SIZE)) {
          batch.set(item.ref, item.data as FirebaseFirestore.DocumentData, {
            merge: item.merge,
          });
        }
        await batch.commit();
      }
    },
  };
}

/**
 * Le cœur du cycle. Écrit tout en lots, puis renvoie ce qu'il a fait — c'est ce
 * rapport que la notification consommera, hors de la boucle du batch (§7).
 */
export async function runCycle(nowMillis: number): Promise<CycleReport> {
  const report: CycleReport = {
    activated: [],
    snapshotted: [],
    closed: [],
    created: [],
    warnings: [],
    notifications: { sent: 0, failed: 0, withoutToken: 0, tokensCleared: 0 },
  };
  const writes = batcher();
  const news: Announcements = {
    evening: new Map(),
    closing: new Map(),
    contestUidByUser: new Map(),
  };

  const contests = await db
    .collection(CONTESTS)
    .where("status", "in", ["DRAFT", "ACTIVE"])
    .get();

  let newestNumber = 0;
  for (const doc of contests.docs) {
    newestNumber = Math.max(newestNumber, (doc.data() as ContestDoc).number ?? 0);
  }

  for (const doc of contests.docs) {
    const contest = doc.data() as ContestDoc;
    const startAt = toMillisOrZero(contest.startAt);
    const endAt = toMillisOrZero(contest.endAt);

    if (contest.status === "DRAFT") {
      if (startAt > nowMillis) continue;
      await activate(doc.ref, writes, report);
      continue;
    }

    if (endAt <= nowMillis) {
      await close(doc.ref, contest, writes, report, news);
      continue;
    }

    // Un concours qui n'a pas encore vu son premier 18 h n'a rien à figer.
    if (nowMillis < startAt + DAY_MILLIS) continue;
    await snapshot(doc.ref, contest, startAt, nowMillis, writes, report, news);
  }

  await writes.flush();

  // Les notifications sont envoyées **après** l'écriture, hors de la boucle du
  // batch (§7) : un échec d'envoi ne doit jamais défaire un classement.
  report.notifications = await announce(news);

  // L'ouverture du brouillon suivant se fait après le reste : elle a besoin du
  // numéro de séquence, et elle ne doit pas être rejouée si le lot a échoué.
  const active = await db.collection(CONTESTS).where("status", "==", "ACTIVE").get();
  const draft = await db.collection(CONTESTS).where("status", "==", "DRAFT").limit(1).get();
  if (!active.empty && draft.empty) {
    const created = await openNextDraft(active.docs[0], nowMillis, report);
    if (created) report.created.push(created);
  }

  return report;
}

/**
 * Activation : le plafond et l'allocation sont **figés ici** sur le nombre de
 * participants réel (§4.3, D41), et plus jamais recalculés — une slab doit
 * pouvoir dire sous quelles règles elle a été jouée.
 */
async function activate(
  ref: FirebaseFirestore.DocumentReference,
  writes: Batcher,
  report: CycleReport,
): Promise<void> {
  const participants = await ref.collection(PARTICIPANTS).count().get();
  const count = participants.data().count;

  writes.set(
    ref,
    {
      "status": "ACTIVE",
      "maxVotesPerJudge": computeMaxVotesPerJudge(count),
      "maxVotesPerDay": computeVotesPerDay(count),
      "counts.participants": count,
    },
    true,
  );
  report.activated.push(ref.id);

  if (count < 2) {
    report.warnings.push(`${ref.id} activé avec ${count} participant(s) : aucun duel possible`);
  }
}

/**
 * L'instantané du soir : on recopie le rang dans `rankPrevious` — c'est lui qui
 * porte l'écart avec la veille, la seule chose qui raconte — puis on recalcule,
 * et on gèle ELO et votes reçus.
 *
 * Le classement des jurés utilise le même comparateur qu'à la clôture. Avant
 * celle-ci `correctVotes` vaut zéro pour tout le monde, donc il dégénère
 * naturellement en « jurés les plus actifs », sur les votes posés (D11).
 */
async function snapshot(
  ref: FirebaseFirestore.DocumentReference,
  contest: ContestDoc,
  startAt: number,
  nowMillis: number,
  writes: Batcher,
  report: CycleReport,
  news: Announcements,
): Promise<void> {
  const [participants, judges] = await Promise.all([
    ref.collection(PARTICIPANTS).get(),
    ref.collection(JUDGES).get(),
  ]);

  const rankedPets = rankParticipants(ref, participants.docs, writes, true);
  const rankedJudges = rankJudges(ref, judges.docs, new Map(), writes, true);

  // Le jour affiché est le nombre de journées pleines jouées : « jour 3 ».
  const day = Math.max(1, Math.floor((nowMillis - startAt) / DAY_MILLIS));

  for (const row of rankedPets) {
    // Un joueur peut inscrire plusieurs animaux (D89) : on annonce le mieux
    // classé, c'est la nouvelle qui compte pour lui.
    const current = news.evening.get(row.ownerUid);
    if (current?.pet && (current.pet.rank ?? Infinity) <= row.rank) continue;
    news.evening.set(row.ownerUid, {
      day,
      pet: {
        name: row.petName,
        rank: row.rank,
        rankPrevious: row.rankPrevious,
        total: rankedPets.length,
      },
      judge: current?.judge ?? null,
    });
    news.contestUidByUser.set(row.ownerUid, ref.id);
  }

  for (const row of rankedJudges) {
    const current = news.evening.get(row.userUid);
    news.evening.set(row.userUid, {
      day,
      pet: current?.pet ?? null,
      judge: {
        rank: row.rank,
        rankPrevious: row.rankPrevious,
        total: rankedJudges.length,
        dailyCapacity: contest.maxVotesPerDay,
      },
    });
    news.contestUidByUser.set(row.userUid, ref.id);
  }

  writes.set(ref, { snapshotAt: Timestamp.fromMillis(nowMillis) }, true);
  report.snapshotted.push(ref.id);
}

/**
 * La clôture. C'est ici, et nulle part ailleurs, que la justesse d'un vote se
 * décide : l'animal choisi finit-il avec un ELO final strictement supérieur à
 * son adversaire de ce duel (§2.1) ?
 */
async function close(
  ref: FirebaseFirestore.DocumentReference,
  contest: ContestDoc,
  writes: Batcher,
  report: CycleReport,
  news: Announcements,
): Promise<void> {
  const [participants, judges, votes] = await Promise.all([
    ref.collection(PARTICIPANTS).get(),
    ref.collection(JUDGES).get(),
    ref.collection(VOTES).get(),
  ]);

  const eloByPetId = new Map<string, number>();
  for (const doc of participants.docs) {
    eloByPetId.set(doc.id, (doc.data() as ContestParticipantDoc).elo);
  }

  const counted: CountedVote[] = votes.docs.map((doc) => {
    const vote = doc.data() as ContestVoteDoc;
    return {
      judgeUserUid: vote.judgeUserUid,
      pickedPetId: vote.pickedPetId,
      aPetId: vote.aPetId,
      bPetId: vote.bPetId,
      expectedPicked: vote.expectedPicked ?? 0,
    };
  });

  const results = judgeResults(counted, eloByPetId);

  const rankedPets = rankParticipants(ref, participants.docs, writes, true);
  const rankedJudges = rankJudges(ref, judges.docs, results, writes, true);
  const participantRanks = new Map(rankedPets.map((row) => [row.petId, row.rank]));
  const judgeRanks = new Map(rankedJudges.map((row) => [row.userUid, row.rank]));

  for (const row of rankedPets) {
    const current = news.closing.get(row.ownerUid);
    if (current?.pet && (current.pet.rank ?? Infinity) <= row.rank) continue;
    news.closing.set(row.ownerUid, {
      pet: { name: row.petName, rank: row.rank, total: rankedPets.length, elo: row.elo },
      judge: current?.judge ?? null,
    });
    news.contestUidByUser.set(row.ownerUid, ref.id);
  }

  for (const row of rankedJudges) {
    const current = news.closing.get(row.userUid);
    news.closing.set(row.userUid, {
      pet: current?.pet ?? null,
      judge: {
        rank: row.rank,
        total: rankedJudges.length,
        votes: row.votes,
        correctVotes: row.correctVotes,
      },
    });
    news.contestUidByUser.set(row.userUid, ref.id);
  }

  // Médailles et agrégats. Un podium est une médaille, et une médaille est une
  // médaille : or, argent et bronze pèsent pareil pour les compteurs (D55).
  // On relit les docs plutôt que d'incrémenter, parce que `bestRank` est un
  // minimum et qu'aucun `FieldValue` ne sait faire un minimum.
  const petIds = [...participantRanks.keys()];
  const judgeUids = [...judgeRanks.keys()];

  const [petDocs, userDocs] = await Promise.all([
    petIds.length > 0 ? db.getAll(...petIds.map((id) => db.collection(PETS).doc(id))) : [],
    judgeUids.length > 0 ?
      db.getAll(...judgeUids.map((id) => db.collection(USERS).doc(id))) :
      [],
  ]);

  for (const snap of petDocs) {
    const rankValue = participantRanks.get(snap.id) ?? null;
    writes.set(snap.ref, { stats: nextStats(snap.data()?.stats, rankValue) }, true);
  }

  for (const snap of userDocs) {
    const rankValue = judgeRanks.get(snap.id) ?? null;
    const gained = results.get(snap.id)?.correctVotes ?? 0;
    const totals = (snap.data()?.totals ?? {}) as { votes?: number; correctVotes?: number };
    writes.set(
      snap.ref,
      {
        stats: nextStats(snap.data()?.stats, rankValue),
        totals: { correctVotes: (totals.correctVotes ?? 0) + gained },
      },
      true,
    );
  }

  writes.set(
    ref,
    { status: "CLOSED", snapshotAt: contest.endAt ?? Timestamp.fromMillis(Date.now()) },
    true,
  );
  report.closed.push(ref.id);

  if (votes.empty) {
    report.warnings.push(`${ref.id} clos sans aucun vote : aucun classement de juré`);
  }
}

/**
 * Les agrégats après une clôture. `bestRank` ne peut que s'améliorer, et un
 * palmarès ne perd jamais une médaille : tout ne fait que monter (D30).
 */
function nextStats(current: unknown, rankValue: number | null): StatsDoc {
  const stats = (current ?? {}) as Partial<StatsDoc>;
  const medal = medalFromRank(rankValue);
  const best =
    rankValue === null ?
      stats.bestRank ?? null :
      Math.min(stats.bestRank ?? Number.POSITIVE_INFINITY, rankValue);

  return {
    contests: (stats.contests ?? 0) + 1,
    bestRank: best === null || !Number.isFinite(best) ? null : best,
    gold: (stats.gold ?? 0) + (medal === "gold" ? 1 : 0),
    silver: (stats.silver ?? 0) + (medal === "silver" ? 1 : 0),
    bronze: (stats.bronze ?? 0) + (medal === "bronze" ? 1 : 0),
  };
}

interface RankedPet {
  readonly petId: string;
  readonly ownerUid: string;
  readonly petName: string;
  readonly rank: number;
  readonly rankPrevious: number | null;
  readonly elo: number;
}

function rankParticipants(
  ref: FirebaseFirestore.DocumentReference,
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  writes: Batcher,
  freeze: boolean,
): RankedPet[] {
  const rows = docs.map((doc) => {
    const data = doc.data() as ContestParticipantDoc;
    return {
      petId: doc.id,
      data,
      elo: data.elo,
      wins: data.wins,
      duels: data.duels,
      createdAt: toMillisOrZero(data.createdAt),
    };
  });

  const order = ranked(rows, compareParticipants);
  const result: RankedPet[] = [];

  order.forEach((row, index) => {
    const rankValue = index + 1;
    result.push({
      petId: row.petId,
      ownerUid: row.data.ownerUid,
      petName: row.data.petName,
      rank: rankValue,
      rankPrevious: row.data.rank ?? null,
      elo: row.data.elo,
    });
    writes.set(
      ref.collection(PARTICIPANTS).doc(row.petId),
      {
        rank: rankValue,
        rankPrevious: row.data.rank ?? null,
        ...(freeze ?
          {
            eloSnapshot: row.data.elo,
            votesReceivedSnapshot: row.data.votesReceived,
          } :
          {}),
      },
      true,
    );
  });

  return result;
}

interface RankedJudge {
  readonly userUid: string;
  readonly rank: number;
  readonly rankPrevious: number | null;
  readonly votes: number;
  readonly correctVotes: number;
}

function rankJudges(
  ref: FirebaseFirestore.DocumentReference,
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  results: ReadonlyMap<string, { correctVotes: number; difficultyScore: number }>,
  writes: Batcher,
  freeze: boolean,
): RankedJudge[] {
  const rows = docs.map((doc) => {
    const data = doc.data() as ContestJudgeDoc;
    const result = results.get(doc.id);
    return {
      userUid: doc.id,
      data,
      correctVotes: result?.correctVotes ?? 0,
      votes: data.votes,
      difficultyScore: result?.difficultyScore ?? 0,
      joinedAt: toMillisOrZero(data.joinedAt),
    };
  });

  const order = ranked(rows, compareJudges);
  const result: RankedJudge[] = [];

  order.forEach((row, index) => {
    const rankValue = index + 1;
    result.push({
      userUid: row.userUid,
      rank: rankValue,
      rankPrevious: row.data.rank ?? null,
      votes: row.data.votes,
      correctVotes: row.correctVotes,
    });
    writes.set(
      ref.collection(JUDGES).doc(row.userUid),
      {
        rank: rankValue,
        rankPrevious: row.data.rank ?? null,
        correctVotes: row.correctVotes,
        difficultyScore: row.difficultyScore,
        ...(freeze ? { votesSnapshot: row.data.votes } : {}),
      },
      true,
    );
  });

  return result;
}

/**
 * Le concours suivant, ouvert une semaine à l'avance (D88) : il démarre
 * exactement quand le courant se termine, la chaîne est continue et il n'y a
 * jamais de semaine creuse.
 *
 * Le thème vient d'une file éditoriale, `counters/themes.queue`, qu'on peut
 * remplir à la main sans redéployer. File vide = le concours est créé quand
 * même, avec un thème provisoire signalé dans le rapport : mieux vaut un
 * concours à renommer qu'une semaine sans concours.
 */
async function openNextDraft(
  activeDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined,
  nowMillis: number,
  report: CycleReport,
): Promise<string | null> {
  if (!activeDoc) return null;
  const active = activeDoc.data() as ContestDoc;

  const themesRef = db.collection(COUNTERS).doc("themes");
  const sequencesRef = db.collection(COUNTERS).doc(SEQUENCES);

  const created = await db.runTransaction(async (t) => {
    const [themesSnap, sequencesSnap] = await t.getAll(themesRef, sequencesRef);
    const queue = (themesSnap.data()?.queue as string[] | undefined) ?? [];
    const [theme, ...rest] = queue;
    const number = ((sequencesSnap.data()?.contests as number | undefined) ?? 0) + 1;

    const startAt = toMillisOrZero(active.endAt);
    const ref = db.collection(CONTESTS).doc();
    const draft: ContestDoc = {
      theme: theme ?? `Concours n° ${number}`,
      number,
      status: "DRAFT",
      createdAt: Timestamp.fromMillis(nowMillis),
      startAt: Timestamp.fromMillis(startAt),
      endAt: Timestamp.fromMillis(startAt + NEXT_CONTEST_LEAD),
      // Figés à l'activation, pas ici : on ne connaît pas encore l'effectif.
      maxVotesPerJudge: 0,
      maxVotesPerDay: 0,
      eloKFactor: active.eloKFactor || DEFAULT_K_FACTOR,
      counts: { participants: 0, judges: 0 },
      snapshotAt: null,
    };

    t.set(ref, draft);
    t.set(sequencesRef, { contests: number }, { merge: true });
    t.set(themesRef, { queue: rest }, { merge: true });

    if (theme === undefined) {
      report.warnings.push(
        `file de thèmes vide : ${ref.id} ouvert avec « ${draft.theme} », à renommer`,
      );
    }
    return ref.id;
  });

  return created;
}

/**
 * L'annonce. La clôture prime sur le résultat du soir : c'est le dénouement,
 * et un même joueur ne doit pas recevoir les deux.
 */
async function announce(news: Announcements): Promise<DeliveryReport> {
  const userUids = [...new Set([...news.closing.keys(), ...news.evening.keys()])];
  const recipients = await loadRecipients(userUids);
  const deliveries: Delivery[] = [];

  for (const userUid of userUids) {
    const recipient = recipients.get(userUid);
    if (!recipient) continue;

    const locale = resolveLocale(recipient.locale);
    const closing = news.closing.get(userUid);
    const notification = closing ?
      composeClosing(closing, locale) :
      composeEvening(news.evening.get(userUid) as EveningNews, locale);
    if (!notification) continue;

    deliveries.push({
      recipient,
      notification,
      data: {
        contestUid: news.contestUidByUser.get(userUid) ?? "",
        kind: closing ? "CLOSING" : "EVENING",
      },
    });
  }

  return deliver(deliveries);
}

/** Le rendez-vous quotidien. Un seul job pour tous les concours (D28). */
export const dailyCycle = onSchedule(
  { schedule: "0 18 * * *", timeZone: "Europe/Paris", maxInstances: 1 },
  async () => {
    const report = await runCycle(Date.now());
    console.log(JSON.stringify(report));
  },
);

/**
 * Le même cycle, déclenchable à la main. Réservé aux projets de debug : c'est
 * un endpoint qui réécrit tous les classements.
 */
export const runCycleHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const project = process.env.GCLOUD_PROJECT ?? "";
    const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!emulated && !/debug/i.test(project)) {
      throw forbidden("ce déclenchement manuel est réservé aux projets de debug");
    }
    return runCycle(Date.now());
  }),
);
