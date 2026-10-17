import assert from "node:assert/strict";
import { test } from "node:test";
import { firestore } from "firebase-admin";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
} from "../models/contest";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import { Career } from "../core/career";
import {
  MeSource,
  NO_ME,
  contestCard,
  dailyVotesWire,
  judgeProfile,
  judgeRow,
  meWire,
  participantRow,
  shareWire,
  petProfile,
} from "./mappers";
import { DAY_MILLIS } from "../core/allocation";
import { DEFAULT_ELO } from "../core/elo";

const START = 1_700_000_000_000;

const stamp = (millis: number) =>
  ({ toMillis: () => millis } as unknown as firestore.Timestamp);

function contest(overrides: Partial<ContestDoc> = {}): ContestDoc {
  return {
    theme: "Cadrage serré",
    number: 13,
    status: "ACTIVE",
    createdAt: stamp(START - DAY_MILLIS),
    startAt: stamp(START),
    endAt: stamp(START + 7 * DAY_MILLIS),
    maxVotesPerJudge: 70,
    maxVotesPerDay: 10,
    eloKFactor: 24,
    counts: { participants: 31, judges: 24, registrations: 33 },
    snapshotAt: null,
    ...overrides,
  };
}

function judge(overrides: Partial<ContestJudgeDoc> = {}): ContestJudgeDoc {
  return {
    userUid: "zimpo",
    judgeNumber: 12,
    userName: "Zimpo",
    hiddenAt: null,
    userAvatarUrl: null,
    countryCode: "FR",
    registrationIndex: 8,
    winner: null,
    votesPerDay: [10, 10, 10, 3, 0, 0, 0],
    votes: 33,
    votesSnapshot: 30,
    correctVotes: 25,
    difficultyScore: 12.5,
    rank: 4,
    rankPrevious: 6,
    seenPairs: [],
    joinedAt: stamp(START),
    ...overrides,
  };
}

function participant(overrides: Partial<ContestParticipantDoc> = {}): ContestParticipantDoc {
  return {
    petId: "heureux",
    ownerUid: "zimpo",
    petNumber: 34,
    petName: "Heureux",
    petBreed: "berger australien",
    species: "DOG",
    sex: "MALE",
    countryCode: "FR",
    hiddenAt: null,
    photoUrl: "https://placedog.net/300/300?id=42",
    registrationIndex: 8,
    elo: 1266.4,
    wins: 40,
    losses: 18,
    duels: 58,
    votesReceived: 40,
    eloSnapshot: 1251.2,
    votesReceivedSnapshot: 34,
    rank: 2,
    rankPrevious: 3,
    createdAt: stamp(START),
    ...overrides,
  };
}

/**
 * Les palmarès du jour. Ils ne viennent plus du document de participation —
 * une participation ne fige plus rien — mais de `pets/{petId}` et
 * `users/{userUid}`, que l'appelant a lus avant d'appeler le mapper.
 */
const PET_CAREER: Career = {
  level: 3,
  stats: { contests: 6, bestRank: 2, gold: 1, silver: 2, bronze: 0 },
};

const JUDGE_CAREER: Career = {
  level: 2,
  stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
};

const asParticipant = (doc = participant()): MeSource => ({
  ...NO_ME,
  participant: doc,
  petCareer: PET_CAREER,
});

const asJudge = (doc = judge()): MeSource => ({
  ...NO_ME,
  judge: doc,
  judgeCareer: JUDGE_CAREER,
});

test("sans inscription, le bloc me est vide et ne ment pas", () => {
  assert.deepEqual(meWire(contest(), NO_ME), {
    role: "NONE",
    rank: null,
    rankPrevious: null,
    registrationIndex: null,
    pet: null,
    bearer: null,
    votes: null,
    elo: 0,
    votesReceived: 0,
    duels: null,
    shares: 0,
    sharedByMe: false,
    level: 0,
    career: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
    winner: null,
  });
});

test("le nom et la photo restent ceux de l'inscription, le palmarès non (D128)", () => {
  const mine = meWire(contest(), asParticipant());
  assert.deepEqual(mine.bearer, {
    name: participant().petName,
    photoUrl: participant().photoUrl,
    photoRemoved: false,
    subtext: participant().petBreed,
  });

  const theirs = meWire(contest(), asJudge());
  assert.deepEqual(theirs.bearer, {
    name: judge().userName,
    photoUrl: judge().userAvatarUrl,
    photoRemoved: false,
    subtext: null,
  });

  // Une photo retirée par la modération n'est plus servie, mais elle existe.
  const hidden = meWire(contest(), asParticipant(participant({ hiddenAt: stamp(START) })));
  assert.equal(hidden.bearer?.photoUrl, null);
  assert.equal(hidden.bearer?.photoRemoved, true);
  assert.equal(hidden.pet?.photoUrl, null);
});

test("en cours, seuls les votes du dernier 18 h sont jugés (D93)", () => {
  const me = meWire(contest(), asJudge());

  assert.equal(me.role, "JUDGE");
  // 33 posés, 30 tranchés au dernier 18 h, 25 justes : les 3 derniers votes
  // n'ont pas encore de verdict et ne comptent ni juste ni faux.
  assert.deepEqual(me.votes, {
    cast: 33,
    judged: 30,
    correct: 25,
    wrong: 5,
    votesPerDay: [10, 10, 10, 3, 0, 0, 0],
  });
});

test("à la clôture, tout ce qui est posé est jugé", () => {
  const me = meWire(contest({ status: "CLOSED" }), asJudge(judge({ votes: 70, correctVotes: 52 })));

  assert.deepEqual(me.votes, {
    cast: 70,
    judged: 70,
    correct: 52,
    wrong: 18,
    votesPerDay: [10, 10, 10, 3, 0, 0, 0],
  });
});

test("voter ne fait jamais chuter sa précision : le dénominateur ne bouge qu'à 18 h", () => {
  const before = meWire(contest(), asJudge());
  const afterVoting = meWire(contest(), asJudge(judge({ votes: 38 })));

  assert.equal(before.votes?.judged, afterVoting.votes?.judged);
  assert.equal(before.votes?.correct, afterVoting.votes?.correct);
});

test("l'ELO de mon animal suit la même règle d'instantané (D54)", () => {
  const running = meWire(contest(), asParticipant());
  const closed = meWire(contest({ status: "CLOSED" }), asParticipant());

  assert.equal(running.elo, 1251.2);
  assert.equal(closed.elo, 1266.4);
});

test("l'ELO n'est jamais seul : les votes reçus l'accompagnent (§4.9, D62)", () => {
  const running = meWire(contest(), asParticipant());
  const closed = meWire(contest({ status: "CLOSED" }), asParticipant());

  assert.equal(running.votesReceived, 34);
  assert.equal(closed.votesReceived, 40);
});

test("un juré n'a pas d'ELO (D17)", () => {
  assert.equal(meWire(contest(), asJudge()).elo, 0);
});

test("participant : le rôle porte l'animal, le rang est le sien", () => {
  const me = meWire(contest(), asParticipant());

  assert.equal(me.role, "PARTICIPANT");
  assert.equal(me.rank, 2);
  assert.deepEqual(me.pet, {
    petUid: "heureux",
    name: "Heureux",
    photoUrl: "https://placedog.net/300/300?id=42",
    photoRemoved: false,
  });
  assert.equal(me.votes, null);
});

test("le palmarès servi est celui du jour, jamais une copie gelée", () => {
  // Une participation ne fige plus rien : le mapper ne lit que ce que
  // l'appelant a chargé sur `pets/{petId}`, et c'est la seule source.
  const me = meWire(contest(), asParticipant());

  assert.equal(me.level, PET_CAREER.level);
  assert.deepEqual(me.career, PET_CAREER.stats);

  // Le même animal vu après une médaille de plus : la ligne suit, sans
  // qu'aucun document de concours ait été réécrit.
  const promoted = meWire(contest(), {
    ...asParticipant(),
    petCareer: { level: 4, stats: { ...PET_CAREER.stats, gold: 2 } },
  });

  assert.equal(promoted.level, 4);
  assert.equal(promoted.career.gold, 2);
});

test("un juré emprunte son image au vainqueur, un participant jamais", () => {
  const borrowed = meWire(
    contest(),
    asJudge(judge({ winner: { petId: "uno", name: "Uno", photoUrl: "http://p" } })),
  );

  assert.deepEqual(borrowed.winner, { petUid: "uno", name: "Uno", photoUrl: "http://p" });
  assert.equal(meWire(contest(), asParticipant()).winner, null);
});

test("participant ET juré : le rôle est participant, les votes restent visibles", () => {
  const me = meWire(contest(), { ...asParticipant(), judge: judge(), judgeCareer: JUDGE_CAREER });

  assert.equal(me.role, "PARTICIPANT");
  assert.equal(me.votes?.cast, 33);
});

test("la carte ne renvoie que du brut : epoch ms, jamais de J-4", () => {
  const card = contestCard("contest-13", contest());

  assert.equal(card.uid, "contest-13");
  assert.equal(card.startAt, START);
  assert.equal(card.endAt, START + 7 * DAY_MILLIS);
  assert.deepEqual(card.counts, { judges: 24, participants: 31 });
});

test("les lignes sortent avec les noms de champs de l'app", () => {
  assert.deepEqual(participantRow(participant(), "CLOSED", PET_CAREER), {
    petUid: "heureux",
    ownerUid: "zimpo",
    number: 34,
    name: "Heureux",
    breed: "berger australien",
    species: "DOG",
    sex: "MALE",
    countryCode: "FR",
    photoUrl: "https://placedog.net/300/300?id=42",
    photoRemoved: false,
    elo: 1266.4,
    votesReceived: 40,
    duels: 58,
    shares: 0,
    sharedByMe: false,
    rank: 2,
    rankPrevious: 3,
    registrationIndex: 8,
    // Le niveau et le palmarès du jour, lus sur l'animal : la ligne dit ce
    // qu'il est maintenant, exactement comme sa fiche.
    level: 3,
    career: { contests: 6, bestRank: 2, gold: 1, silver: 2, bronze: 0 },
  });

  assert.deepEqual(judgeRow(judge(), contest({ status: "CLOSED" }), 70, JUDGE_CAREER), {
    userUid: "zimpo",
    number: 12,
    name: "Zimpo",
    avatarUrl: null,
    photoRemoved: false,
    countryCode: "FR",
    judgeSince: START,
    votes: 33,
    castVotes: 33,
    correctVotes: 25,
    limit: 70,
    perDay: 10,
    votesPerDay: [10, 10, 10, 3, 0, 0, 0],
    rank: 4,
    registrationIndex: 8,
    level: 2,
    career: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
  });
});

test("l'ELO n'est pas arrondi côté serveur (D16)", () => {
  assert.equal(participantRow(participant(), "CLOSED", PET_CAREER).elo, 1266.4);
});

test("en cours de concours, l'ELO affiché est celui du dernier 18 h (D54)", () => {
  assert.equal(participantRow(participant(), "ACTIVE", PET_CAREER).elo, 1251.2);
  assert.equal(participantRow(participant(), "ACTIVE", PET_CAREER).votesReceived, 34);
});

test("avant le premier 18 h, tout le monde est à 1200 et 0 vote reçu", () => {
  const fresh = participant({ eloSnapshot: DEFAULT_ELO, votesReceivedSnapshot: 0 });

  assert.equal(participantRow(fresh, "ACTIVE", PET_CAREER).elo, DEFAULT_ELO);
  assert.equal(participantRow(fresh, "ACTIVE", PET_CAREER).votesReceived, 0);
});

test("un concours clos ne bouge plus : on lit le direct, il est définitif", () => {
  assert.equal(participantRow(participant(), "CLOSED", PET_CAREER).elo, 1266.4);
  assert.equal(participantRow(participant(), "CLOSED", PET_CAREER).votesReceived, 40);
});

test("le rang, lui, sort tel quel : c'est l'instantané de 18 h", () => {
  assert.equal(participantRow(participant(), "ACTIVE", PET_CAREER).rank, 2);
  assert.equal(participantRow(participant({ rank: null }), "ACTIVE", PET_CAREER).rank, null);
});

test("une ligne de juré ne compte que ses votes jugés, jamais ceux du jour", () => {
  const row = judgeRow(judge(), contest(), 70, JUDGE_CAREER);

  // Gelés au dernier 18 h, comme l'ELO : 30 jugés, pas les 33 posés.
  assert.equal(row.votes, 30);
  // La justesse est celle de ces 30 : peindre les 3 derniers en faux serait
  // un mensonge, ils n'ont pas encore de verdict.
  assert.equal(row.correctVotes, 25);
  assert.equal(row.limit, 70);
});

test("le plafond et l'allocation sont du concours, pas de moi (D105)", () => {
  // Sans ça, un juré qui n'a jamais voté n'a pas de `me.votes` — donc pas
  // d'anneau, alors qu'il a autant de sessions manquées à voir que les autres.
  const card = contestCard("beaute", contest(), NO_ME);

  assert.equal(card.votesLimit, 70);
  assert.equal(card.votesPerDay, 10);
  assert.equal(card.me.votes, null);
});

test("un juré repris du legacy n'a pas de répartition : la somme trahit le total", () => {
  // La migration pose `votesPerDay` à zéro et garde le total (§10). C'est le
  // seul signe qui distingue « rien posé » de « on ne sait pas quand ».
  const legacy = judge({ votesPerDay: [0, 0, 0, 0, 0, 0, 0], votes: 40 });
  const row = judgeRow(legacy, contest({ status: "CLOSED", maxVotesPerDay: 5 }), 40, JUDGE_CAREER);

  assert.equal(row.castVotes, 40);
  assert.equal(row.votesPerDay.reduce((sum, value) => sum + value, 0), 0);
});

test("mon propre compteur de votes, lui, reste en direct : c'est mon budget", () => {
  const me = meWire(contest(), asJudge());

  assert.equal(me.votes?.cast, 33);
});

test("les votes du jour sortent du concours actif jugé", () => {
  // Le juré de référence en est au 4ᵉ jour : trois journées pleines, puis 3 posés.
  const votes = dailyVotesWire(
    { contest: contest(), judge: judge() },
    START + 3 * DAY_MILLIS + DAY_MILLIS / 2,
    10,
  );

  assert.deepEqual(votes, {
    remaining: 7,
    capacity: 10,
    secondsToReset: DAY_MILLIS / 2000,
  });
});

test("hors de la fenêtre du concours, il n'y a pas de journée", () => {
  const votes = dailyVotesWire(
    { contest: contest(), judge: judge() },
    START + 8 * DAY_MILLIS,
    10,
  );

  assert.deepEqual(votes, { remaining: 0, capacity: 10, secondsToReset: 0 });
});

test("sans concours jugé, la capacité reste affichable", () => {
  assert.deepEqual(dailyVotesWire(null, START, 10), {
    remaining: 0,
    capacity: 10,
    secondsToReset: 0,
  });
});

test("un animal sans date de naissance renvoie null, pas zéro", () => {
  const pet: PetDoc = {
    userUid: "zimpo",
    number: 57,
    name: "Mia",
    photoUrl: null,
    species: "DOG",
    sex: "FEMALE",
    breed: "shiba inu",
    birthDate: null,
    countryCode: "FR",
    createdAt: stamp(START),
    microchipId: null,
    verifiedAt: null,
    hiddenAt: null,
    deletedAt: null,
    grade: { level: 0 },
    stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
  };

  assert.equal(petProfile("mia", pet).birthDate, null);
  assert.equal(petProfile("mia", pet).stats.bestRank, null);
});

test("judgeSince retombe sur la création si le juré n'a jamais jugé", () => {
  const user: UserDoc = {
    name: "Zimpo",
    nickname: null,
    deletedAt: null,
    notifications: null,
    avatarUrl: null,
    description: null,
    countryCode: "FR",
    createdAt: stamp(START - 600 * DAY_MILLIS),
    fcmToken: null,
    isVerified: false,
    locale: null,
    grade: { level: 0 },
    suspendedUntil: null,
    hiddenAt: null,
    judgeNumber: null,
    judgeSince: null,
    stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
    totals: { votes: 0, correctVotes: 0 },
  };

  const wire = judgeProfile("zimpo", user);
  assert.equal(wire.judgeSince, START - 600 * DAY_MILLIS);
  assert.equal(wire.number, 0);
});

test("la part de victoires se lit sur des duels gelés comme les votes reçus", () => {
  assert.equal(participantRow(participant(), "CLOSED", PET_CAREER).duels, 58);
  // Avant le premier instantané, rien plutôt qu'un vif mêlé à un gelé.
  assert.equal(participantRow(participant(), "ACTIVE", PET_CAREER).duels, null);
  assert.equal(
    participantRow(participant({ duelsSnapshot: 47 }), "ACTIVE", PET_CAREER).duels,
    47,
  );
});

test("un partage compte une fois par personne, et jamais le propriétaire", () => {
  const shared = participant({ sharedBy: ["zimpo", "lea", "tom"] });
  // zimpo est le propriétaire : il allume son bouton sans compter.
  assert.deepEqual(shareWire(shared, "zimpo"), { shares: 2, sharedByMe: true });
  assert.deepEqual(shareWire(shared, "lea"), { shares: 2, sharedByMe: true });
  assert.deepEqual(shareWire(shared, "max"), { shares: 2, sharedByMe: false });
  assert.deepEqual(shareWire(shared, null), { shares: 2, sharedByMe: false });
  assert.deepEqual(shareWire(participant(), "lea"), { shares: 0, sharedByMe: false });
});

test("la ligne dit au lecteur s'il a déjà partagé", () => {
  const row = participantRow(participant({ sharedBy: ["lea"] }), "CLOSED", PET_CAREER, "lea");
  assert.equal(row.shares, 1);
  assert.equal(row.sharedByMe, true);
});
