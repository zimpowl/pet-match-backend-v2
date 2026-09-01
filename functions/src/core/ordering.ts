/**
 * L'ordre des listes avant le premier classement (D87, §4.12).
 *
 * Tant que le concours n'a pas eu son premier résultat — le lundi 18 h —
 * participants et jurés sortent dans l'ordre d'inscription inversé, dernier
 * inscrit en tête. À partir du premier résultat, les deux listes passent au
 * classement et n'en changent plus. Le tri est fait côté serveur, par
 * Firestore : ces deux constantes sont ce qu'on passe à `orderBy`.
 */
export interface ListOrder {
  readonly field: "rank" | "registrationIndex";
  readonly direction: "asc" | "desc";
}

export const RANK_ORDER: ListOrder = { field: "rank", direction: "asc" };
export const REGISTRATION_ORDER: ListOrder = {
  field: "registrationIndex",
  direction: "desc",
};

/**
 * `snapshotAt` est posé par le job de 18 h. Pas d'instantané = pas de
 * classement : c'est le même fait, dit une seule fois.
 */
export function hasSnapshot(snapshotAtMillis: number | null): boolean {
  return snapshotAtMillis !== null;
}

export function listOrder(snapshotAtMillis: number | null): ListOrder {
  return hasSnapshot(snapshotAtMillis) ? RANK_ORDER : REGISTRATION_ORDER;
}
