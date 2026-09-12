import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PETS, db } from "../firebase";
import { PetDoc } from "../models/pet";
import { PetRejection, readPetInput } from "../core/petInput";
import { PetWire } from "./contract";
import { petProfile } from "./mappers";
import { nextSequence, sequenceForSpecies } from "../data/sequences";
import {
  HttpError,
  JsonResponse,
  Query,
  badRequest,
  conflict,
  forbidden,
  notFound,
  requiredField,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Création d'un animal. Le numéro vient de la séquence globale de l'espèce
 * (D83) : incrémenté en transaction, jamais réutilisé, figé sur le doc — c'est
 * une immatriculation, pas un rang.
 *
 * Le numéro de puce est le socle de l'anti-doublon (D68) : son unicité globale
 * suffit, aucun appel externe. L'ICAD n'est qu'un enrichissement.
 */
export const createPetHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<PetWire> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);

    const parsed = readPetInput(body);
    if (!parsed.ok) throw petError(parsed.rejection);
    const input = parsed.input;

    const now = Date.now();
    const petRef = db.collection(PETS).doc();

    const created = await db.runTransaction(async (t) => {
      await assertMicrochipFree(t, input.microchipId, petRef.id);
      const number = await nextSequence(t, sequenceForSpecies(input.species));

      const pet: PetDoc = {
        userUid,
        number,
        name: input.name,
        photoUrl: input.photoUrl,
        species: input.species,
        sex: input.sex,
        breed: input.breed,
        birthDate: input.birthDate === null ? null : Timestamp.fromMillis(input.birthDate),
        countryCode: input.countryCode,
        createdAt: Timestamp.fromMillis(now),
        microchipId: input.microchipId,
        // Champs serveur : l'appelant ne les pose jamais.
        verifiedAt: null,
        deletedAt: null,
        grade: { level: 0 },
        stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
      };

      t.set(petRef, pet);
      return pet;
    });

    return petProfile(petRef.id, created);
  }),
);

/**
 * Mise à jour d'un animal. `number`, `stats`, `verifiedAt` et `userUid` sont des
 * champs serveur et ne sont jamais écrits ici. **L'espèce est immuable** : le
 * numéro sort de la séquence de son espèce, le changer rendrait
 * l'immatriculation fausse.
 */
export const updatePetHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<PetWire> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);
    const petUid = requiredField(body, "petUid");

    const parsed = readPetInput((body as Record<string, unknown>).pet);
    if (!parsed.ok) throw petError(parsed.rejection);
    const input = parsed.input;

    const petRef = db.collection(PETS).doc(petUid);

    const updated = await db.runTransaction(async (t) => {
      const snap = await t.get(petRef);
      if (!snap.exists) throw notFound(`animal ${petUid} introuvable`);

      const current = snap.data() as PetDoc;
      if (current.userUid !== userUid) {
        throw forbidden(`${petUid} n'appartient pas à l'appelant`);
      }
      if (current.species !== input.species) {
        throw conflict("l'espèce d'un animal ne change pas");
      }

      await assertMicrochipFree(t, input.microchipId, petUid);

      const patch = {
        name: input.name,
        photoUrl: input.photoUrl,
        sex: input.sex,
        breed: input.breed,
        birthDate: input.birthDate === null ? null : Timestamp.fromMillis(input.birthDate),
        countryCode: input.countryCode,
        microchipId: input.microchipId,
      };
      t.update(petRef, patch);
      return { ...current, ...patch } as PetDoc;
    });

    return petProfile(petUid, updated);
  }),
);

/** Unicité globale du numéro de puce (D68), vérifiée dans la transaction. */
async function assertMicrochipFree(
  t: FirebaseFirestore.Transaction,
  microchipId: string | null,
  ownPetId: string,
): Promise<void> {
  if (!microchipId) return;
  const clash = await t.get(
    db.collection(PETS).where("microchipId", "==", microchipId).limit(2),
  );
  if (clash.docs.some((doc) => doc.id !== ownPetId)) {
    throw conflict(`la puce ${microchipId} est déjà enregistrée`);
  }
}

function petError(rejection: PetRejection): HttpError {
  switch (rejection) {
  case "NAME_REQUIRED":
    return badRequest("le nom est obligatoire");
  case "SPECIES_INVALID":
    return badRequest("espèce attendue : DOG ou CAT");
  case "SEX_INVALID":
    return badRequest("sexe attendu : MALE ou FEMALE");
  case "COUNTRY_REQUIRED":
    return badRequest("le pays est obligatoire");
  case "MICROCHIP_INVALID":
    return badRequest("numéro de puce attendu : 15 chiffres (ISO 11784/11785)");
  }
}
