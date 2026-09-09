import { StatsDoc } from "../models/user";

/**
 * L'échelle de grades du §4.8 (D5, D22, D23, D55, D61). Sept crans, 0 à 6.
 *
 * | 0 | NOVICE   | —                         |
 * | 1 | CONFIRMÉ | vérification manuelle     |
 * | 2 | AMATEUR  | 3 médailles               |
 * | 3 | AGUERRI  | 8 médailles               |
 * | 4 | EXPERT   | 15 médailles dont 1 or    |
 * | 5 | MAÎTRE   | 30 médailles dont 4 or    |
 * | 6 | LÉGENDE  | 60 médailles dont 12 or   |
 *
 * Trois règles qui viennent du doc et qu'on ne devine pas :
 *
 * - **Une médaille est une médaille** (D55) : or, argent et bronze pèsent
 *   pareil pour monter, sans pondération 5/3/1 — le doc l'a retirée
 *   explicitement. L'or ne compte à part qu'à partir du niveau 4, comme un
 *   plancher : en haut, la régularité ne suffit plus, il faut avoir gagné.
 * - **L'ancienneté ne compte pas** (D61) : ni concours joués, ni semaines
 *   actives. Un animal qui ne monte jamais sur un podium reste à son niveau à
 *   vie. C'est dur, et c'est le point : l'échelle mesure le succès, pas la
 *   présence.
 * - **C'est une échelle** : le niveau est le plus grand cran dont *toutes* les
 *   conditions jusqu'à lui sont remplies. Donc un profil non vérifié plafonne
 *   à 0, même médaillé. La vérification est gratuite mais **manuelle** (D42,
 *   D91) : c'est pour ça que la migration sort tout le monde à 0.
 */

export const MAX_GRADE = 6;

interface Step {
  readonly level: number;
  readonly medals: number;
  readonly gold: number;
  readonly requiresVerified: boolean;
}

/**
 * Les seuils, et rien d'autre : c'est le seul endroit à toucher pour durcir ou
 * adoucir l'échelle. Un concours par semaine et par animal (D29), un podium à
 * trois places : 60 médailles, c'est une carrière, pas une saison.
 */
const LADDER: readonly Step[] = [
  { level: 1, medals: 0, gold: 0, requiresVerified: true },
  { level: 2, medals: 3, gold: 0, requiresVerified: false },
  { level: 3, medals: 8, gold: 0, requiresVerified: false },
  { level: 4, medals: 15, gold: 1, requiresVerified: false },
  { level: 5, medals: 30, gold: 4, requiresVerified: false },
  { level: 6, medals: 60, gold: 12, requiresVerified: false },
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

  let level = 0;
  for (const step of LADDER) {
    const reached =
      (!step.requiresVerified || verified) && medals >= step.medals && gold >= step.gold;
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
