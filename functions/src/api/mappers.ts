import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
} from "../models/contest";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import {
  ContestCardWire,
  ContestMeWire,
  ContestStatusWire,
  DailyVotesWire,
  DuelPetWire,
  JudgeRowWire,
  JudgeWire,
  ParticipantRowWire,
  PetWire,
  StatsWire,
} from "./contract";
import { toMillisOrZero, toMillis } from "../core/time";
import {
  contestDayIndex,
  remainingVotesToday,
  secondsToReset,
} from "../core/allocation";
import { DEFAULT_ELO } from "../core/elo";

/** Ce que le juré et le participant de *ce* user valent sur *ce* concours. */
export interface MeSource {
  readonly participant: ContestParticipantDoc | null;
  readonly judge: ContestJudgeDoc | null;
}

export const NO_ME: MeSource = { participant: null, judge: null };

export function meWire(contest: ContestDoc, source: MeSource): ContestMeWire {
  const { participant, judge } = source;

  if (participant) {
    return {
      role: "PARTICIPANT",
      rank: participant.rank,
      registrationIndex: participant.registrationIndex,
      pet: {
        petUid: participant.petId,
        name: participant.petName,
        photoUrl: participant.photoUrl,
      },
      votes: judge ? judgeVotes(contest, judge) : null,
      // Même règle que partout : l'instantané du dernier 18 h, et la valeur
      // vive seulement une fois le concours clos (D54).
      elo: contest.status === "CLOSED" ?
        participant.elo :
        participant.eloSnapshot ?? DEFAULT_ELO,
      votesReceived: contest.status === "CLOSED" ?
        participant.votesReceived :
        participant.votesReceivedSnapshot ?? 0,
      level: participant.gradeAtEntry ?? 0,
      career: stats(participant.statsAtContest),
      // Un participant a sa propre photo : il n'emprunte rien au vainqueur.
      winner: null,
    };
  }

  if (judge) {
    return {
      role: "JUDGE",
      rank: judge.rank,
      registrationIndex: judge.registrationIndex,
      pet: null,
      votes: judgeVotes(contest, judge),
      // Pas d'ELO pour les jurés (D17), et rien de reçu : ils donnent.
      elo: 0,
      votesReceived: 0,
      level: judge.gradeAtEntry ?? 0,
      career: stats(judge.statsAtContest),
      winner: judge.winner ?
        {
          petUid: judge.winner.petId,
          name: judge.winner.name,
          photoUrl: judge.winner.photoUrl,
        } :
        null,
    };
  }

  return {
    role: "NONE",
    rank: null,
    registrationIndex: null,
    pet: null,
    votes: null,
    elo: 0,
    votesReceived: 0,
    level: 0,
    career: stats(undefined),
    winner: null,
  };
}

/**
 * `judged` est le nombre de votes déjà tranchés — ceux du dernier 18 h. Les
 * votes posés depuis n'ont pas encore de verdict : les compter faux les
 * peindrait en rouge à tort, et voter ferait chuter sa propre précision. Le
 * dénominateur, c'est donc ce qui est jugé, jamais ce qui vient d'être posé.
 */
function judgeVotes(contest: ContestDoc, judge: ContestJudgeDoc) {
  const judged = contest.status === "CLOSED" ? judge.votes : judge.votesSnapshot ?? 0;

  return {
    cast: judge.votes,
    limit: contest.maxVotesPerJudge,
    judged,
    correct: judge.correctVotes,
    wrong: Math.max(0, judged - judge.correctVotes),
  };
}

export function contestCard(
  contestUid: string,
  contest: ContestDoc,
  source: MeSource = NO_ME,
): ContestCardWire {
  return {
    uid: contestUid,
    number: contest.number,
    theme: contest.theme,
    status: contest.status,
    startAt: toMillisOrZero(contest.startAt),
    endAt: toMillisOrZero(contest.endAt),
    counts: {
      judges: contest.counts?.judges ?? 0,
      participants: contest.counts?.participants ?? 0,
    },
    me: meWire(contest, source),
  };
}

/**
 * Tout ce qui touche au classement est l'**instantané de 18 h** (D54, §4.2 bis) :
 * ELO, votes reçus et rang sortent tels qu'ils étaient au dernier 18 h, jamais
 * en direct. Avant le premier instantané — donc du dimanche 18 h au lundi 18 h —
 * tout le monde est à 1200 et 0 vote reçu, ce qui est la vérité de ce moment.
 *
 * Un concours clos ne bouge plus : ses valeurs vives *sont* définitives, on les
 * lit directement plutôt que d'exiger un dernier instantané du job de 18 h.
 */
export function participantRow(
  participant: ContestParticipantDoc,
  status: ContestStatusWire,
): ParticipantRowWire {
  return {
    petUid: participant.petId,
    ownerUid: participant.ownerUid,
    number: participant.petNumber,
    name: participant.petName,
    breed: participant.petBreed,
    species: participant.species,
    sex: participant.sex ?? null,
    photoUrl: participant.photoUrl ?? null,
    elo: status === "CLOSED" ?
      participant.elo :
      participant.eloSnapshot ?? DEFAULT_ELO,
    votesReceived: status === "CLOSED" ?
      participant.votesReceived :
      participant.votesReceivedSnapshot ?? 0,
    rank: participant.rank,
    registrationIndex: participant.registrationIndex,
    level: participant.gradeAtEntry ?? 0,
    career: stats(participant.statsAtContest),
  };
}

/**
 * Même règle pour les jurés : les votes posés sortent gelés au dernier 18 h,
 * puisque c'est sur eux que porte le classement « jurés les plus actifs » (D11).
 * La justesse, elle, n'est pas gelée mais **inconnue** avant la clôture (§4.9) —
 * une précision provisoire reculerait certains soirs sans que le juré ait rien
 * fait. Mon propre compteur de votes reste en direct : il vit dans `me.votes`,
 * c'est mon budget et pas le classement des autres.
 */
export function judgeRow(
  judge: ContestJudgeDoc,
  status: ContestStatusWire,
  limit: number,
): JudgeRowWire {
  return {
    userUid: judge.userUid,
    number: judge.judgeNumber,
    name: judge.userName,
    avatarUrl: judge.userAvatarUrl,
    judgeSince: toMillisOrZero(judge.joinedAt),
    votes: status === "CLOSED" ? judge.votes : judge.votesSnapshot ?? 0,
    castVotes: judge.votes,
    correctVotes: judge.correctVotes,
    limit,
    rank: judge.rank,
    registrationIndex: judge.registrationIndex,
    level: judge.gradeAtEntry ?? 0,
    career: stats(judge.statsAtContest),
  };
}

export function duelPet(participant: ContestParticipantDoc): DuelPetWire {
  return {
    petUid: participant.petId,
    name: participant.petName,
    photoUrl: participant.photoUrl ?? null,
  };
}

function stats(source: StatsWire | undefined): StatsWire {
  return {
    contests: source?.contests ?? 0,
    bestRank: source?.bestRank ?? null,
    gold: source?.gold ?? 0,
    silver: source?.silver ?? 0,
    bronze: source?.bronze ?? 0,
  };
}

export function judgeProfile(userUid: string, user: UserDoc): JudgeWire {
  return {
    userUid,
    number: user.judgeNumber ?? 0,
    name: user.name,
    avatarUrl: user.avatarUrl,
    judgeSince: toMillisOrZero(user.judgeSince ?? user.createdAt),
    countryCode: user.countryCode,
    level: user.grade?.level ?? 0,
    stats: stats(user.stats),
  };
}

export function petProfile(petUid: string, pet: PetDoc): PetWire {
  return {
    petUid,
    number: pet.number,
    name: pet.name,
    photoUrl: pet.photoUrl,
    species: pet.species,
    breed: pet.breed,
    sex: pet.sex,
    birthDate: toMillis(pet.birthDate),
    countryCode: pet.countryCode,
    level: pet.grade?.level ?? 0,
    stats: stats(pet.stats),
  };
}

/** Le concours actif dont le juré tire son allocation du jour. */
export interface DailyVotesSource {
  readonly contest: ContestDoc;
  readonly judge: ContestJudgeDoc | null;
}

/**
 * Les trois entiers du §5, renvoyés dans chaque réponse. Sans concours actif
 * jugé, la capacité reste celle du concours ou le défaut : afficher `0 / 0`
 * ne dirait rien au joueur.
 */
export function dailyVotesWire(
  source: DailyVotesSource | null,
  nowMillis: number,
  defaultCapacity: number,
): DailyVotesWire {
  if (!source) {
    return { remaining: 0, capacity: defaultCapacity, secondsToReset: 0 };
  }

  const startAt = toMillisOrZero(source.contest.startAt);
  const capacity = source.contest.maxVotesPerDay || defaultCapacity;
  const day = contestDayIndex(nowMillis, startAt);

  if (day === null) return { remaining: 0, capacity, secondsToReset: 0 };

  // Pas de document juré ne veut pas dire « plus de votes » mais « il n'a
  // encore rien posé » (D95) : son allocation est entière. Le document naîtra
  // de son premier vote.
  const votesPerDay = source.judge?.votesPerDay ?? [];

  return {
    remaining: remainingVotesToday(votesPerDay, day, capacity),
    capacity,
    secondsToReset: secondsToReset(nowMillis, startAt),
  };
}
