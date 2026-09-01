import { firestore } from "firebase-admin";

export type ContestStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type Species = "DOG" | "CAT";

export interface ContestDoc {
  theme: string;
  number: number;
  status: ContestStatus;
  createdAt: firestore.Timestamp;
  startAt: firestore.Timestamp;
  endAt: firestore.Timestamp;
  maxVotesPerJudge: number;
  maxVotesPerDay: number;
  eloKFactor: number;
  counts: { participants: number; judges: number };
  /**
   * Horodatage du dernier instantané de 18 h (D54, §4.2 bis). Null jusqu'au
   * premier — le lundi 18 h : d'ici là les listes sortent dans l'ordre
   * d'inscription inversé (D87) et tout le monde est à 1200 / 0 vote reçu.
   * Posé par le job de 18 h du lot L4, qui est son seul écrivain.
   */
  snapshotAt: firestore.Timestamp | null;
}

/** Clé = petId. */
export interface ContestParticipantDoc {
  petId: string;
  ownerUid: string;
  petNumber: number;
  petName: string;
  petBreed: string | null;
  species: Species;
  photoUrl: string;
  registrationIndex: number;
  /** En direct, à chaque vote. Lu par l'appariement, jamais par l'utilisateur. */
  elo: number;
  wins: number;
  losses: number;
  duels: number;
  /** En direct aussi : c'est le compteur, pas ce qu'on affiche. */
  votesReceived: number;
  /**
   * Ce que l'utilisateur voit : l'ELO et les votes reçus **au dernier 18 h**
   * (D54). Deux lecteurs, un seul est humain — l'appariement lit le direct,
   * l'écran lit l'instantané. Recopiés depuis les champs vifs par le job de
   * 18 h, et valant 1200 / 0 avant le premier.
   */
  eloSnapshot: number;
  votesReceivedSnapshot: number;
  rank: number | null;
  rankPrevious: number | null;
  createdAt: firestore.Timestamp;
}

/** Clé = userUid. */
export interface ContestJudgeDoc {
  userUid: string;
  judgeNumber: number;
  userName: string;
  userAvatarUrl: string | null;
  /** Rang du premier tour, comme pour les participants (D87). */
  registrationIndex: number;
  votesPerDay: number[];
  /** En direct : c'est mon budget et mon objectif, pas un classement (§4.9). */
  votes: number;
  /** Les votes posés au dernier 18 h — le classement « jurés les plus actifs ». */
  votesSnapshot: number;
  correctVotes: number;
  difficultyScore: number;
  rank: number | null;
  rankPrevious: number | null;
  seenPairs: string[];
  joinedAt: firestore.Timestamp;
}

/** Clé = `${pairKey}_${userUid}`. */
export interface ContestVoteDoc {
  judgeUserUid: string;
  aPetId: string;
  bPetId: string;
  pickedPetId: string;
  /**
   * Clé de paire pour compter le partage des voix (§3.1). Nécessaire car
   * aPetId/bPetId ne sont pas triés (orientation tirée au sort).
   */
  pairKey: string;
  expectedPicked: number;
  createdAt: firestore.Timestamp;
}
