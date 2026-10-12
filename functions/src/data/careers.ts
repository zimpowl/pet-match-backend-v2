import { PETS, USERS, db } from "../firebase";
import { Career, Careers, EMPTY_CAREER, careerOf } from "../core/career";

/**
 * Les palmarès du jour, lus là où ils vivent.
 *
 * Une ligne de concours ne porte plus son propre instantané : pour afficher
 * les médailles d'un participant ou d'un juré, on relit son document. C'est
 * une lecture ponctuelle par porteur, groupée en un seul aller-retour, et
 * seulement sur les champs qui comptent.
 *
 * Le coût est réel et assumé : le détail d'un concours paie une lecture par
 * animal en lice et par juré listé. C'est le prix d'une source unique — la
 * seule alternative serait de recopier le palmarès sur chaque participation à
 * chaque clôture, donc de réécrire tout l'historique d'un porteur chaque fois
 * qu'il gagne une médaille.
 */
async function loadCareers(
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Career>> {
  const result = new Map<string, Career>();
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  if (unique.length === 0) return result;

  const snaps = await db.getAll(
    ...unique.map((id) => db.collection(collection).doc(id)),
    { fieldMask: ["grade", "stats"] },
  );
  for (const snap of snaps) {
    result.set(snap.id, snap.exists ? careerOf(snap.data()) : EMPTY_CAREER);
  }
  return result;
}

export const loadPetCareers = (petIds: readonly string[]) => loadCareers(PETS, petIds);

export const loadJudgeCareers = (userUids: readonly string[]) => loadCareers(USERS, userUids);

export function careerFrom(careers: Careers, id: string | null | undefined): Career {
  return (id && careers.get(id)) || EMPTY_CAREER;
}
