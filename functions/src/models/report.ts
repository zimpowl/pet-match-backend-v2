import { firestore } from "firebase-admin";

/** Ce qu'on signale : un animal, ou un juré. */
export type ReportTarget = "PET" | "JUDGE";

/**
 * Un signalement dit **qui** signale **quoi**, et rien de plus. Pas de motif à
 * choisir : la liste en demandait trop à qui veut juste dire « regardez ça »,
 * et elle triait une file qu'une personne lit de toute façon en entier.
 */
export interface ReportDoc {
  reporterUid: string;
  target: ReportTarget;
  targetUid: string;
  /**
   * L'image telle qu'elle était affichée. Un animal en porte plusieurs — celle
   * de sa fiche, et une par inscription qu'il a pu changer — et le geste de
   * modération ne doit taire que celle-là.
   */
  photoUrl: string | null;
  status: "OPEN" | "CLOSED";
  createdAt: firestore.Timestamp;
  reviewedAt: firestore.Timestamp | null;
}
