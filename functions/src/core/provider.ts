/**
 * Ce que le fournisseur a donné, quand ça vaut la peine d'être gardé.
 *
 * Une identité Apple masquée arrive sous le nom **« Anonyme »** : le poser dans
 * le formulaire reviendrait à proposer ce pseudo-là par défaut, et un
 * classement d'Anonymes ne dit rien. Les chaînes vides tombent pour la même
 * raison — mieux vaut un champ vide qu'un champ à effacer.
 *
 * Sans effet de bord : l'outil d'admin qui reprend les comptes déjà créés
 * l'importe aussi, et la liste ne vit qu'ici.
 */
export const ANONYMOUS = ["anonyme", "anonymous", "unknown"];

export function isAnonymous(value: string): boolean {
  return ANONYMOUS.includes(value.trim().toLowerCase());
}

export function fromProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return isAnonymous(trimmed) ? null : trimmed;
}
