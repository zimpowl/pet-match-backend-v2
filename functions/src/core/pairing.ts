import { pairKey } from "./elo";

export const DUELS_PER_SESSION = 8;
/** Voisins tirés de chaque côté de l'ancre, cf. §4.7. */
export const PAIRING_WINDOW = 20;

export interface PairingCandidate {
  readonly petId: string;
  readonly ownerUid: string;
  readonly elo: number;
}

export interface Duel {
  readonly aPetId: string;
  readonly bPetId: string;
}

export interface PairingOptions {
  /** Ses propres animaux sont retirés de la fenêtre. */
  readonly judgeUserUid: string;
  /** Anti-doublon par juré, pas global (D53). */
  readonly seenPairs: ReadonlySet<string>;
  readonly count?: number;
  /** Injecté pour que les tests soient déterministes. */
  readonly random?: () => number;
}

/**
 * Construit les duels d'une session à partir d'une fenêtre déjà ancrée sur
 * l'animal le moins joué (§4.7, D52). La fenêtre arrive triée ou non ; on la
 * retrie par ELO décroissant et on apparie des voisins immédiats, ce qui
 * préserve la proximité d'ELO — un duel oppose des animaux à 20-40 points
 * d'écart, soit ~56 % de chances pour le mieux classé.
 *
 * Un animal n'apparaît qu'une fois par session, et une paire déjà vue par
 * *ce* juré est sautée : on descend alors sur le voisin suivant.
 *
 * Le côté gauche/droite est tiré au sort pour qu'un ELO élevé ne soit pas
 * systématiquement en `a`.
 */
export function buildDuels(
  window: readonly PairingCandidate[],
  options: PairingOptions,
): Duel[] {
  const count = options.count ?? DUELS_PER_SESSION;
  const random = options.random ?? Math.random;

  const pool = window
    .filter((candidate) => candidate.ownerUid !== options.judgeUserUid)
    .slice()
    .sort((left, right) => right.elo - left.elo);

  const used = new Set<string>();
  const duels: Duel[] = [];

  for (let i = 0; i < pool.length && duels.length < count; i++) {
    const a = pool[i];
    if (!a || used.has(a.petId)) continue;

    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (!b || used.has(b.petId)) continue;
      if (options.seenPairs.has(pairKey(a.petId, b.petId))) continue;

      duels.push(orient(a.petId, b.petId, random));
      used.add(a.petId);
      used.add(b.petId);
      break;
    }
  }

  return duels;
}

function orient(first: string, second: string, random: () => number): Duel {
  return random() < 0.5 ?
    { aPetId: first, bPetId: second } :
    { aPetId: second, bPetId: first };
}
