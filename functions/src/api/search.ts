import { onRequest } from "firebase-functions/v2/https";
import { CONTESTS, PETS, USERS, db } from "../firebase";
import { ContestDoc } from "../models/contest";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import { SearchResponse } from "./contract";
import { contestCard, judgeProfile, petProfile } from "./mappers";
import { JsonResponse, Query, badRequest, requiredParam, respond } from "../http/respond";

const MAX_PER_KIND = 5;

/**
 * Le numéro d'une slab, et ce qu'il désigne. Les quatre séquences — concours,
 * chiens, chats, jurés — sont indépendantes (D83), donc `000 017` existe
 * quatre fois et c'est voulu : le numéro dit « le 17ᵉ chien », pas « l'objet
 * 17 ». On renvoie donc les quatre, et c'est l'étiquette qui dit lequel on
 * cherchait — une ambiguïté qui se lève au premier regard n'en est pas une.
 *
 * Rien d'autre que le numéro : chercher par nom demanderait un index de texte,
 * et le numéro est ce qui est **gravé sur l'objet**.
 */
export const searchByNumberHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<SearchResponse> => {
    const query = req.query as Query;
    const raw = requiredParam(query, "number");
    const number = Number.parseInt(raw.replace(/\s/g, ""), 10);
    if (!Number.isFinite(number) || number <= 0) throw badRequest("numéro invalide");

    const [contests, pets, judges] = await Promise.all([
      db.collection(CONTESTS).where("number", "==", number).limit(MAX_PER_KIND).get(),
      db.collection(PETS).where("number", "==", number).limit(MAX_PER_KIND).get(),
      db.collection(USERS).where("judgeNumber", "==", number).limit(MAX_PER_KIND).get(),
    ]);

    return {
      contests: contests.docs.map((doc) => contestCard(doc.id, doc.data() as ContestDoc)),
      pets: pets.docs.map((doc) => petProfile(doc.id, doc.data() as PetDoc)),
      judges: judges.docs.map((doc) => judgeProfile(doc.id, doc.data() as UserDoc)),
    };
  }),
);
