import { onRequest } from "firebase-functions/v2/https";
import { USERS, db } from "../firebase";
import { normalizeLocale } from "../core/notifications";
import {
  JsonResponse,
  Query,
  notFound,
  requiredField,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Enregistrement de l'appareil : le jeton de notification **et** la langue de
 * lecture, en un seul appel. Les deux viennent du même endroit et au même
 * moment — au premier lancement, puis à chaque rotation du jeton FCM — donc
 * les séparer n'aurait été qu'un aller-retour de plus.
 *
 * Le nom diffère volontairement de l'ancien `updateFcmTokenHttp` : il appartient
 * au backend legacy, qui vise le même projet et ne doit pas être écrasé pendant
 * la transition (§7).
 *
 * `platform` est accepté et ignoré : un jeton FCM sait déjà à quelle plateforme
 * il appartient, et le §3 ne garde pas ce champ.
 */
export const registerDeviceHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const token = requiredField(body, "token");

    const raw = (body as Record<string, unknown>).locale;
    const locale = typeof raw === "string" ? normalizeLocale(raw) : null;

    const ref = db.collection(USERS).doc(userUid);
    const snap = await ref.get();
    if (!snap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

    // Une langue illisible est **ignorée**, jamais écrite : elle effacerait une
    // langue valide enregistrée au lancement précédent.
    const patch: Record<string, unknown> = { fcmToken: token };
    if (locale !== null) patch.locale = locale;

    await ref.set(patch, { merge: true });
    return { userUid, locale };
  }),
);
