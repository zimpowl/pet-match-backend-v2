import { firestore } from "firebase-admin";

/** Qui demande à être confirmé : le juré lui-même, ou l'un de ses animaux. */
export type VerificationTarget = "JUDGE" | "PET";

export type VerificationStatus = "NONE" | "PENDING" | "REJECTED" | "VERIFIED";

/**
 * Une pièce déposée. On ne garde que le **chemin** dans le bucket, jamais une
 * URL de téléchargement : une carte d'identité n'est pas une photo de chien, et
 * une URL signée qui traîne dans un document est une fuite qui attend son tour.
 * La revue est humaine (D42), et la pièce **reste** après la décision : c'est
 * la trace de ce qui a été confirmé.
 */
export interface VerificationFileDoc {
  path: string;
  contentType: string | null;
}

export interface VerificationDoc {
  userUid: string;
  target: VerificationTarget;
  /** L'animal concerné, null pour une demande de juré. */
  petUid: string | null;
  files: VerificationFileDoc[];
  /**
   * L'état de la **demande**. `NONE` n'en est pas un : il décrit l'absence de
   * demande, côté app. Les trois autres sont des états réels qu'une demande
   * traverse, et `VERIFIED` est terminal — la confirmation elle-même reste
   * portée par `pets/{uid}.verifiedAt` ou `users/{uid}.isVerified`, qui font
   * foi. Ce champ dit ce qu'est devenue la demande, rien de plus.
   */
  status: Exclude<VerificationStatus, "NONE">;
  createdAt: firestore.Timestamp;
  reviewedAt: firestore.Timestamp | null;
  reason: string | null;
}
