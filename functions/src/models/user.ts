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
  /**
   * Langue de lecture, écrite par l'app depuis la langue du téléphone. C'est
   * le bon signal : un Français à Berlin veut du français, et `countryCode`
   * parle de l'animal (ICAD), pas de la langue. Absent = français.
   */
  locale: string | null;
  /**
   * Grade de juré (§4.8). Stocké et non recalculé : un niveau ne redescend
   * jamais (D30), et le recalculer le ferait baisser si la vérification
   * tombait. Relevé par la clôture, jamais baissé.
   */
  grade: { level: number };
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
