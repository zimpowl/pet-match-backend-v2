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
 * Les liens courts de `pet-match.fr/go/<code>` : un document par source — une
 * clinique, un post, une campagne — et son compteur. Rien de personnel n'y est
 * écrit, seulement des totaux.
 */
export const LINKS = "links";

/**
 * La configuration du service, en un document. Protégée par le nettoyage, et
 * volontairement hors du code : la porte de version se rouvre par une écriture,
 * pas par un déploiement.
 */
export const CONFIGURATION = "configuration";
export const VERSION = "version";

/**
 * Le concours d'un document de sous-collection, ou null s'il n'en vient pas.
 *
 * Un `collectionGroup` ne connaît pas son parent : `judges` et `participants`
 * désignent n'importe quel `…/{id}/judges`, pas seulement `contests/{id}/…`.
 *
 * Ce garde est né de la cohabitation avec `challenges` : la migration reprenant
 * l'identifiant du challenge, les deux rendaient le même uid — on comptait
 * double en lecture, et en écriture on modifiait les données du legacy.
 * `challenges` a été supprimée le 2026-09-29. Le garde reste : il était vrai
 * avant cette raison et le demeure après, rien ne garantissant qu'aucune autre
 * collection racine ne portera jamais une sous-collection de ce nom.
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
