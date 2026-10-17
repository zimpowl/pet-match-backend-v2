import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
} from "../models/contest";
import { GradeDoc } from "../models/grade";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import {
  GradeDatesWire,
  ContestCardWire,
  ContestMeWire,
  ContestStatusWire,
  DailyVotesWire,
  DuelPetWire,
  JudgeRowWire,
  JudgeWire,
  ParticipantRowWire,
  PetWire,
  ShareWire,
  StatsWire,
} from "./contract";
import { toMillisOrZero, toMillis } from "../core/time";
import {
  contestDayIndex,
  remainingVotesToday,
  secondsToReset,
} from "../core/allocation";
import { DEFAULT_ELO } from "../core/elo";
import { Career, EMPTY_CAREER } from "../core/career";

/**
 * Ce que le juré et le participant de *ce* user valent sur *ce* concours.
 *
 * Les deux palmarès sont ceux du **jour**, lus sur `pets/{petId}` et
 * `users/{userUid}` : une participation ne fige plus rien. Ils sont portés ici
 * plutôt que relus dans le mapper parce qu'un mapper ne touche pas la base —
 * c'est l'appelant qui les charge, en un aller-retour pour toute la page.
 */
export interface MeSource {
  /** Celui qui lit, pour dire s'il a déjà partagé la carte. */
  readonly viewerUid?: string | null;
  readonly participant: ContestParticipantDoc | null;
  readonly judge: ContestJudgeDoc | null;
  readonly petCareer: Career;
  readonly judgeCareer: Career;
}

export const NO_ME: MeSource = {
  participant: null,
  judge: null,
  petCareer: EMPTY_CAREER,
  judgeCareer: EMPTY_CAREER,
};

export function meWire(contest: ContestDoc, source: MeSource): ContestMeWire {
  const { participant, judge } = source;

  if (participant) {
    const hidden = participant.hiddenAt != null;
    return {
      role: "PARTICIPANT",
      rank: participant.rank,
      rankPrevious: participant.rankPrevious ?? null,
      registrationIndex: participant.registrationIndex,
      pet: {
        petUid: participant.petId,
        name: participant.petName,
        photoUrl: hidden ? null : participant.photoUrl,
        photoRemoved: hidden,
      },
      bearer: {
        name: participant.petName,
        photoUrl: hidden ? null : participant.photoUrl,
        photoRemoved: hidden,
        subtext: participant.petBreed,
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
      duels: frozenDuels(participant, contest.status),
      ...shareWire(participant, source.viewerUid ?? null),
      level: source.petCareer.level,
      career: stats(source.petCareer.stats),
      // Un participant a sa propre photo : il n'emprunte rien au vainqueur.
      winner: null,
    };
  }

  if (judge) {
    return {
      role: "JUDGE",
      rank: judge.rank,
      rankPrevious: null,
      registrationIndex: judge.registrationIndex,
      pet: null,
      bearer: {
        name: judge.userName,
        photoUrl: judge.hiddenAt ? null : judge.userAvatarUrl,
        photoRemoved: judge.hiddenAt != null,
        subtext: null,
      },
      votes: judgeVotes(contest, judge),
      // Pas d'ELO pour les jurés (D17), et rien de reçu : ils donnent.
      elo: 0,
      votesReceived: 0,
      duels: null,
      shares: 0,
      sharedByMe: false,
      level: source.judgeCareer.level,
      career: stats(source.judgeCareer.stats),
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
    judged,
    correct: judge.correctVotes,
    wrong: Math.max(0, judged - judge.correctVotes),
    votesPerDay: judge.votesPerDay ?? [],
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
    votesLimit: contest.maxVotesPerJudge,
    votesPerDay: contest.maxVotesPerDay,
    endAt: toMillisOrZero(contest.endAt),
    counts: {
      judges: contest.counts.judges,
      participants: contest.counts.participants,
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
 *
 * Le **palmarès**, lui, échappe à cette règle : il n'est pas du concours, il
 * est de l'animal. `career` et `level` sont donc ceux d'aujourd'hui, les mêmes
 * que sur sa fiche, et c'est l'appelant qui les a lus sur `pets/{petId}`.
 */
export function participantRow(
  participant: ContestParticipantDoc,
  status: ContestStatusWire,
  career: Career,
  viewerUid: string | null = null,
): ParticipantRowWire {
  return {
    petUid: participant.petId,
    ownerUid: participant.ownerUid,
    number: participant.petNumber,
    name: participant.petName,
    breed: participant.petBreed,
    species: participant.species,
    sex: participant.sex ?? null,
    countryCode: participant.countryCode,
    photoUrl: participant.hiddenAt ? null : participant.photoUrl ?? null,
    photoRemoved: participant.hiddenAt != null,
    elo: status === "CLOSED" ?
      participant.elo :
      participant.eloSnapshot ?? DEFAULT_ELO,
    votesReceived: status === "CLOSED" ?
      participant.votesReceived :
      participant.votesReceivedSnapshot ?? 0,
    duels: frozenDuels(participant, status),
    ...shareWire(participant, viewerUid),
    rank: participant.rank,
    rankPrevious: participant.rankPrevious ?? null,
    registrationIndex: participant.registrationIndex,
    level: career.level,
    career: stats(career.stats),
  };
}

/**
 * Même règle pour les jurés : les votes posés sortent gelés au dernier 18 h,
 * puisque c'est sur eux que porte le classement « jurés les plus actifs » (D11).
 * La justesse, elle, n'est pas gelée mais **inconnue** avant la clôture (§4.9) —
 * une précision provisoire reculerait certains soirs sans que le juré ait rien
 * fait. Mon propre compteur de votes reste en direct : il vit dans `me.votes`,
 * c'est mon budget et pas le classement des autres.
 *
 * Le palmarès est celui du jour, comme chez le participant : il appartient au
 * juré, pas au concours qu'il a jugé.
 */
export function judgeRow(
  judge: ContestJudgeDoc,
  contest: ContestDoc,
  limit: number,
  career: Career,
): JudgeRowWire {
  return {
    userUid: judge.userUid,
    number: judge.judgeNumber,
    name: judge.userName,
    avatarUrl: judge.hiddenAt ? null : judge.userAvatarUrl,
    photoRemoved: judge.hiddenAt != null,
    countryCode: judge.countryCode,
    judgeSince: toMillisOrZero(judge.joinedAt),
    votes: contest.status === "CLOSED" ? judge.votes : judge.votesSnapshot ?? 0,
    castVotes: judge.votes,
    correctVotes: judge.correctVotes,
    limit,
    perDay: contest.maxVotesPerDay,
    votesPerDay: judge.votesPerDay ?? [],
    rank: judge.rank,
    registrationIndex: judge.registrationIndex,
    level: career.level,
    career: stats(career.stats),
  };
}

export function duelPet(participant: ContestParticipantDoc): DuelPetWire {
  return {
    petUid: participant.petId,
    name: participant.petName,
    photoUrl: participant.photoUrl ?? null,
    elo: participant.elo,
  };
}

export function stats(source: StatsWire | undefined): StatsWire {
  return {
    contests: source?.contests ?? 0,
    bestRank: source?.bestRank ?? null,
    gold: source?.gold ?? 0,
    silver: source?.silver ?? 0,
    bronze: source?.bronze ?? 0,
  };
}

const CLOSED_ACCOUNT = "Compte supprimé";

export function judgeProfile(userUid: string, user: UserDoc): JudgeWire {
  return {
    userUid,
    number: user.judgeNumber ?? 0,
    // Un compte fermé ne s'annonce plus par son nom. Les concours déjà joués
    // gardent le leur, dénormalisé sur le document juré : c'est la trace qui
    // reste, pas l'identité.
    name: user.deletedAt ? CLOSED_ACCOUNT : user.nickname ?? user.name,
    avatarUrl: user.hiddenAt ? null : user.avatarUrl,
    avatarRemoved: user.hiddenAt != null,
    judgeSince: toMillisOrZero(user.judgeSince ?? user.createdAt),
    countryCode: user.countryCode,
    level: user.grade?.level ?? 0,
    gradeReachedAt: gradeDates(user.grade),
    stats: stats(user.stats),
  };
}

export function petProfile(petUid: string, pet: PetDoc, owned = false): PetWire {
  return {
    microchipId: owned ? pet.microchipId ?? null : null,
    photoRemoved: pet.hiddenAt != null,
    petUid,
    userUid: pet.userUid,
    number: pet.number,
    name: pet.name,
    photoUrl: pet.hiddenAt ? null : pet.photoUrl,
    species: pet.species,
    breed: pet.breed,
    sex: pet.sex,
    birthDate: toMillis(pet.birthDate),
    countryCode: pet.countryCode,
    level: pet.grade?.level ?? 0,
    gradeReachedAt: gradeDates(pet.grade),
    stats: stats(pet.stats),
  };
}

/** Les dates du dossier voyagent en millisecondes, comme tout le reste. */
function gradeDates(grade: GradeDoc | undefined): GradeDatesWire {
  return Object.fromEntries(
    Object.entries(grade?.reachedAt ?? {}).map(([level, at]) => [level, at.toMillis()]),
  );
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

/**
 * Les duels qui vont avec les votes reçus affichés : les vifs une fois le
 * concours clos, l'instantané de 18 h avant. Sans instantané — une
 * participation née avant le champ —, null plutôt qu'une part fausse.
 */
export function frozenDuels(
  participant: ContestParticipantDoc,
  status: ContestStatusWire,
): number | null {
  if (status === "CLOSED") return participant.duels;
  return participant.duelsSnapshot ?? null;
}

/** Voir `ShareWire` : le propriétaire allume son bouton sans compter. */
export function shareWire(
  participant: ContestParticipantDoc,
  viewerUid: string | null,
): ShareWire {
  const sharedBy = participant.sharedBy ?? [];
  return {
    shares: sharedBy.filter((uid) => uid !== participant.ownerUid).length,
    sharedByMe: viewerUid != null && sharedBy.includes(viewerUid),
  };
}
