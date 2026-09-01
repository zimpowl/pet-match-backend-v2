import { ContestStatus } from "../models/contest";

/**
 * Tous les gardes d'un vote, en une fonction pure. Les traduire en statuts HTTP
 * est le travail de la couche `api/` — ici on ne fait que nommer la raison.
 */
export type VoteRejection =
  /** Le concours n'est pas en cours, ou `now` est hors de sa fenêtre de 7 jours. */
  | "CONTEST_NOT_RUNNING"
  | "PAIR_IDENTICAL"
  | "PICK_OUTSIDE_PAIR"
  /** L'un des deux animaux n'est pas inscrit à ce concours. */
  | "PARTICIPANT_MISSING"
  /** Un juré ne juge jamais ses propres animaux. */
  | "OWN_PET"
  /** Anti-doublon par juré, pas global (D53) : chaque paire est jugeable une fois par juré. */
  | "PAIR_ALREADY_JUDGED"
  /** Plafond du concours atteint — « Complet », il faut revenir la semaine suivante (§4.3). */
  | "CAP_REACHED"
  /** Allocation du jour épuisée. Elle ne se cumule pas : demain 18 h (D37). */
  | "DAILY_ALLOCATION_SPENT";

export interface VoteInput {
  readonly status: ContestStatus;
  /** `contestDayIndex(now, startAt)` — null si hors fenêtre. */
  readonly day: number | null;
  readonly aPetId: string;
  readonly bPetId: string;
  readonly pickedPetId: string;
  readonly judgeUserUid: string;
  /** null quand l'animal n'est pas inscrit à ce concours. */
  readonly aOwnerUid: string | null;
  readonly bOwnerUid: string | null;
  readonly pairKey: string;
  readonly seenPairs: ReadonlySet<string>;
  readonly votesCast: number;
  readonly maxVotesPerJudge: number;
  readonly votesToday: number;
  readonly maxVotesPerDay: number;
}

export function rejectVote(input: VoteInput): VoteRejection | null {
  if (input.aPetId === input.bPetId) return "PAIR_IDENTICAL";
  if (input.pickedPetId !== input.aPetId && input.pickedPetId !== input.bPetId) {
    return "PICK_OUTSIDE_PAIR";
  }
  if (input.status !== "ACTIVE" || input.day === null) return "CONTEST_NOT_RUNNING";
  if (input.aOwnerUid === null || input.bOwnerUid === null) return "PARTICIPANT_MISSING";
  if (input.aOwnerUid === input.judgeUserUid || input.bOwnerUid === input.judgeUserUid) {
    return "OWN_PET";
  }
  if (input.seenPairs.has(input.pairKey)) return "PAIR_ALREADY_JUDGED";
  if (input.votesCast >= input.maxVotesPerJudge) return "CAP_REACHED";
  if (input.votesToday >= input.maxVotesPerDay) return "DAILY_ALLOCATION_SPENT";
  return null;
}
