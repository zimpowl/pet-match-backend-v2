/**
 * Calcule le partage des voix pour un duel (§4.5 bis).
 * Retour immédiat après un vote, sans ELO ni rang ni justesse.
 */

/**
 * Calcule les pourcentages de partage des voix pour les deux participants d'un duel.
 * Les deux entiers doivent sommer à 100.
 *
 * @param aVotes nombre de votes pour le participant A
 * @param bVotes nombre de votes pour le participant B
 * @returns objet avec les pourcentages a et b (sommant à 100)
 */
export function sharePercents(aVotes: number, bVotes: number): { a: number; b: number } {
  const total = aVotes + bVotes;

  // Cas particulier : aucun vote (0/0)
  if (total === 0) {
    return { a: 50, b: 50 };
  }

  // Calcul standard avec arrondi
  const aPercent = Math.round((aVotes / total) * 100);
  const bPercent = 100 - aPercent; // garantit que a + b = 100

  return { a: aPercent, b: bPercent };
}
