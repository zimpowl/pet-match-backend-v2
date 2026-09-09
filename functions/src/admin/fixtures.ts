import { CONTEST_DAYS, DAY_MILLIS } from "../core/allocation";
import { DEFAULT_ELO } from "../core/elo";
import { computeMaxVotesPerJudge, computeVotesPerDay } from "../core/cap";
import { ContestStatus, Sex, Species } from "../models/contest";

/**
 * Le jeu de données de debug, calqué sur `FakeContest.kt` : mêmes thèmes,
 * mêmes noms, mêmes effectifs, `zimpo` en 8ᵉ position. Une fois seedé,
 * passer `useFakeBackendV2` à `false` doit montrer le même écran.
 */

export const NEWEST_NUMBER = 14;
export const OLDEST_NUMBER = 1;
export const PARTICIPANT_COUNT = 31;
export const JUDGE_COUNT = 24;
/** Index où l'on se place soi-même, dans les deux listes. */
export const MINE_POSITION = 7;
export const MY_UID = "zimpo";
export const MY_PET_ID = "heureux";

export const THEMES = [
  "Cadrage serré", "Chien heureux", "Pleine lune", "En plein vol", "Noir et blanc",
  "Premier pas", "Grand sommeil", "Regard fixe", "Dernière lueur", "Sur le sable",
  "Portraits d'hiver", "Show de printemps", "Concours d'été", "Trophée d'automne",
];

export const NAMES = [
  "Uno", "Heureux", "Pablo", "Nala", "Simba", "Mia", "Volt", "Iris",
  "Tao", "Luna", "Django", "Nino", "Sasha", "Kira", "Milo", "Enzo",
];

export const BREEDS = [
  "chien d'arrêt allemand à poil dur", "berger australien", "beagle", "border collie",
  "chat européen", "shiba inu", "cavalier king charles", "chartreux",
];

export function photo(id: number): string {
  return `https://placedog.net/300/300?id=${id}`;
}

/** Le dimanche 18 h le plus récent : le départ du concours en cours (D8, D88). */
export function currentContestStart(nowMillis: number): number {
  const date = new Date(nowMillis);
  date.setHours(18, 0, 0, 0);
  const daysSinceSunday = (date.getDay() + 7) % 7;
  const candidate = date.getTime() - daysSinceSunday * DAY_MILLIS;
  return candidate <= nowMillis ? candidate : candidate - CONTEST_DAYS * DAY_MILLIS;
}

export interface ContestFixture {
  readonly uid: string;
  readonly number: number;
  readonly theme: string;
  readonly status: ContestStatus;
  readonly startAt: number;
  readonly endAt: number;
  readonly participants: number;
  readonly judges: number;
  readonly maxVotesPerJudge: number;
  readonly maxVotesPerDay: number;
  /** Nombre de 18 h passés depuis le départ, donc de journées jouées : 0 à 7. */
  readonly snapshotDay: number;
  /** null tant qu'aucun 18 h n'est passé — le premier tombe le lundi (D87). */
  readonly snapshotAt: number | null;
}

/**
 * `age` 0 = le concours à venir, créé une semaine à l'avance (D88) ;
 * 1 = celui qui se joue ; au-delà = l'historique.
 */
export function contestFixture(number: number, nowMillis: number): ContestFixture {
  const age = NEWEST_NUMBER - number;
  const status: ContestStatus = age === 0 ? "DRAFT" : age === 1 ? "ACTIVE" : "CLOSED";
  const startAt = currentContestStart(nowMillis) - (age - 1) * CONTEST_DAYS * DAY_MILLIS;
  const endAt = startAt + CONTEST_DAYS * DAY_MILLIS;
  const draft = status === "DRAFT";
  const participants = draft ? 0 : PARTICIPANT_COUNT;
  const maxVotesPerJudge = computeMaxVotesPerJudge(participants);
  const elapsed = Math.floor((nowMillis - startAt) / DAY_MILLIS);
  const snapshotDay = draft ? 0 : Math.max(0, Math.min(CONTEST_DAYS, elapsed));

  return {
    uid: `contest-${number}`,
    number,
    theme: THEMES[(number - 1) % THEMES.length] ?? "Sans thème",
    status,
    startAt,
    endAt,
    participants,
    judges: draft ? 0 : JUDGE_COUNT,
    maxVotesPerJudge,
    maxVotesPerDay: computeVotesPerDay(participants),
    snapshotDay,
    // Le premier instantané tombe le lundi 18 h, un jour après le départ.
    snapshotAt: snapshotDay >= 1 ? startAt + snapshotDay * DAY_MILLIS : null,
  };
}

/** Part du concours déjà jouée au dernier 18 h : ce que l'instantané reflète. */
function snapshotFraction(contest: ContestFixture): number {
  return contest.snapshotDay / CONTEST_DAYS;
}

export interface ParticipantFixture {
  readonly petId: string;
  readonly ownerUid: string;
  readonly petNumber: number;
  readonly petName: string;
  readonly petBreed: string;
  readonly species: Species;
  readonly sex: Sex;
  readonly photoUrl: string;
  readonly registrationIndex: number;
  readonly elo: number;
  readonly wins: number;
  readonly losses: number;
  readonly duels: number;
  readonly votesReceived: number;
  readonly eloSnapshot: number;
  readonly votesReceivedSnapshot: number;
  readonly rank: number | null;
}

export function participantFixture(
  index: number,
  contest: ContestFixture,
): ParticipantFixture {
  // Mon animal porte les valeurs exactes de `FakeProfileApi` : c'est la ligne
  // qu'on regarde en premier quand on bascule `useFakeBackendV2`.
  const mine = index === MINE_POSITION;
  const petNumber = mine ? 34 : 30 + index * 7;
  const votesReceived = Math.max(0, 320 - index * 8);
  const duels = Math.round(votesReceived * 1.45);
  const elo = contest.status === "DRAFT" ? DEFAULT_ELO : 1300 - index * 9;

  return {
    petId: mine ? MY_PET_ID : `pet-${index}`,
    ownerUid: mine ? MY_UID : `user-${index}`,
    petNumber,
    petName: mine ? "Heureux" : NAMES[index % NAMES.length] ?? "Sans nom",
    petBreed: mine ?
      "chien d'arrêt allemand à poil dur" :
      BREEDS[index % BREEDS.length] ?? "sans race",
    species: mine ? "DOG" : index % 5 === 4 ? "CAT" : "DOG",
    sex: mine || index % 2 === 0 ? "MALE" : "FEMALE",
    photoUrl: photo(mine ? 42 : petNumber),
    registrationIndex: index + 1,
    elo,
    wins: votesReceived,
    losses: Math.max(0, duels - votesReceived),
    duels,
    votesReceived,
    // L'instantané est en retard sur le direct, exactement comme dans le jeu.
    eloSnapshot: DEFAULT_ELO + (elo - DEFAULT_ELO) * snapshotFraction(contest),
    votesReceivedSnapshot: Math.round(votesReceived * snapshotFraction(contest)),
    rank: contest.snapshotAt === null ? null : index + 1,
  };
}

export interface JudgeFixture {
  readonly userUid: string;
  readonly judgeNumber: number;
  readonly userName: string;
  readonly userAvatarUrl: string;
  readonly registrationIndex: number;
  readonly votesPerDay: number[];
  readonly votes: number;
  readonly votesSnapshot: number;
  readonly correctVotes: number;
  readonly difficultyScore: number;
  readonly rank: number | null;
}

export function judgeFixture(
  index: number,
  contest: ContestFixture,
  nowMillis: number,
): JudgeFixture {
  const mine = index === MINE_POSITION;
  const judgeNumber = mine ? 12 : 12 + index * 5;
  const votesPerDay = seedVotesPerDay(contest, nowMillis);
  const votes = votesPerDay.reduce((sum, value) => sum + value, 0);

  return {
    userUid: mine ? MY_UID : `judge-${index}`,
    judgeNumber,
    userName: mine ? "Zimpo" : NAMES[(index + 3) % NAMES.length] ?? "Sans nom",
    userAvatarUrl: photo(judgeNumber),
    registrationIndex: index + 1,
    votesPerDay,
    votes,
    // Les journées pleines closes au dernier 18 h, pas les votes d'aujourd'hui.
    votesSnapshot: votesPerDay
      .slice(0, contest.snapshotDay)
      .reduce((sum, value) => sum + value, 0),
    correctVotes: Math.max(0, Math.min(votes, 68 - index * 2)),
    difficultyScore: Math.max(0, 31.2 - index * 0.7),
    rank: contest.snapshotAt === null ? null : index + 1,
  };
}

/**
 * Un concours clos a ses sept journées pleines ; un concours en cours a les
 * journées passées pleines et trois votes posés aujourd'hui — de quoi voir
 * `7 / 10` dans la barre du haut (§4.9).
 */
function seedVotesPerDay(contest: ContestFixture, nowMillis: number): number[] {
  const perDay = contest.maxVotesPerDay;
  if (contest.status === "DRAFT") return new Array<number>(CONTEST_DAYS).fill(0);
  if (contest.status === "CLOSED") return new Array<number>(CONTEST_DAYS).fill(perDay);

  const today = Math.floor((nowMillis - contest.startAt) / DAY_MILLIS);
  return Array.from({ length: CONTEST_DAYS }, (_unused, day) => {
    if (day < today) return perDay;
    if (day === today) return Math.min(3, perDay);
    return 0;
  });
}
