import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { emptyVotesPerDay } from "../core/allocation";
/**
 * Le plafond du legacy, mesuré sur les 18 concours réels : 5 votes par jour sur
 * une fenêtre dimanche → dimanche, donc huit jours et non sept. Le maximum
 * absolu observé est exactement 40, atteint sur douze concours sur dix-huit.
 */
const LEGACY_VOTES_PER_DAY = 5;
const LEGACY_MAX_VOTES_PER_JUDGE = 40;
import { DEFAULT_ELO, DEFAULT_K_FACTOR, pairKey } from "../core/elo";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
  ContestVoteDoc,
} from "../models/contest";
import { PetDoc } from "../models/pet";
import { StatsDoc, UserDoc } from "../models/user";
import {
  LegacyChallenge,
  LegacyJudge,
  LegacyParticipant,
  LegacyPet,
  LegacyUser,
  LegacyVote,
} from "./legacy";
import { computeGradeLevel } from "../core/grade";
import {
  assignNumbers,
  mapSex,
  mapSpecies,
  mapStatus,
  parseBirthDate,
  petCreationFields,
  remapPairKey,
  resolvePet,
  statsFromRanks,
} from "./mapping";

/**
 * Migration `challenges` → `contests` (§6). Idempotente, `--dry-run` par
 * défaut, et un garde qui refuse tout projet dont l'id ne dit pas « debug ».
 *
 *   npm run migrate -- --project=pet-match---debug            # compte et signale
 *   npm run migrate -- --project=pet-match---debug --commit    # écrit
 *
 * Ce que le §6 ne dit pas et qui a été relevé dans les données réelles :
 *
 * - les participants sont clés par `userUid` et **aucun** ne porte `petUid`,
 *   donc la re-clé passe par le nom de l'animal chez son propriétaire ;
 * - les votes référencent des `userUid` (`leftParticipantId` = id du doc
 *   participant), donc leurs trois références, leur `pairKey` et **la clé du
 *   doc** doivent être réécrites ;
 * - les `seenPairs` des jurés sont eux aussi des paires de `userUid`.
 *
 * Ce que la migration ne peut pas reconstituer, et qu'elle pose donc à zéro :
 * `expectedPicked` (jamais stocké → le score de difficulté de l'historique est
 * définitivement perdu), `difficultyScore`, et `votesPerDay` (la répartition
 * quotidienne n'a jamais existé ; seul le total est vrai).
 */

const BATCH_SIZE = 400;
const EMPTY_STATS: StatsDoc = {
  contests: 0,
  bestRank: null,
  gold: 0,
  silver: 0,
  bronze: 0,
};

interface Options {
  readonly projectId: string;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!emulated && !/debug/i.test(projectId)) {
    throw new Error(
      `refus d'écrire sur « ${projectId} » : la migration ne cible que les projets de debug`,
    );
  }

  return { projectId, commit: argv.includes("--commit") };
}

interface Write {
  readonly path: string;
  readonly data: FirebaseFirestore.DocumentData;
  readonly merge: boolean;
}

function millis(value: { toMillis(): number } | null | undefined, fallback: number): number {
  return value ? value.toMillis() : fallback;
}

/** Identifiant déterministe : relancer la migration ne recrée pas l'animal. */
function migratedPetId(userUid: string, petName: string): string {
  const slug = petName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `migrated_${userUid}_${slug || "sans-nom"}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  const writes: Write[] = [];
  const anomalies: string[] = [];
  const counts: Record<string, number> = {};
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  // ---- Lecture -------------------------------------------------------------
  const [petsSnap, usersSnap, challengesSnap, existingContestsSnap] = await Promise.all([
    db.collection("pets").get(),
    db.collection("users").get(),
    db.collection("challenges").get(),
    db.collection("contests").select("number").get(),
  ]);

  const legacyPets = new Map<string, LegacyPet>(
    petsSnap.docs.map((doc) => [doc.id, doc.data() as LegacyPet]),
  );
  const legacyUsers = new Map<string, LegacyUser>(
    usersSnap.docs.map((doc) => [doc.id, doc.data() as LegacyUser]),
  );
  /**
   * Un `contests/{id}` déjà présent est de deux natures, et il faut les
   * distinguer sous peine de rendre la migration non rejouable :
   *
   * - une **passe précédente de cette migration** — la réécrire est exactement
   *   ce qu'on veut, c'est la définition d'idempotent ;
   * - un **vestige d'une génération antérieure**, qu'il ne faut jamais écraser.
   *
   * Les seconds n'ont pas de `number` — vérifié sur les 125 documents de la v0,
   * zéro en portait — les nôtres si.
   */
  const foreignContestIds = new Set(
    existingContestsSnap.docs
      .filter((doc) => typeof doc.get("number") !== "number")
      .map((doc) => doc.id),
  );

  const petsByOwner = new Map<string, { petId: string; name: string | undefined }[]>();
  for (const [petId, pet] of legacyPets) {
    const owned = petsByOwner.get(pet.userUid) ?? [];
    owned.push({ petId, name: pet.name });
    petsByOwner.set(pet.userUid, owned);
  }

  interface LoadedChallenge {
    readonly id: string;
    readonly doc: LegacyChallenge;
    readonly participants: { id: string; data: LegacyParticipant }[];
    readonly judges: { id: string; data: LegacyJudge }[];
    readonly votes: { id: string; data: LegacyVote }[];
  }

  const challenges: LoadedChallenge[] = [];
  for (const doc of challengesSnap.docs) {
    const [participants, judges, votes] = await Promise.all([
      doc.ref.collection("participants").get(),
      doc.ref.collection("judges").get(),
      doc.ref.collection("votes").get(),
    ]);
    challenges.push({
      id: doc.id,
      doc: doc.data() as LegacyChallenge,
      participants: participants.docs.map((d) => ({
        id: d.id,
        data: d.data() as LegacyParticipant,
      })),
      judges: judges.docs.map((d) => ({ id: d.id, data: d.data() as LegacyJudge })),
      votes: votes.docs.map((d) => ({ id: d.id, data: d.data() as LegacyVote })),
    });
  }

  for (const challenge of challenges) {
    if (foreignContestIds.has(challenge.id)) {
      anomalies.push(
        `COLLISION : contests/${challenge.id} appartient à une génération antérieure`,
      );
    }
  }

  // ---- Re-clé des participants --------------------------------------------
  /** Par concours : userUid du doc participant → petId cible. */
  const petIdByUserUid = new Map<string, Map<string, string>>();
  const petsToCreate = new Map<string, { ownerUid: string; source: LegacyParticipant }>();

  for (const challenge of challenges) {
    const map = new Map<string, string>();
    for (const participant of challenge.participants) {
      const owner = participant.data.userUid ?? participant.id;
      const resolution = resolvePet(participant.data, petsByOwner.get(owner) ?? []);

      if (resolution.kind === "CREATE") {
        const fields = petCreationFields(participant.data);
        const petId = migratedPetId(owner, fields.name);
        petsToCreate.set(petId, { ownerUid: owner, source: participant.data });
        map.set(participant.id, petId);
        bump("animaux à créer (espèce inconnue, rangés en DOG)");
      } else {
        map.set(participant.id, resolution.petId);
        bump(resolution.kind === "DECLARED" ? "petUid déclaré" : "retrouvé par nom");
      }
    }
    petIdByUserUid.set(challenge.id, map);
  }

  // ---- Trajectoire de carrière ---------------------------------------------
  /**
   * Une slab doit dire ce que son porteur était **ce jour-là** (D30). Le legacy
   * n'a jamais stocké ça, mais l'historique complet est daté : on peut donc le
   * reconstruire, en parcourant les concours dans l'ordre et en accumulant les
   * podiums au fur et à mesure. C'est ce qui donne à l'étagère une trajectoire
   * — « il a gagné celui-là quand il n'avait encore aucune médaille » — au lieu
   * d'une carrière plate recopiée partout.
   *
   * Le niveau, lui, sort à 0 pour tout le monde (D91) : le cran 1 « confirmé »
   * demande une vérification **manuelle**, que personne n'a encore passée. La
   * migration ne l'invente pas — elle passe `verified: false` et l'échelle,
   * qui est cumulative, s'arrête donc au premier barreau.
   */
  const chronological = [...challenges].sort(
    (a, b) =>
      millis(a.doc.startAt ?? a.doc.createdAt, 0) - millis(b.doc.startAt ?? b.doc.createdAt, 0),
  );

  const frozen = new Map<string, { stats: StatsDoc; grade: number }>();
  const winnerOf = new Map<string, { petId: string; name: string; photoUrl: string | null }>();
  type RankTrail = Map<string, Array<number | null>>;
  const petHistory: RankTrail = new Map();
  const judgeHistory: RankTrail = new Map();

  const freeze = (key: string, history: RankTrail, holder: string) => {
    const stats = statsFromRanks(history.get(holder) ?? []);
    frozen.set(key, { stats, grade: computeGradeLevel(stats, false) });
  };

  for (const challenge of chronological) {
    const closed = mapStatus(challenge.doc.status) === "CLOSED";
    const map = petIdByUserUid.get(challenge.id) ?? new Map<string, string>();

    let best: { rank: number; petId: string } | null = null;

    // Ce concours entre dans l'historique **avant** le gel : l'instantané doit
    // le contenir (D90). Un concours non clos y entre comme un rang nul — il
    // compte donc dans `contests` sans donner de médaille, ce qui est
    // exactement la règle « on peut être premier le mardi soir ».
    for (const participant of challenge.participants) {
      const petId = map.get(participant.id);
      if (!petId) continue;

      const rank = participant.data.rank ?? null;
      const list = petHistory.get(petId) ?? [];
      list.push(closed ? rank : null);
      petHistory.set(petId, list);

      if (closed && rank !== null && (best === null || rank < best.rank)) {
        best = { rank, petId };
      }
    }
    for (const judge of challenge.judges) {
      const list = judgeHistory.get(judge.id) ?? [];
      list.push(closed ? judge.data.finalRank ?? null : null);
      judgeHistory.set(judge.id, list);
    }

    for (const participant of challenge.participants) {
      const petId = map.get(participant.id);
      if (!petId) continue;
      freeze(`p:${challenge.id}:${petId}`, petHistory, petId);
    }
    for (const judge of challenge.judges) {
      freeze(`j:${challenge.id}:${judge.id}`, judgeHistory, judge.id);
    }

    if (best) {
      const source = challenge.participants.find((entry) => map.get(entry.id) === best?.petId);
      const pet = legacyPets.get(best.petId);
      winnerOf.set(challenge.id, {
        petId: best.petId,
        name: pet?.name ?? source?.data.petName ?? "",
        photoUrl: source?.data.imageUrl ?? pet?.imageUrl ?? null,
      });
    }
  }

  // ---- Numérotation (D83) --------------------------------------------------
  const allPets = new Map<string, { species: string | null; createdAtMillis: number }>();
  for (const [petId, pet] of legacyPets) {
    allPets.set(petId, {
      species: mapSpecies(pet.species),
      createdAtMillis: millis(pet.createdAt, 0),
    });
  }
  for (const [petId, created] of petsToCreate) {
    // Le participant legacy ne porte aucune espèce : il n'y a rien à déduire.
    // On range l'animal créé chez les chiens, et le rapport le signale.
    //
    // Sa date est celle de son inscription, **pas** `Date.now()` : le numéro
    // suit l'ancienneté (D83), donc un animal ressuscité d'un vieux concours
    // doit prendre sa place chronologique et non la dernière. C'est aussi ce
    // qui rend la numérotation entièrement déterministe.
    allPets.set(petId, {
      species: "DOG",
      createdAtMillis: millis(created.source.createdAt, 0),
    });
  }

  const dogNumbers = assignNumbers(
    [...allPets].filter(([, p]) => p.species !== "CAT").map(([id, p]) => ({ id, ...p })),
  );
  const catNumbers = assignNumbers(
    [...allPets].filter(([, p]) => p.species === "CAT").map(([id, p]) => ({ id, ...p })),
  );
  const petNumber = (petId: string) => dogNumbers.get(petId) ?? catNumbers.get(petId) ?? 0;

  const contestNumbers = assignNumbers(
    challenges.map((c) => ({
      id: c.id,
      createdAtMillis: millis(c.doc.startAt ?? c.doc.createdAt, 0),
    })),
  );

  const firstJudgedAt = new Map<string, number>();
  for (const challenge of challenges) {
    for (const judge of challenge.judges) {
      const at = millis(judge.data.joinedAt, 0);
      const known = firstJudgedAt.get(judge.id);
      if (known === undefined || at < known) firstJudgedAt.set(judge.id, at);
    }
  }
  const judgeNumbers = assignNumbers(
    [...firstJudgedAt].map(([id, createdAtMillis]) => ({ id, createdAtMillis })),
  );

  // ---- Écritures ----------------------------------------------------------
  type RankHistory = Map<string, Array<number | null>>;
  const petRanks: RankHistory = new Map();
  const judgeRanks: RankHistory = new Map();
  const judgeTotals = new Map<string, { votes: number; correctVotes: number }>();

  for (const challenge of challenges) {
    const status = mapStatus(challenge.doc.status);
    if (status === null) {
      anomalies.push(`statut inconnu « ${challenge.doc.status} » sur challenges/${challenge.id}`);
      continue;
    }

    const map = petIdByUserUid.get(challenge.id) ?? new Map<string, string>();
    const participantCount = challenge.participants.length;

    // Le plafond d'un concours migré est celui sous lequel il a **réellement**
    // été joué (D92) : 5 votes par jour du dimanche au dimanche, soit huit
    // jours, soit 40. Le v2 en compte sept (35 ou 70), mais appliquer sa règle
    // à l'historique le falsifierait — un juré qui a posé 40 votes en a posé
    // 40, et sa slab doit le dire. `maxVotesPerJudge` est stocké par concours
    // précisément pour ça : une slab sait sous quelles règles elle a été jouée.
    const cap = LEGACY_MAX_VOTES_PER_JUDGE;
    const startAt = millis(challenge.doc.startAt, 0);
    const endAt = millis(challenge.doc.endAt, startAt);

    const contest: ContestDoc = {
      theme: challenge.doc.theme ?? "",
      number: contestNumbers.get(challenge.id) ?? 0,
      status,
      createdAt: Timestamp.fromMillis(millis(challenge.doc.createdAt, startAt)),
      startAt: Timestamp.fromMillis(startAt),
      endAt: Timestamp.fromMillis(endAt),
      maxVotesPerJudge: cap,
      maxVotesPerDay: LEGACY_VOTES_PER_DAY,
      eloKFactor: challenge.doc.eloKFactor ?? DEFAULT_K_FACTOR,
      counts: { participants: participantCount, judges: challenge.judges.length },
      // Un concours clos a eu tous ses 18 h ; les autres n'en ont pas encore eu
      // de reconstituable, et leurs listes sortiront donc en ordre d'inscription.
      snapshotAt: status === "CLOSED" ? Timestamp.fromMillis(endAt) : null,
    };
    writes.push({ path: `contests/${challenge.id}`, data: contest, merge: false });
    bump("concours");

    const registrationOrder = assignNumbers(
      challenge.participants.map((p) => ({
        id: p.id,
        createdAtMillis: millis(p.data.createdAt, 0),
      })),
    );

    for (const participant of challenge.participants) {
      const petId = map.get(participant.id);
      if (!petId) {
        anomalies.push(`participant non re-clé : ${challenge.id}/${participant.id}`);
        continue;
      }

      const data = participant.data;
      const elo = data.elo ?? DEFAULT_ELO;
      const wins = data.wins ?? 0;
      const rank = data.rank ?? null;
      const pet = legacyPets.get(petId);
      const fields = petCreationFields(data);

      const row: ContestParticipantDoc = {
        petId,
        ownerUid: data.userUid ?? participant.id,
        petNumber: petNumber(petId),
        petName: pet?.name ?? fields.name,
        petBreed: pet?.breed ?? fields.breed,
        species: mapSpecies(pet?.species) ?? "DOG",
        sex: mapSex(pet?.gender),
        photoUrl: data.imageUrl ?? pet?.imageUrl ?? "",
        registrationIndex: registrationOrder.get(participant.id) ?? 1,
        gradeAtEntry: frozen.get(`p:${challenge.id}:${petId}`)?.grade ?? 0,
        statsAtContest: frozen.get(`p:${challenge.id}:${petId}`)?.stats ?? EMPTY_STATS,
        elo,
        wins,
        losses: data.losses ?? 0,
        duels: data.duelsPlayed ?? 0,
        // `votesReceived` = nombre de fois choisi, donc `wins` (§4.9).
        votesReceived: wins,
        // Pas d'instantané dans l'historique : la valeur vive est la seule vraie.
        eloSnapshot: elo,
        votesReceivedSnapshot: wins,
        rank,
        // Il n'y a pas de « veille » reconstituable : l'écart de 18 h n'existe pas.
        rankPrevious: null,
        createdAt: Timestamp.fromMillis(millis(data.createdAt, startAt)),
      };
      writes.push({
        path: `contests/${challenge.id}/participants/${petId}`,
        data: row,
        merge: false,
      });
      bump("participants");

      const ranks = petRanks.get(petId) ?? [];
      ranks.push(status === "CLOSED" ? rank : null);
      petRanks.set(petId, ranks);
    }

    const judgeOrder = assignNumbers(
      challenge.judges.map((j) => ({ id: j.id, createdAtMillis: millis(j.data.joinedAt, 0) })),
    );

    for (const judge of challenge.judges) {
      const data = judge.data;
      // Aucun écrêtage : le compteur dit ce qui a été posé (D92).
      const votes = data.votesCount ?? 0;
      const correctVotes = Math.min(data.finalCorrectVotes ?? 0, votes);
      const rank = data.finalRank ?? null;

      const seenPairs: string[] = [];
      for (const legacyKey of data.seenPairs ?? []) {
        const remapped = remapPairKey(legacyKey, map);
        if (remapped) seenPairs.push(remapped);
        else bump("seenPairs non remappables");
      }

      const row: ContestJudgeDoc = {
        userUid: judge.id,
        judgeNumber: judgeNumbers.get(judge.id) ?? 0,
        userName: data.userName ?? legacyUsers.get(judge.id)?.name ?? "",
        userAvatarUrl: data.userAvatarUrl ?? legacyUsers.get(judge.id)?.avatarUrl ?? null,
        registrationIndex: judgeOrder.get(judge.id) ?? 1,
        gradeAtEntry: frozen.get(`j:${challenge.id}:${judge.id}`)?.grade ?? 0,
        statsAtContest: frozen.get(`j:${challenge.id}:${judge.id}`)?.stats ?? EMPTY_STATS,
        // L'image de la slab d'un juré : le vainqueur du concours qu'il a jugé.
        winner: winnerOf.get(challenge.id) ?? null,
        // La répartition quotidienne n'a jamais été stockée : seul le total est vrai.
        votesPerDay: emptyVotesPerDay(),
        votes,
        votesSnapshot: votes,
        correctVotes,
        // `expectedPicked` n'a jamais été stocké : non recalculable (§6).
        difficultyScore: 0,
        rank,
        rankPrevious: null,
        seenPairs,
        joinedAt: Timestamp.fromMillis(millis(data.joinedAt, startAt)),
      };
      writes.push({
        path: `contests/${challenge.id}/judges/${judge.id}`,
        data: row,
        merge: false,
      });
      bump("jurés");

      const ranks = judgeRanks.get(judge.id) ?? [];
      ranks.push(status === "CLOSED" ? rank : null);
      judgeRanks.set(judge.id, ranks);

      const totals = judgeTotals.get(judge.id) ?? { votes: 0, correctVotes: 0 };
      totals.votes += votes;
      totals.correctVotes += correctVotes;
      judgeTotals.set(judge.id, totals);
    }

    for (const vote of challenge.votes) {
      const data = vote.data;
      const a = map.get(data.leftParticipantId);
      const b = map.get(data.rightParticipantId);
      const picked = map.get(data.pickedParticipantId);

      if (!a || !b || !picked) {
        bump("votes non remappables");
        continue;
      }

      const key = pairKey(a, b);
      const row: ContestVoteDoc = {
        judgeUserUid: data.judgeUserUid,
        aPetId: a,
        bPetId: b,
        pickedPetId: picked,
        pairKey: key,
        // Jamais stocké dans le legacy, et non recalculable après coup (§6).
        expectedPicked: 0,
        createdAt: Timestamp.fromMillis(startAt),
      };
      writes.push({
        path: `contests/${challenge.id}/votes/${key}_${data.judgeUserUid}`,
        data: row,
        merge: false,
      });
      bump("votes");
    }
  }

  // ---- Animaux et utilisateurs (agrégats recalculés en dernier, §6) --------
  for (const [petId, created] of petsToCreate) {
    const fields = petCreationFields(created.source);
    const pet: PetDoc = {
      userUid: created.ownerUid,
      number: petNumber(petId),
      name: fields.name,
      photoUrl: fields.photoUrl,
      species: "DOG",
      sex: null,
      breed: fields.breed,
      birthDate: null,
      countryCode: null,
      createdAt: Timestamp.fromMillis(millis(created.source.createdAt, Date.now())),
      microchipId: null,
      verifiedAt: null,
      grade: { level: computeGradeLevel(statsFromRanks(petRanks.get(petId) ?? []), false) },
      stats: statsFromRanks(petRanks.get(petId) ?? []),
    };
    writes.push({ path: `pets/${petId}`, data: pet, merge: false });
    bump("animaux créés");
  }

  for (const [petId, pet] of legacyPets) {
    // Un animal créé par une passe précédente est déjà écrit intégralement
    // ci-dessus : le réécrire en fusion ne changerait rien mais compterait deux
    // fois le même document.
    if (petsToCreate.has(petId)) continue;

    const species = mapSpecies(pet.species);
    if (species === null) anomalies.push(`espèce inconnue « ${pet.species} » sur pets/${petId}`);
    const birthDate = parseBirthDate(pet.birthDate);

    writes.push({
      path: `pets/${petId}`,
      data: {
        number: petNumber(petId),
        photoUrl: pet.imageUrl ?? null,
        species: species ?? "DOG",
        sex: mapSex(pet.gender),
        breed: pet.breed ?? null,
        birthDate: birthDate === null ? null : Timestamp.fromMillis(birthDate),
        countryCode: null,
        microchipId: null,
        verifiedAt: null,
        grade: { level: computeGradeLevel(statsFromRanks(petRanks.get(petId) ?? []), false) },
        stats: statsFromRanks(petRanks.get(petId) ?? []),
      },
      merge: true,
    });
    bump("animaux mis à jour");
  }

  for (const [userUid, user] of legacyUsers) {
    const judgedAt = firstJudgedAt.get(userUid);
    const totals = judgeTotals.get(userUid) ?? { votes: 0, correctVotes: 0 };
    const stats = judgeRanks.has(userUid) ?
      statsFromRanks(judgeRanks.get(userUid) ?? []) :
      EMPTY_STATS;

    const patch: Partial<UserDoc> & FirebaseFirestore.DocumentData = {
      name: user.name ?? "",
      // Personne n'a encore choisi de pseudo : l'app le demandera au premier
      // lancement, et les concours déjà joués gardent le nom qui les a signés.
      nickname: null,
      // L'avatar social ne compte pas pour une photo de juré : sur iOS il
      // n'existe pas, et le laisser passer ferait deux exigences pour un même
      // produit. Tout le monde repart sans, et la choisit au premier lancement.
      // Les concours déjà joués gardent la leur, dénormalisée sur le doc juré.
      avatarUrl: null,
      description: user.description ?? null,
      countryCode: null,
      // Les jetons FCM du legacy appartiennent au projet de prod : le projet
      // de debug ne peut pas pousser dessus, et `data/notify.ts` efface tout
      // jeton que FCM refuse. Les migrer reviendrait à les faire supprimer au
      // premier cycle. On part donc de zéro : l'app réenregistre le sien au
      // prochain lancement, via `registerDeviceHttp`.
      fcmToken: null,
      isVerified: false,
      // La langue arrivera de l'app ; sans elle, le français.
      locale: null,
      // Rien n'a été coupé : l'absence vaut oui (§ notify).
      notifications: null,
      grade: { level: computeGradeLevel(stats, false) },
      judgeNumber: judgedAt === undefined ? null : judgeNumbers.get(userUid) ?? null,
      judgeSince: judgedAt === undefined ? null : Timestamp.fromMillis(judgedAt),
      stats,
      totals,
      // Les monnaies disparaissent (§6). `email` et le reste sont conservés.
      coins: FieldValue.delete(),
      diamonds: FieldValue.delete(),
    };
    writes.push({ path: `users/${userUid}`, data: patch, merge: true });
    bump("utilisateurs");
  }

  const maxOf = (map: Map<string, number>) =>
    map.size === 0 ? 0 : Math.max(...map.values());
  writes.push({
    path: "counters/sequences",
    data: {
      dogs: maxOf(dogNumbers),
      cats: maxOf(catNumbers),
      judges: maxOf(judgeNumbers),
      contests: maxOf(contestNumbers),
    },
    merge: true,
  });

  // ---- Rapport ------------------------------------------------------------
  console.log(`projet    : ${options.projectId}`);
  console.log(`challenges lus : ${challenges.length}`);
  console.log(`contests d'une génération antérieure : ${foreignContestIds.size}`);
  console.log();
  for (const [key, value] of Object.entries(counts).sort()) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }
  console.log();
  console.log(`documents à écrire : ${writes.length}`);

  const blocking = anomalies.filter((a) => a.startsWith("COLLISION"));
  if (anomalies.length > 0) {
    console.log();
    console.log("anomalies :");
    for (const anomaly of anomalies.slice(0, 20)) console.log(`  - ${anomaly}`);
    if (anomalies.length > 20) console.log(`  … et ${anomalies.length - 20} autres`);
  }

  if (blocking.length > 0) {
    throw new Error(`${blocking.length} collision(s) d'identifiant : rien n'a été écrit`);
  }

  if (!options.commit) {
    console.log();
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour poser.");
    return;
  }

  console.log();
  console.log("écriture…");
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(db.doc(write.path), write.data, { merge: write.merge });
    }
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH_SIZE, writes.length)} / ${writes.length}`);
  }
  console.log("fait.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
