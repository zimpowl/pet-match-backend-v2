import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { USERS, db } from "../firebase";
import { UserDoc } from "../models/user";
import { JsonResponse, Query, notFound, respond } from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Signer le règlement (D125). Le geste est **idempotent** : re-signer ne
 * réécrit pas la date, sinon rouvrir la page depuis le menu effacerait la
 * signature d'origine — et c'est précisément cette date-là qu'on réaffiche.
 */
export const signRulesHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const userUid = await callerUid(
      req.query as Query,
      req.body as unknown,
      req.headers.authorization,
    );

    const ref = db.collection(USERS).doc(userUid);
    const snap = await ref.get();
    if (!snap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

    const held = (snap.data() as UserDoc).rulesSignedAt;
    if (held) return { signedAt: held.toMillis() };

    const signedAt = Timestamp.now();
    await ref.set({ rulesSignedAt: signedAt }, { merge: true });

    return { signedAt: signedAt.toMillis() };
  }),
);
