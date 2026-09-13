import { StatsDoc } from "../models/user";

/**
 * L'échelle de grades du §4.8 (D5, D22, D23, D55, D61, D123). Sept crans, 0 à 6.
 *
 * | 0 | NOVICE   | dès l'inscription                    |
 * | 1 | CONFIRMÉ | 4 concours **et** identité vérifiée  |
 * | 2 | AMATEUR  | 1 médaille                           |
 * | 3 | AGUERRI  | 3 médailles                          |
 * | 4 | EXPERT   | 6 médailles dont 1 or                |
 * | 5 | MAÎTRE   | 10 médailles dont 2 or               |
 * | 6 | LÉGENDE  | 15 médailles dont 5 or               |
 *
 * Trois règles qui viennent du doc et qu'on ne devine pas :
 *
 * - **Une médaille est une médaille** (D55) : or, argent et bronze pèsent
 *   pareil pour monter, sans pondération 5/3/1 — le doc l'a retirée
 *   explicitement. L'or ne compte à part qu'à partir du niveau 4, comme un
 *   plancher : en haut, la régularité ne suffit plus, il faut avoir gagné.
 * - **La présence ouvre la porte, elle ne fait pas monter** (D123) : les quatre
 *   concours ne servent qu'au cran 1, avec la pièce d'identité. Au-dessus, un
 *   animal qui ne monte jamais sur un podium reste à son niveau à vie.
 * - **C'est une échelle** : le niveau est le plus grand cran dont *toutes* les
 *   conditions jusqu'à lui sont remplies. Donc un profil non vérifié plafonne
 *   à 0, même médaillé. La vérification est gratuite mais **manuelle** (D42,
 *   D91) : c'est pour ça que la migration sort tout le monde à 0.
 */

export const MAX_GRADE = 6;

interface Step {
  readonly level: number;
  readonly contests: number;
  readonly medals: number;
  readonly gold: number;
  readonly requiresVerified: boolean;
}

/**
 * Les seuils, et rien d'autre : c'est le seul endroit à toucher pour durcir ou
 * adoucir l'échelle. Un concours par semaine et par animal (D29), un podium à
 * trois places : quinze médailles dont cinq or, c'est une carrière.
 */
const LADDER: readonly Step[] = [
  { level: 1, contests: 4, medals: 0, gold: 0, requiresVerified: true },
  { level: 2, contests: 0, medals: 1, gold: 0, requiresVerified: false },
  { level: 3, contests: 0, medals: 3, gold: 0, requiresVerified: false },
  { level: 4, contests: 0, medals: 6, gold: 1, requiresVerified: false },
  { level: 5, contests: 0, medals: 10, gold: 2, requiresVerified: false },
  { level: 6, contests: 0, medals: 15, gold: 5, requiresVerified: false },
];

export function medalCount(stats: Partial<StatsDoc> | undefined): number {
  return (stats?.gold ?? 0) + (stats?.silver ?? 0) + (stats?.bronze ?? 0);
}

export function computeGradeLevel(
  stats: Partial<StatsDoc> | undefined,
  verified: boolean,
): number {
  const medals = medalCount(stats);
  const gold = stats?.gold ?? 0;
  const contests = stats?.contests ?? 0;

  let level = 0;
  for (const step of LADDER) {
    const reached =
      (!step.requiresVerified || verified) &&
      contests >= step.contests &&
      medals >= step.medals &&
      gold >= step.gold;
    if (!reached) break;
    level = step.level;
  }
  return level;
}

/**
 * Un niveau ne redescend jamais (D30) : retirer un accès déjà acquis est la
 * pire sensation possible, et c'est aussi ce qui fait de l'étagère une
 * carrière. D'où le fait de **stocker** le grade plutôt que de le recalculer à
 * la lecture — un recalcul le ferait baisser si la vérification tombait.
 */
export function raiseGradeLevel(current: number | undefined, computed: number): number {
  return Math.max(current ?? 0, computed);
}
