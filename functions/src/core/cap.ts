import { CONTEST_DAYS, DEFAULT_VOTES_PER_DAY } from "./allocation";

export const MAX_VOTES_PER_JUDGE = CONTEST_DAYS * DEFAULT_VOTES_PER_DAY;
export const PAIR_FRACTION = 3;

/**
 * Plafond de votes d'un juré sur un concours (§4.3), figé à l'activation.
 * Garde de redondance : au-delà de 21 participants la formule ne mord plus et
 * le plafond vaut 70, soit exactement 7 jours × 10 votes.
 */
export function computeMaxVotesPerJudge(participants: number): number {
  if (participants < 2) return 0;
  const pairs = (participants * (participants - 1)) / 2;
  return Math.min(MAX_VOTES_PER_JUDGE, Math.round(pairs / PAIR_FRACTION));
}
