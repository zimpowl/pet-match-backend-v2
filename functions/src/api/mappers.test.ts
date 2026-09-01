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
    userAvatarUrl: null,
    registrationIndex: 8,
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

test("sans inscription, le bloc me est vide et ne ment pas", () => {
  assert.deepEqual(meWire(contest(), NO_ME), {
    role: "NONE",
    rank: null,
    registrationIndex: null,
    pet: null,
    votes: null,
  });
});

test("concours en cours : la justesse n'est pas encore connue (§4.9)", () => {
  const me = meWire(contest(), { participant: null, judge: judge() });

  assert.equal(me.role, "JUDGE");
  assert.deepEqual(me.votes, { cast: 33, limit: 70, correct: 0, wrong: 0 });
});

test("à la clôture, justes et faux apparaissent", () => {
  const me = meWire(contest({ status: "CLOSED" }), {
    participant: null,
    judge: judge({ votes: 70, correctVotes: 52 }),
  });

  assert.deepEqual(me.votes, { cast: 70, limit: 70, correct: 52, wrong: 18 });
});

test("participant : le rôle porte l'animal, le rang est le sien", () => {
  const me = meWire(contest(), { participant: participant(), judge: null });

  assert.equal(me.role, "PARTICIPANT");
  assert.equal(me.rank, 2);
  assert.deepEqual(me.pet, {
    petUid: "heureux",
    name: "Heureux",
    photoUrl: "https://placedog.net/300/300?id=42",
  });
  assert.equal(me.votes, null);
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
    photoUrl: "https://placedog.net/300/300?id=42",
    elo: 1266.4,
    votesReceived: 40,
    rank: 2,
    registrationIndex: 8,
  });

  assert.deepEqual(judgeRow(judge(), "CLOSED"), {
    userUid: "zimpo",
    number: 12,
    name: "Zimpo",
    avatarUrl: null,
    judgeSince: START,
    votes: 33,
    correctVotes: 25,
    rank: 4,
    registrationIndex: 8,
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

test("pendant le concours, un juré est classé sur les votes posés (D11)", () => {
  const row = judgeRow(judge(), "ACTIVE");

  // Gelés au dernier 18 h, comme l'ELO : 30 posés, pas les 33 d'aujourd'hui.
  assert.equal(row.votes, 30);
  assert.equal(row.correctVotes, 0);
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
    stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
  };

  assert.equal(petProfile("mia", pet).birthDate, null);
  assert.equal(petProfile("mia", pet).stats.bestRank, null);
});

test("judgeSince retombe sur la création si le juré n'a jamais jugé", () => {
  const user: UserDoc = {
    name: "Zimpo",
    avatarUrl: null,
    description: null,
    countryCode: "FR",
    createdAt: stamp(START - 600 * DAY_MILLIS),
    fcmToken: null,
    isVerified: false,
    judgeNumber: null,
    judgeSince: null,
    stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
    totals: { votes: 0, correctVotes: 0 },
  };

  const wire = judgeProfile("zimpo", user);
  assert.equal(wire.judgeSince, START - 600 * DAY_MILLIS);
  assert.equal(wire.number, 0);
});
