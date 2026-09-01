export interface RankableJudge {
  readonly correctVotes: number;
  readonly votes: number;
  readonly difficultyScore: number;
  readonly joinedAt: number;
}

export interface RankableParticipant {
  readonly elo: number;
  readonly wins: number;
  readonly duels: number;
  readonly createdAt: number;
}

/**
 * Départage à quatre étages (§4.5) : bons votes, puis votes posés, puis score
 * de difficulté, puis antériorité.
 */
export function compareJudges(a: RankableJudge, b: RankableJudge): number {
  return (
    b.correctVotes - a.correctVotes ||
    b.votes - a.votes ||
    b.difficultyScore - a.difficultyScore ||
    a.joinedAt - b.joinedAt
  );
}

/** ELO flottant, puis taux de victoire, puis antériorité. */
export function compareParticipants(a: RankableParticipant, b: RankableParticipant): number {
  return b.elo - a.elo || winRate(b) - winRate(a) || a.createdAt - b.createdAt;
}

export function rank<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}

function winRate(participant: RankableParticipant): number {
  return participant.duels > 0 ? participant.wins / participant.duels : 0;
}
