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
  tier: number;
  maxVotesPerJudge: number;
  maxVotesPerDay: number;
  eloKFactor: number;
  counts: { participants: number; judges: number };
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
  petGradeAtEntry: number;
  registrationIndex: number;
  elo: number;
  wins: number;
  losses: number;
  duels: number;
  votesReceived: number;
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
  judgeGradeAtEntry: number;
  votesPerDay: number[];
  votes: number;
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
  expectedPicked: number;
  createdAt: firestore.Timestamp;
}
