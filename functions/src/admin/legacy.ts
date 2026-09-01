/**
 * Les formes réellement présentes dans `pet-match---debug`, relevées avant
 * d'écrire la migration — pas les interfaces du backend legacy, qui mentent par
 * endroits (`birthDate` y est typé `string` alors qu'un tiers des animaux ont
 * `null`, et `petUid` est déclaré optionnel mais absent partout).
 */

export type LegacyChallengeStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "REWARDED";

export interface LegacyChallenge {
  theme?: string;
  status?: string;
  startAt?: { toMillis(): number } | null;
  endAt?: { toMillis(): number } | null;
  createdAt?: { toMillis(): number } | null;
  eloKFactor?: number;
  participantsCount?: number;
  judgesCount?: number;
}

/** Clé du doc = `userUid`. C'est ce que référencent les votes et les seenPairs. */
export interface LegacyParticipant {
  userUid: string;
  petUid?: string;
  imageUrl?: string;
  petName?: string;
  petBreed?: string;
  elo?: number;
  wins?: number;
  losses?: number;
  duelsPlayed?: number;
  rank?: number;
  createdAt?: { toMillis(): number } | null;
}

export interface LegacyJudge {
  userUid: string;
  userName?: string;
  userAvatarUrl?: string;
  votesCount?: number;
  finalCorrectVotes?: number;
  finalRank?: number;
  seenPairs?: string[];
  joinedAt?: { toMillis(): number } | null;
}

export interface LegacyVote {
  judgeUserUid: string;
  leftParticipantId: string;
  rightParticipantId: string;
  pickedParticipantId: string;
  pairKey?: string;
}

export interface LegacyPet {
  userUid: string;
  name?: string;
  species?: string;
  gender?: string;
  imageUrl?: string;
  breed?: string;
  /** `null` pour 100 animaux, sinon une date ISO « 2019-11-21 ». */
  birthDate?: unknown;
  createdAt?: { toMillis(): number } | null;
}

export interface LegacyUser {
  name?: string;
  avatarUrl?: string;
  description?: string;
  fcmToken?: string;
  createdAt?: { toMillis(): number } | null;
}
