/**
 * Validation et normalisation des numéros de puce électronique (D68, ISO 11784/11785).
 * L'unicité globale suffit à l'anti-doublon, aucun appel externe nécessaire.
 */

/**
 * Normalise un numéro de puce électronique en retirant les espaces et
 * autres caractères non numériques.
 *
 * @param raw numéro brut fourni par l'utilisateur
 * @returns numéro normalisé (chiffres uniquement) ou null si absent/vide
 */
export function normalizeMicrochipId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, "").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Vérifie qu'un numéro de puce est valide (exactement 15 chiffres, ISO 11784/11785).
 *
 * @param value numéro de puce normalisé
 * @returns true si le numéro est valide (15 chiffres), false sinon
 */
export function isValidMicrochipId(value: string): boolean {
  return /^\d{15}$/.test(value);
}
