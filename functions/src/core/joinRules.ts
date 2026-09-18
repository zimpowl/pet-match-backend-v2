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

/**
 * Les gardes d'une inscription **déjà posée** qu'on veut reprendre : changer sa
 * photo, ou l'annuler. La fenêtre est celle du D39, à l'identique — tant que le
 * concours est en `DRAFT`, l'inscription n'engage rien ; dès qu'il est `ACTIVE`
 * elle est en course, les duels se jouent contre elle, et l'en sortir referait
 * le classement des autres.
 */
export type EntryRejection =
  | "NOT_REGISTERED"
  | "NOT_OWNER"
  | "CONTEST_NOT_DRAFT"
  | "PET_HAS_NO_PHOTO";

export interface EntryChangeInput {
  readonly status: ContestStatus;
  /** null quand l'animal n'est pas inscrit à ce concours. */
  readonly participantOwnerUid: string | null;
  readonly callerUid: string;
  /** La nouvelle photo. Ignorée par un retrait, qui n'en demande aucune. */
  readonly photoUrl: string | null;
  /** Faux pour un retrait : il n'y a alors rien à imprimer. */
  readonly requiresPhoto: boolean;
}

export function rejectEntryChange(input: EntryChangeInput): EntryRejection | null {
  if (input.participantOwnerUid === null) return "NOT_REGISTERED";
  if (input.participantOwnerUid !== input.callerUid) return "NOT_OWNER";
  if (input.status !== "DRAFT") return "CONTEST_NOT_DRAFT";
  if (input.requiresPhoto && !input.photoUrl) return "PET_HAS_NO_PHOTO";
  return null;
}
