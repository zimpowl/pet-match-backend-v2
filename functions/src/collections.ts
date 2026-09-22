/** Les six collections du §3, plus les compteurs du D83. */
export const USERS = "users";
export const PETS = "pets";
export const CONTESTS = "contests";
export const PARTICIPANTS = "participants";
export const JUDGES = "judges";
export const VOTES = "votes";
export const COUNTERS = "counters";
export const SEQUENCES = "sequences";

/** Les demandes de confirmation d'identité (D126), juré comme animal. */
export const VERIFICATIONS = "verifications";

/** Les signalements de la charte (D129), lus par une personne. */
export const REPORTS = "reports";

/**
 * Le concours d'un document de sous-collection, ou null s'il n'en vient pas.
 *
 * Un `collectionGroup` ne connaît pas son parent : `judges` et `participants`
 * désignent aussi bien `contests/{id}/…` que `challenges/{id}/…`, et le legacy
 * tourne encore sur le second. La migration reprenant l'identifiant du
 * challenge, les deux rendent le même uid — en lecture on compte double, en
 * écriture on modifierait les données du legacy.
 *
 * Ce module ne touche pas à `firebase.ts` : les outils d'admin initialisent
 * leur propre application, et l'importer y déclencherait un second
 * `initializeApp` sans projet.
 */
export function contestOf(
  ref: FirebaseFirestore.DocumentReference,
): FirebaseFirestore.DocumentReference | null {
  const contest = ref.parent.parent;
  return contest?.parent.id === CONTESTS ? contest : null;
}
