export const DEFAULT_ELO = 1200;
export const DEFAULT_K_FACTOR = 24;

export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Identique à la v1, sans l'arrondi : l'ELO est stocké en flottant (D16) pour
 * que le classement des participants n'ait pas d'ex aequo artificiels.
 */
export function calculateUpdatedElo(
  currentRating: number,
  expectedScore: number,
  actualScore: 0 | 1,
  kFactor: number = DEFAULT_K_FACTOR,
): number {
  return currentRating + kFactor * (actualScore - expectedScore);
}

/** Clé d'une paire, déterministe quel que soit l'ordre. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
