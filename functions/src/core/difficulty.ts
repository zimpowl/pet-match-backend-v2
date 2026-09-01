export interface ScoredVote {
  /** E au moment du vote : probabilité que l'animal choisi l'emporte. */
  readonly expectedPicked: number;
  readonly isCorrect: boolean;
}

/**
 * Départage invisible des jurés (D12) : somme de (1 − E) sur les votes justes.
 * Un duel serré rapporte 0,50 ; voir juste contre le favori rapporte 0,85.
 */
export function difficultyScore(votes: readonly ScoredVote[]): number {
  return votes.reduce((sum, vote) => (vote.isCorrect ? sum + (1 - vote.expectedPicked) : sum), 0);
}
