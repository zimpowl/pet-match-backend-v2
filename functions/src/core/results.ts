import { ScoredVote, difficultyScore } from "./difficulty";

/**
 * Le dénouement d'un concours (§4.5, §2.1). C'est le seul endroit où la
 * **justesse** d'un vote se décide, et elle ne se décide qu'à la clôture :
 *
 *   un vote est juste si l'animal choisi finit avec un ELO **final**
 *   strictement supérieur à son adversaire **de ce duel**
 *
 * Trois précisions qui se perdent facilement :
 * - c'est l'ELO *final*, pas celui du moment du vote. Si c'était celui du
 *   moment, « je clique toujours sur le plus haut » serait une stratégie
 *   parfaite ; comme l'appariement oppose des voisins, copier plafonne à ~55 %
 *   contre 87 % pour qui regarde vraiment ;
 * - la comparaison est *interne au duel*, pas au plateau : choisir le moins
 *   mauvais de deux mal classés est juste ;
 * - l'égalité est neutre, jamais juste. Avec l'ELO en flottant (D16) elle
 *   n'arrive pratiquement jamais.
 */

export interface CountedVote {
  readonly judgeUserUid: string;
  readonly pickedPetId: string;
  readonly aPetId: string;
  readonly bPetId: string;
  /** E au moment du vote, écrit par `submitVote`. 0 sur l'historique migré. */
  readonly expectedPicked: number;
}

export interface JudgeResult {
  readonly votes: number;
  readonly correctVotes: number;
  readonly difficultyScore: number;
}

/**
 * null quand un des deux animaux n'a pas d'ELO final connu : le vote n'est ni
 * juste ni faux, il est indécidable, et il ne compte pas.
 */
export function isVoteCorrect(
  vote: CountedVote,
  eloByPetId: ReadonlyMap<string, number>,
): boolean | null {
  const other = vote.pickedPetId === vote.aPetId ? vote.bPetId : vote.aPetId;
  const picked = eloByPetId.get(vote.pickedPetId);
  const opponent = eloByPetId.get(other);
  if (picked === undefined || opponent === undefined) return null;
  return picked > opponent;
}

/**
 * Les résultats de tous les jurés en une passe. `difficultyScore` est la somme
 * de (1 − E) sur les votes justes (D12) : un duel serré rapporte 0,50, voir
 * juste contre le favori rapporte 0,85. Pas de malus, jamais (§4.5).
 */
export function judgeResults(
  votes: readonly CountedVote[],
  eloByPetId: ReadonlyMap<string, number>,
): Map<string, JudgeResult> {
  const scored = new Map<string, ScoredVote[]>();
  const counted = new Map<string, number>();

  for (const vote of votes) {
    const correct = isVoteCorrect(vote, eloByPetId);
    if (correct === null) continue;

    counted.set(vote.judgeUserUid, (counted.get(vote.judgeUserUid) ?? 0) + 1);
    const list = scored.get(vote.judgeUserUid) ?? [];
    list.push({ expectedPicked: vote.expectedPicked, isCorrect: correct });
    scored.set(vote.judgeUserUid, list);
  }

  const results = new Map<string, JudgeResult>();
  for (const [judgeUserUid, list] of scored) {
    results.set(judgeUserUid, {
      votes: counted.get(judgeUserUid) ?? 0,
      correctVotes: list.filter((vote) => vote.isCorrect).length,
      difficultyScore: difficultyScore(list),
    });
  }
  return results;
}

export type Medal = "gold" | "silver" | "bronze";

/** Le podium reste à 3 places quelle que soit la taille du concours (§4.8). */
export function medalFromRank(rank: number | null): Medal | null {
  switch (rank) {
  case 1:
    return "gold";
  case 2:
    return "silver";
  case 3:
    return "bronze";
  default:
    return null;
  }
}
