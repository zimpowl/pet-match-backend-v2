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
import {
  NO_ME,
  contestCard,
  dailyVotesWire,
  judgeProfile,
  judgeRow,
  meWire,
  participantRow,
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
    counts: { participants: 31, judges: 24 },
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
    registrationIndex: 8,
    gradeAtEntry: 2,
    statsAtContest: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
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
    hiddenAt: null,
    photoUrl: "https://placedog.net/300/300?id=42",
    registrationIndex: 8,
    gradeAtEntry: 3,
    statsAtContest: { contests: 6, bestRank: 2, gold: 1, silver: 2, bronze: 0 },
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

test("sans inscription, le bloc me est vide et ne ment pas", () => {
  assert.deepEqual(meWire(contest(), NO_ME), {
    role: "NONE",
    rank: null,
    registrationIndex: null,
    pet: null,
    bearer: null,
    votes: null,
    elo: 0,
    votesReceived: 0,
    level: 0,
    career: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
    winner: null,
  });
});

test("la slab close sert l'identité qui a signé, pas le profil vivant (D128)", () => {
  const asParticipant = meWire(contest(), { participant: participant(), judge: null });
  assert.deepEqual(asParticipant.bearer, {
    name: participant().petName,
    photoUrl: participant().photoUrl,
    photoRemoved: false,
    subtext: participant().petBreed,
  });

  const asJudge = meWire(contest(), { participant: null, judge: judge() });
  assert.deepEqual(asJudge.bearer, {
    name: judge().userName,
    photoUrl: judge().userAvatarUrl,
    photoRemoved: false,
    subtext: null,
  });

  // Une photo retirée par la modération n'est plus servie, mais elle existe.
  const hidden = meWire(contest(), {
    participant: participant({ hiddenAt: stamp(START) }),
    judge: null,
  });
  assert.equal(hidden.bearer?.photoUrl, null);
  assert.equal(hidden.bearer?.photoRemoved, true);
  assert.equal(hidden.pet?.photoUrl, null);
});

test("en cours, seuls les votes du dernier 18 h sont jugés (D93)", () => {
  const me = meWire(contest(), { participant: null, judge: judge() });

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
  const me = meWire(contest({ status: "CLOSED" }), {
    participant: null,
    judge: judge({ votes: 70, correctVotes: 52 }),
  });

  assert.deepEqual(me.votes, {
    cast: 70,
    judged: 70,
    correct: 52,
    wrong: 18,
    votesPerDay: [10, 10, 10, 3, 0, 0, 0],
  });
});

test("voter ne fait jamais chuter sa précision : le dénominateur ne bouge qu'à 18 h", () => {
  const before = meWire(contest(), { participant: null, judge: judge() });
  const afterVoting = meWire(contest(), {
    participant: null,
    judge: judge({ votes: 38 }),
  });

  assert.equal(before.votes?.judged, afterVoting.votes?.judged);
  assert.equal(before.votes?.correct, afterVoting.votes?.correct);
});

test("l'ELO de mon animal suit la même règle d'instantané (D54)", () => {
  const running = meWire(contest(), { participant: participant(), judge: null });
  const closed = meWire(contest({ status: "CLOSED" }), {
    participant: participant(),
    judge: null,
  });

  assert.equal(running.elo, 1251.2);
  assert.equal(closed.elo, 1266.4);
});

test("l'ELO n'est jamais seul : les votes reçus l'accompagnent (§4.9, D62)", () => {
  const running = meWire(contest(), { participant: participant(), judge: null });
  const closed = meWire(contest({ status: "CLOSED" }), {
    participant: participant(),
    judge: null,
  });

  assert.equal(running.votesReceived, 34);
  assert.equal(closed.votesReceived, 40);
});

test("un juré n'a pas d'ELO (D17)", () => {
  assert.equal(meWire(contest(), { participant: null, judge: judge() }).elo, 0);
});

test("participant : le rôle porte l'animal, le rang est le sien", () => {
  const me = meWire(contest(), { participant: participant(), judge: null });

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

test("la slab dit ce que le porteur était ce jour-là, pas ce qu'il est devenu (D30)", () => {
  const me = meWire(contest(), { participant: participant(), judge: null });

  assert.equal(me.level, 3);
  assert.deepEqual(me.career, { contests: 6, bestRank: 2, gold: 1, silver: 2, bronze: 0 });
});

test("un juré emprunte son image au vainqueur, un participant jamais", () => {
  const asJudge = meWire(contest(), {
    participant: null,
    judge: judge({ winner: { petId: "uno", name: "Uno", photoUrl: "http://p" } }),
  });

  assert.deepEqual(asJudge.winner, { petUid: "uno", name: "Uno", photoUrl: "http://p" });
  assert.equal(meWire(contest(), { participant: participant(), judge: null }).winner, null);
});

test("participant ET juré : le rôle est participant, les votes restent visibles", () => {
  const me = meWire(contest(), { participant: participant(), judge: judge() });

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
  assert.deepEqual(participantRow(participant(), "CLOSED"), {
    petUid: "heureux",
    ownerUid: "zimpo",
    number: 34,
    name: "Heureux",
    breed: "berger australien",
    species: "DOG",
    sex: "MALE",
    photoUrl: "https://placedog.net/300/300?id=42",
    photoRemoved: false,
    elo: 1266.4,
    votesReceived: 40,
    rank: 2,
    registrationIndex: 8,
    // De quoi imprimer l'étiquette d'identité du haut, gelée au jour de
    // l'inscription (D30) : c'est ce que la slab dira dans trois mois.
    level: 3,
    career: { contests: 6, bestRank: 2, gold: 1, silver: 2, bronze: 0 },
  });

  assert.deepEqual(judgeRow(judge(), contest({ status: "CLOSED" }), 70), {
    userUid: "zimpo",
    number: 12,
    name: "Zimpo",
    avatarUrl: null,
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
  assert.equal(participantRow(participant(), "CLOSED").elo, 1266.4);
});

test("en cours de concours, l'ELO affiché est celui du dernier 18 h (D54)", () => {
  assert.equal(participantRow(participant(), "ACTIVE").elo, 1251.2);
  assert.equal(participantRow(participant(), "ACTIVE").votesReceived, 34);
});

test("avant le premier 18 h, tout le monde est à 1200 et 0 vote reçu", () => {
  const fresh = participant({ eloSnapshot: DEFAULT_ELO, votesReceivedSnapshot: 0 });

  assert.equal(participantRow(fresh, "ACTIVE").elo, DEFAULT_ELO);
  assert.equal(participantRow(fresh, "ACTIVE").votesReceived, 0);
});

test("un concours clos ne bouge plus : on lit le direct, il est définitif", () => {
  assert.equal(participantRow(participant(), "CLOSED").elo, 1266.4);
  assert.equal(participantRow(participant(), "CLOSED").votesReceived, 40);
});

test("le rang, lui, sort tel quel : c'est l'instantané de 18 h", () => {
  assert.equal(participantRow(participant(), "ACTIVE").rank, 2);
  assert.equal(participantRow(participant({ rank: null }), "ACTIVE").rank, null);
});

test("une ligne de juré ne compte que ses votes jugés, jamais ceux du jour", () => {
  const row = judgeRow(judge(), contest(), 70);

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
  const row = judgeRow(legacy, contest({ status: "CLOSED", maxVotesPerDay: 5 }), 40);

  assert.equal(row.castVotes, 40);
  assert.equal(row.votesPerDay.reduce((sum, value) => sum + value, 0), 0);
});

test("mon propre compteur de votes, lui, reste en direct : c'est mon budget", () => {
  const me = meWire(contest(), { participant: null, judge: judge() });

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
    rulesSignedAt: null,
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
