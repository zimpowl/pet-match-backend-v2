import { firestore } from "firebase-admin";

/** Ce qu'on signale : un animal, un juré, ou une participation précise. */
export type ReportTarget = "PET" | "JUDGE";

/**
 * Les motifs de la charte, et rien d'autre. Une liste fermée vaut mieux qu'un
 * champ libre : elle dit au signalant ce qui est effectivement une infraction,
 * et elle range la file de revue sans qu'on ait à lire pour trier.
 */
export type ReportReason =
  | "WELFARE"
  | "NOT_YOURS"
  | "OFF_THEME"
  | "SHOCKING"
  | "IDENTITY"
  | "OTHER";

export interface ReportDoc {
  reporterUid: string;
  target: ReportTarget;
  /** L'animal ou le juré visé. */
  targetUid: string;
  /** Le concours où la publication a été vue, quand on vient de là. */
  contestUid: string | null;
  reason: ReportReason;
  details: string | null;
  status: "OPEN" | "CLOSED";
  createdAt: firestore.Timestamp;
  reviewedAt: firestore.Timestamp | null;
}
