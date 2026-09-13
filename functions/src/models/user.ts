import { firestore } from "firebase-admin";

export interface StatsDoc {
  contests: number;
  bestRank: number | null;
  gold: number;
  silver: number;
  bronze: number;
}

export interface UserDoc {
  /**
   * Le nom du compte social. On le garde — c'est lui qui a signé les concours
   * du legacy — mais on ne l'affiche plus : sur iOS il vaut « Anonyme » pour
   * qui a masqué son identité Apple, et un classement d'Anonymes ne dit rien.
   */
  name: string;
  /** Le nom qui signe les votes, choisi par le joueur. Affiché partout. */
  nickname: string | null;
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
  /**
   * Ce que le joueur accepte de recevoir. Absent vaut **oui** : personne n'a
   * rien coupé, et un défaut à `false` rendrait muet tout le parc migré.
   * Deux interrupteurs seulement, parce qu'il n'y a que deux canaux (§ notify) :
   * le résultat du soir, et le rappel de l'après-midi.
   */
  notifications: { results: boolean; reminders: boolean } | null;
  /**
   * Compte fermé. Rien n'est effacé : les concours joués gardent le nom et la
   * photo qui les ont signés, et les votes restent comptés — les retirer
   * fausserait l'ELO de tous les autres. Ce qui disparaît, c'est **l'identité
   * vivante** : pseudo, avatar et jeton de notification.
   */
  deletedAt: firestore.Timestamp | null;
  /**
   * Signature du règlement (D125). Null tant qu'il n'a pas été signé, et c'est
   * une **porte** : on ne se nomme pas et on ne vote pas avant. La date est
   * gardée parce qu'un règlement se signe à une version et à un instant — c'est
   * elle qu'on réaffiche, et c'est elle qui fera foi le jour où le texte change.
   */
  rulesSignedAt: firestore.Timestamp | null;
  /**
   * Suspension temporaire (D133). Le compte garde tout et ne peut plus agir
   * jusqu'à cette date. Null = jamais suspendu ; une date passée = suspension
   * purgée, qu'on garde parce qu'elle a eu lieu.
   */
  suspendedUntil: firestore.Timestamp | null;
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
