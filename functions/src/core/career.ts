import { StatsDoc } from "../models/user";

/**
 * Ce qu'un porteur vaut **aujourd'hui** : son grade et son palmarès.
 *
 * Une seule source de vérité pour les médailles, et c'est le document du
 * porteur — `pets/{petId}` ou `users/{userUid}`. Un concours ne garde plus de
 * copie de ce que l'animal était le jour où il s'y est inscrit : partout où un
 * profil se montre — une ligne de jury, un participant en lice, une fiche —
 * c'est le palmarès du jour qui s'affiche, et il est le même partout.
 *
 * C'est l'inverse de ce que faisaient `gradeAtEntry` et `statsAtContest`, qui
 * gelaient l'instant du concours sur chaque participation. Deux copies d'un
 * même palmarès finissent toujours par diverger — une clôture ratée, une
 * reprise de données — et le lecteur n'a aucun moyen de savoir laquelle ment.
 */
export interface Career {
  readonly level: number;
  readonly stats: StatsDoc;
}

/** Les palmarès d'une page, par identifiant de porteur. */
export type Careers = ReadonlyMap<string, Career>;

export const EMPTY_STATS: StatsDoc = {
  contests: 0,
  bestRank: null,
  gold: 0,
  silver: 0,
  bronze: 0,
};

export const EMPTY_CAREER: Career = { level: 0, stats: EMPTY_STATS };

/** Le palmarès lu sur un document d'animal ou de juré, trous comblés. */
export function careerOf(
  source: { grade?: { level?: number }; stats?: Partial<StatsDoc> } | undefined,
): Career {
  return {
    level: source?.grade?.level ?? 0,
    stats: {
      contests: source?.stats?.contests ?? 0,
      bestRank: source?.stats?.bestRank ?? null,
      gold: source?.stats?.gold ?? 0,
      silver: source?.stats?.silver ?? 0,
      bronze: source?.stats?.bronze ?? 0,
    },
  };
}
