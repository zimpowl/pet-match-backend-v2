import { ContestStatus } from "../models/contest";

/**
 * Les gardes de l'inscription d'un participant. Le D39 est la règle qui compte :
 * un participant s'inscrit pendant `DRAFT` **uniquement**. Il faut connaître le
 * nombre de participants pour figer le plafond (§4.3), et ça supprime le
 * problème de l'inscrit tardif qui joue moins de duels que les autres.
 *
 * Les jurés, eux, n'ont pas d'inscription : ils rejoignent un concours `ACTIVE`
 * à tout moment, et leur doc naît de leur premier vote.
 */
export type JoinRejection =
  | "CONTEST_NOT_DRAFT"
  | "NOT_OWNER"
  /** La clé `participants/{petUid}` suffit à empêcher le doublon (D89). */
  | "ALREADY_REGISTERED"
  /**
   * La photo est le seul levier du propriétaire sur le résultat (§4.2 bis) et
   * elle est imprimée sur la slab : s'inscrire sans photo n'a pas de sens.
   */
  | "PET_HAS_NO_PHOTO";

export interface JoinInput {
  readonly status: ContestStatus;
  readonly petOwnerUid: string;
  readonly callerUid: string;
  readonly alreadyRegistered: boolean;
  /**
   * La photo **de l'inscription**, pas celle du profil de l'animal : c'est
   * elle qui sera imprimée sur la slab, et c'est donc elle qui doit exister.
   */
  readonly photoUrl: string | null;
}

export function rejectJoin(input: JoinInput): JoinRejection | null {
  if (input.petOwnerUid !== input.callerUid) return "NOT_OWNER";
  if (input.status !== "DRAFT") return "CONTEST_NOT_DRAFT";
  if (input.alreadyRegistered) return "ALREADY_REGISTERED";
  if (!input.photoUrl) return "PET_HAS_NO_PHOTO";
  return null;
}
