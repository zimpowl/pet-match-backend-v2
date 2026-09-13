import { firestore } from "firebase-admin";

/** Qui demande à être confirmé : le juré lui-même, ou l'un de ses animaux. */
export type VerificationTarget = "JUDGE" | "PET";

export type VerificationStatus = "NONE" | "PENDING" | "REJECTED" | "VERIFIED";

/**
 * Une pièce déposée. On ne garde que le **chemin** dans le bucket, jamais une
 * URL de téléchargement : une carte d'identité n'est pas une photo de chien, et
 * une URL signée qui traîne dans un document est une fuite qui attend son tour.
 * La revue est humaine (D42), et la pièce s'efface à la décision (D126).
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
  status: Exclude<VerificationStatus, "NONE" | "VERIFIED">;
  createdAt: firestore.Timestamp;
  reviewedAt: firestore.Timestamp | null;
  reason: string | null;
}
