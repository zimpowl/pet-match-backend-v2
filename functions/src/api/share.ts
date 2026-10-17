import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { CONTESTS, PARTICIPANTS, db } from "../firebase";
import { ContestParticipantDoc } from "../models/contest";
import { ShareWire } from "./contract";
import { shareWire } from "./mappers";
import { JsonResponse, Query, notFound, requiredField, respond } from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Le partage d'une carte : un animal, dans un concours.
 *
 * On compte **une fois par personne** : l'appelant entre dans `sharedBy`, et
 * le relancer n'y ajoute rien. Le propriétaire y entre aussi — c'est ce qui
 * allume son bouton —, mais le compteur ne compte que les autres : partager
 * sa propre carte ne gonfle rien.
 *
 * On compte l'intention, pas la publication : le système dit qu'on a ouvert la
 * feuille de partage, jamais si l'image est vraiment partie.
 */
export const shareCardHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<ShareWire> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);
    const contestUid = requiredField(body, "contestUid");
    const petUid = requiredField(body, "petUid");

    const ref = db.collection(CONTESTS).doc(contestUid).collection(PARTICIPANTS).doc(petUid);

    return db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw notFound(`${petUid} ne court pas dans ${contestUid}`);

      const participant = snap.data() as ContestParticipantDoc;
      if (!(participant.sharedBy ?? []).includes(userUid)) {
        t.update(ref, { sharedBy: FieldValue.arrayUnion(userUid) });
        participant.sharedBy = [...(participant.sharedBy ?? []), userUid];
      }
      return shareWire(participant, userUid);
    });
  }),
);
