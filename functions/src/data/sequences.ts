import { COUNTERS, SEQUENCES, db } from "../firebase";
import { SequencesDoc } from "../models/user";

export type SequenceName = keyof SequencesDoc;

/**
 * Les séquences globales du D83 : une par espèce, une pour les jurés, une pour
 * les concours. Incrémentées **en transaction** et jamais réutilisées — le
 * numéro est une immatriculation, pas un rang, et il est figé sur le doc à la
 * création comme le sont les numéros de concours.
 */
export async function nextSequence(
  t: FirebaseFirestore.Transaction,
  name: SequenceName,
): Promise<number> {
  const ref = db.collection(COUNTERS).doc(SEQUENCES);
  const snap = await t.get(ref);
  const stored = snap.exists ? (snap.data() as Partial<SequencesDoc>)[name] : undefined;
  const next = (typeof stored === "number" ? stored : 0) + 1;
  t.set(ref, { [name]: next }, { merge: true });
  return next;
}

export function sequenceForSpecies(species: "DOG" | "CAT"): SequenceName {
  return species === "CAT" ? "cats" : "dogs";
}
