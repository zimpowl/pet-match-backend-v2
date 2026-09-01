import { firestore } from "firebase-admin";

export interface StatsDoc {
  contests: number;
  bestRank: number | null;
  gold: number;
  silver: number;
  bronze: number;
}

export interface UserDoc {
  name: string;
  avatarUrl: string | null;
  description: string | null;
  countryCode: string | null;
  createdAt: firestore.Timestamp;
  fcmToken: string | null;
  isVerified: boolean;
  judgeNumber: number | null;
  judgeSince: firestore.Timestamp | null;
  stats: StatsDoc;
  totals: { votes: number; correctVotes: number };
}

/** Séquences globales, incrémentées en transaction et jamais réutilisées (D83). */
export interface SequencesDoc {
  dogs: number;
  cats: number;
  judges: number;
  contests: number;
}
