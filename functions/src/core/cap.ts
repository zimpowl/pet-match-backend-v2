import { CONTEST_DAYS } from "./allocation";

/**
 * Deux paliers, pas une formule (D85). La version calculée
 * `min(70, round(C(P,2)/3))` est **remplacée** : plus simple à annoncer, plus
 * simple à régler, et elle garde la propriété qui compte —
 * `7 jours × allocation = plafond`.
 *
 * Les deux valeurs sont **stockées sur le concours** et figées à l'activation
 * (D41), donc réglables à la main sans redéploiement : une slab sait sous
 * quelles règles elle a été jouée.
 */
export const PARTICIPANTS_THRESHOLD = 20;
export const SMALL_VOTES_PER_DAY = 5;
export const LARGE_VOTES_PER_DAY = 10;
export const SMALL_MAX_VOTES_PER_JUDGE = SMALL_VOTES_PER_DAY * CONTEST_DAYS;
export const LARGE_MAX_VOTES_PER_JUDGE = LARGE_VOTES_PER_DAY * CONTEST_DAYS;

/** Le plafond quand on ne connaît pas encore l'effectif du concours. */
export const DEFAULT_VOTES_PER_DAY = LARGE_VOTES_PER_DAY;

export function computeVotesPerDay(participants: number): number {
  return participants > PARTICIPANTS_THRESHOLD ? LARGE_VOTES_PER_DAY : SMALL_VOTES_PER_DAY;
}

export function computeMaxVotesPerJudge(participants: number): number {
  return participants > PARTICIPANTS_THRESHOLD ?
    LARGE_MAX_VOTES_PER_JUDGE :
    SMALL_MAX_VOTES_PER_JUDGE;
}
