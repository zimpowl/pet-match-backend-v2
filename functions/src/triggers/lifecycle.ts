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
import {
  CONTEST_DAYS,
  DAY_MILLIS,
  contestDayIndex,
  normalizeVotesPerDay,
} from "../core/allocation";
import { computeMaxVotesPerJudge, computeVotesPerDay } from "../core/cap";
import { DEFAULT_K_FACTOR } from "../core/elo";
import { compareJudges, compareParticipants, rank as ranked } from "../core/ranking";
import { CountedVote, judgeResults, medalFromRank } from "../core/results";
import { atContestHour, toMillisOrZero } from "../core/time";
import { StatsDoc } from "../models/user";
import { computeGradeLevel, raiseGrade } from "../core/grade";
import { GradeDoc } from "../models/grade";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
  ContestVoteDoc,
} from "../models/contest";
import { JsonResponse, forbidden, respond } from "../http/respond";
import {
  ClosingNews,
  composeClosing,
  composeOpening,
  composeReminder,
  remainingToday,
  resolveLocale,
  shouldRemind,
} from "../core/notifications";
import {
  Delivery,
  DeliveryReport,
  deliver,
  loadRecipients,
  loadReachable,
} from "../data/notify";

/**
 * 18 h est la seule horloge du jeu (§4.2 bis). Un concours démarre à 18 h, il
 * se termine à 18 h, et chaque soir à 18 h il se passe quelque chose. Un seul
 * job pour tous les concours, sept exécutions par cycle.
 *
 * Ce job est le **seul écrivain** des instantanés — `rank`, `rankPrevious`,
 * `eloSnapshot`, `votesReceivedSnapshot`, `duelsSnapshot`, `votesSnapshot`, `snapshotAt`. Les
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
 * reçoit qu'**une** notification par soir, même s'il est à la fois participant
 * et juré : la clé de cette carte est son uid.
 *
 * Les soirs de semaine n'annoncent rien : le classement se recalcule et se lit
 * dans l'app, mais le résultat, c'est le dimanche. Seuls la clôture et le
 * concours qui commence font une notification.
 */
interface Announcements {
  readonly closing: Map<string, ClosingNews>;
  /** Les concours activés ce soir : on peut y voter dès maintenant. */
  readonly opened: { readonly contestUid: string; readonly theme: string }[];
  readonly contestUidByUser: Map<string, string>;
  /** L'animal sur lequel ouvrir le concours au tap, quand le joueur en a un. */
  readonly petUidByUser: Map<string, string>;
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
export async function runCycle(
  nowMillis: number,
  options: { silent?: boolean } = {},
): Promise<CycleReport> {
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
    closing: new Map(),
    opened: [],
    contestUidByUser: new Map(),
    petUidByUser: new Map(),
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
      news.opened.push({ contestUid: doc.id, theme: contest.theme });
      continue;
    }

    if (endAt <= nowMillis) {
      await close(doc.ref, contest, writes, report, news);
      continue;
    }

    // Un concours qui n'a pas encore vu son premier 18 h n'a rien à figer.
    if (nowMillis < startAt + DAY_MILLIS) continue;
    await snapshot(doc.ref, nowMillis, writes, report);
  }

  await writes.flush();

  // Les notifications sont envoyées **après** l'écriture, hors de la boucle du
  // batch (§7) : un échec d'envoi ne doit jamais défaire un classement.
  if (!options.silent) report.notifications = await announce(news);

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
 * La justesse au regard des ELO du moment (§2.1). À la clôture ce sont les ELO
 * finaux ; au 18 h du soir, ceux de l'instantané qu'on vient de poser. Le calcul
 * est le même — seule change la photo des forces à laquelle on compare.
 */
async function scoreJudges(
  ref: FirebaseFirestore.DocumentReference,
  participants: FirebaseFirestore.QuerySnapshot,
): Promise<ReadonlyMap<string, { correctVotes: number; difficultyScore: number }>> {
  const votes = await ref.collection(VOTES).get();

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

  return judgeResults(counted, eloByPetId);
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
  nowMillis: number,
  writes: Batcher,
  report: CycleReport,
): Promise<void> {
  const [participants, judges] = await Promise.all([
    ref.collection(PARTICIPANTS).get(),
    ref.collection(JUDGES).get(),
  ]);

  // La justesse du soir porte sur **tous** les votes de la semaine, rejugés
  // contre les ELO qu'on vient de figer (D93), et elle **classe** dès le
  // premier soir (D96) : mardi on voit le classement qu'on aurait si tout
  // s'arrêtait là. Le tri restant un compte de votes justes et non un taux,
  // voter plus paie toujours — trente votes à moitié justes devancent cinq
  // votes parfaits.
  const results = await scoreJudges(ref, participants);

  rankParticipants(ref, participants.docs, writes, true);
  rankJudges(ref, judges.docs, results, writes, true);

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

  const results = await scoreJudges(ref, participants);

  const rankedPets = rankParticipants(ref, participants.docs, writes, true);
  const rankedJudges = rankJudges(ref, judges.docs, results, writes, true);
  const participantRanks = new Map(rankedPets.map((row) => [row.petId, row.rank]));
  const judgeRanks = new Map(rankedJudges.map((row) => [row.userUid, row.rank]));

  // La clôture ne dit que la clôture : le nom de l'animal et le fait d'avoir
  // jugé suffisent. Tout le reste est le dénouement, et il est dans l'app.
  for (const row of rankedPets) {
    const current = news.closing.get(row.ownerUid);
    news.closing.set(row.ownerUid, {
      theme: contest.theme,
      petName: current?.petName ?? row.petName,
      wasJudge: current?.wasJudge ?? false,
    });
    news.contestUidByUser.set(row.ownerUid, ref.id);
    news.petUidByUser.set(row.ownerUid, row.petId);
  }

  for (const row of rankedJudges) {
    const current = news.closing.get(row.userUid);
    news.closing.set(row.userUid, {
      theme: contest.theme,
      petName: current?.petName ?? null,
      wasJudge: true,
    });
    news.contestUidByUser.set(row.userUid, ref.id);
  }

  // Médailles et agrégats. Un podium est une médaille, et une médaille est une
  // médaille : or, argent et bronze pèsent pareil pour les compteurs (D55).
  // On relit les docs plutôt que d'incrémenter, parce que `bestRank` est un
  // minimum et qu'aucun `FieldValue` ne sait faire un minimum.
  //
  // Le palmarès s'écrit **ici et nulle part ailleurs** : plus aucune copie
  // n'est recollée sur les participations. Ce document est la seule source,
  // et toutes les listes le relisent au moment de s'afficher.
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
    const stats = nextStats(snap.data()?.stats, rankValue);
    writes.set(
      snap.ref,
      { stats, grade: nextGrade(snap.data(), stats, snap.get("verifiedAt") != null) },
      true,
    );
  }

  for (const snap of userDocs) {
    const rankValue = judgeRanks.get(snap.id) ?? null;
    const gained = results.get(snap.id)?.correctVotes ?? 0;
    const totals = (snap.data()?.totals ?? {}) as { votes?: number; correctVotes?: number };
    const stats = nextStats(snap.data()?.stats, rankValue);
    writes.set(
      snap.ref,
      {
        stats,
        grade: nextGrade(snap.data(), stats, snap.get("isVerified") === true),
        totals: { correctVotes: (totals.correctVotes ?? 0) + gained },
      },
      true,
    );
  }

  // Le vainqueur devient l'image de la slab de chaque juré : « j'étais là quand
  // celui-là a gagné ». Gelé maintenant, donc immuable — un concours clos ne
  // change plus de vainqueur.
  const champion = rankedPets.find((row) => row.rank === 1);
  if (champion) {
    const winner = {
      petId: champion.petId,
      name: champion.petName,
      photoUrl: champion.photoUrl,
    };
    for (const row of rankedJudges) {
      writes.set(ref.collection(JUDGES).doc(row.userUid), { winner }, true);
    }
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
  readonly photoUrl: string | null;
  readonly rank: number;
  readonly rankPrevious: number | null;
  readonly elo: number;
}

/** Un niveau ne redescend jamais (D30) : on relève, on ne recalcule pas. */
function nextGrade(
  current: FirebaseFirestore.DocumentData | undefined,
  stats: StatsDoc,
  verified: boolean,
): GradeDoc {
  return raiseGrade(
    current?.grade as GradeDoc | undefined,
    computeGradeLevel(stats, verified),
    Timestamp.now(),
  );
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
      photoUrl: row.data.photoUrl ?? null,
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
            duelsSnapshot: row.data.duels,
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

    // 18 h de Paris, toujours (§4.0). Le suivant hérite de la fin du précédent,
    // donc une heure de travers se propagerait de concours en concours.
    const startAt = atContestHour(toMillisOrZero(active.endAt));
    const ref = db.collection(CONTESTS).doc();
    const draft: ContestDoc = {
      theme: theme ?? `Concours n° ${number}`,
      number,
      status: "DRAFT",
      createdAt: Timestamp.fromMillis(nowMillis),
      startAt: Timestamp.fromMillis(startAt),
      endAt: Timestamp.fromMillis(atContestHour(startAt + NEXT_CONTEST_LEAD)),
      // Figés à l'activation, pas ici : on ne connaît pas encore l'effectif.
      maxVotesPerJudge: 0,
      maxVotesPerDay: 0,
      eloKFactor: active.eloKFactor || DEFAULT_K_FACTOR,
      counts: { participants: 0, judges: 0, registrations: 0 },
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
 * Le payload que l'app consomme. `kind` choisit le canal de notification, et
 * `deepLink` ouvre le concours au tap — la route `RootRoute.Contest` le déclare.
 *
 * `contestUid` est un champ **requis** de la route, donc il va dans le chemin ;
 * `petUid` et `judgeUid` sont optionnels, donc en query. Et on n'ouvre jamais un
 * concours « en général » : on l'ouvre **sur quelqu'un** (D86) — sur l'animal du
 * joueur s'il en a un en course, sinon sur sa ligne de juré.
 */
function deepLinkData(
  contestUid: string,
  kind: string,
  target: { petUid?: string; judgeUid?: string } = {},
): Record<string, string> {
  if (!contestUid) return { contestUid, kind, deepLink: "petmatch://app" };

  const query = target.petUid ?
    `?petUid=${encodeURIComponent(target.petUid)}` :
    target.judgeUid ?
      `?judgeUid=${encodeURIComponent(target.judgeUid)}` :
      "";

  return { contestUid, kind, deepLink: `petmatch://contest/${contestUid}${query}` };
}

/**
 * L'annonce du soir. Le dimanche seulement : ceux qui avaient un rôle dans le
 * concours clos apprennent que les résultats sont tombés ; tous les autres,
 * qu'un concours commence. Personne ne reçoit les deux.
 */
async function announce(news: Announcements): Promise<DeliveryReport> {
  const deliveries: Delivery[] = [];

  const closingUids = [...news.closing.keys()];
  const recipients = await loadRecipients(closingUids);
  for (const userUid of closingUids) {
    const recipient = recipients.get(userUid);
    const closing = news.closing.get(userUid);
    if (!recipient || !closing) continue;

    const notification = composeClosing(closing, resolveLocale(recipient.locale));
    if (!notification) continue;

    deliveries.push({
      recipient,
      notification,
      data: deepLinkData(news.contestUidByUser.get(userUid) ?? "", "CLOSING", {
        petUid: news.petUidByUser.get(userUid),
        judgeUid: userUid,
      }),
    });
  }

  // Un concours commence le dimanche, et un seul : s'il y en avait deux, on
  // n'annoncerait que le premier, une notification par soir suffit.
  const opened = news.opened[0];
  if (opened) {
    for (const recipient of await loadReachable()) {
      if (news.closing.has(recipient.userUid)) continue;
      deliveries.push({
        recipient,
        notification: composeOpening({ theme: opened.theme }, resolveLocale(recipient.locale)),
        data: deepLinkData(opened.contestUid, "OPENING"),
      });
    }
  }

  return deliver(deliveries);
}

/**
 * Le rappel de l'après-midi. L'allocation ne se cumule pas : ce qui n'est pas
 * posé avant 18 h est perdu (D37). On ne réveille donc que le juré qui **n'a
 * rien posé aujourd'hui** — celui qui a déjà voté n'a rien à rattraper, et
 * celui qui est « Complet » ne peut plus rien poser.
 *
 * C'est un rappel auto-limitant : il ne touche que ceux qui ont décroché, donc
 * un assidu n'en reçoit jamais.
 */
export async function runReminders(nowMillis: number): Promise<DeliveryReport> {
  const contests = await db.collection(CONTESTS).where("status", "==", "ACTIVE").get();
  const deliveries: Delivery[] = [];

  for (const doc of contests.docs) {
    const contest = doc.data() as ContestDoc;
    const day = contestDayIndex(nowMillis, toMillisOrZero(contest.startAt));
    if (day === null) continue;

    const judges = await doc.ref.collection(JUDGES).get();
    const candidates = judges.docs.filter((judgeDoc) => {
      const judge = judgeDoc.data() as ContestJudgeDoc;
      return shouldRemind({
        votesToday: normalizeVotesPerDay(judge.votesPerDay)[day] ?? 0,
        votesCast: judge.votes,
        maxVotesPerJudge: contest.maxVotesPerJudge,
        dailyCapacity: contest.maxVotesPerDay,
      });
    });
    if (candidates.length === 0) continue;

    const recipients = await loadRecipients(candidates.map((judgeDoc) => judgeDoc.id));
    for (const judgeDoc of candidates) {
      const recipient = recipients.get(judgeDoc.id);
      if (!recipient) continue;

      const judge = judgeDoc.data() as ContestJudgeDoc;
      const notification = composeReminder(
        {
          theme: contest.theme,
          remaining: remainingToday({
            votesCast: judge.votes,
            maxVotesPerJudge: contest.maxVotesPerJudge,
            dailyCapacity: contest.maxVotesPerDay,
          }),
        },
        resolveLocale(recipient.locale),
      );
      if (!notification) continue;

      deliveries.push({
        recipient,
        notification,
        data: deepLinkData(doc.id, "REMINDER", { judgeUid: judgeDoc.id }),
      });
    }
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
 * Trois heures avant la bascule. Assez tôt pour qu'un joueur ait le temps de
 * poser ses votes, assez tard pour que la journée ait eu sa chance.
 */
export const dailyReminder = onSchedule(
  { schedule: "0 15 * * *", timeZone: "Europe/Paris", maxInstances: 1 },
  async () => {
    const report = await runReminders(Date.now());
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
    // `?silent=true` : le même cycle sans les envois. Sur debug les jetons FCM
    // viennent d'ailleurs, et `notify` efface ceux que FCM refuse — un cycle
    // manuel les supprimerait un par un pour rien.
    const silent = String((req.query as Record<string, unknown>).silent ?? "") === "true";
    return runCycle(Date.now(), { silent });
  }),
);

/** Le rappel, déclenchable à la main. Mêmes restrictions. */
export const runRemindersHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const project = process.env.GCLOUD_PROJECT ?? "";
    const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!emulated && !/debug/i.test(project)) {
      throw forbidden("ce déclenchement manuel est réservé aux projets de debug");
    }
    return runReminders(Date.now());
  }),
);
