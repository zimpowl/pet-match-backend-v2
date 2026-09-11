import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PETS, USERS, db } from "../firebase";
import { PetDoc } from "../models/pet";
import { JsonResponse, Query, badRequest, notFound, requiredField, respond } from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Fermer un compte n'efface rien (§6) : un concours joué l'a été, et retirer
 * ses votes fausserait l'ELO de tous les autres. Ce qui part, c'est l'identité
 * vivante — pseudo, avatar, jeton de notification — et le profil retombe alors
 * sous la porte du premier lancement : `needsProfile` est vrai, donc revenir
 * veut dire recommencer, pas retrouver.
 */
export const deleteAccountHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const userUid = callerUid(req.query as Query, req.body as unknown);
    const ref = db.collection(USERS).doc(userUid);
    if (!(await ref.get()).exists) throw notFound(`utilisateur ${userUid} introuvable`);

    await ref.update({
      deletedAt: Timestamp.now(),
      nickname: null,
      avatarUrl: null,
      fcmToken: null,
    });

    return { userUid };
  }),
);

/**
 * Un animal retiré quitte l'étagère et la recherche, mais pas les concours où
 * il court : sa slab est engagée, et l'en sortir referait les duels des autres.
 * Il ne peut simplement plus s'inscrire ailleurs.
 */
export const deletePetHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const petUid = requiredField(body, "petUid");

    const ref = db.collection(PETS).doc(petUid);
    const snap = await ref.get();
    if (!snap.exists) throw notFound(`animal ${petUid} introuvable`);
    if ((snap.data() as PetDoc).userUid !== userUid) {
      throw badRequest("cet animal n'est pas le vôtre");
    }

    await ref.update({ deletedAt: Timestamp.now() });

    return { petUid };
  }),
);
