import { onRequest } from "firebase-functions/v2/https";
import { CONTESTS, PARTICIPANTS, db } from "../firebase";
import { ContestDoc, ContestParticipantDoc } from "../models/contest";
import { WinnersResponse } from "./contract";
import { toMillisOrZero } from "../core/time";
import { JsonResponse, respond } from "../http/respond";

/**
 * Les premiers de chaque concours clos. Le règlement s'ouvre dessus : une file
 * de vainqueurs qui défile dit ce qu'est l'endroit sans une phrase.
 *
 * Le vainqueur n'est pas stocké sur le concours — il l'est sur le document
 * juré, dénormalisé à la clôture pour la notification du soir. On le relit donc
 * ici, un participant par concours. C'est une requête par concours clos, sur un
 * écran qu'on ouvre rarement ; le jour où ça pèse, le rang 1 se posera sur le
 * concours à la clôture et cette fonction n'aura plus qu'une requête.
 */
export const getWinnersHttp = onRequest({ cors: true }, (_req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<WinnersResponse> => {
    const contests = await db
      .collection(CONTESTS)
      .where("status", "==", "CLOSED")
      .orderBy("number", "desc")
      .get();

    const winners = await Promise.all(
      contests.docs.map(async (contest) => {
        const top = await contest.ref
          .collection(PARTICIPANTS)
          .where("rank", "==", 1)
          .limit(1)
          .get();

        const doc = top.docs[0];
        if (!doc) return null;

        const participant = doc.data() as ContestParticipantDoc;
        const data = contest.data() as ContestDoc;

        return {
          contestUid: contest.id,
          number: data.number,
          theme: data.theme,
          startAt: toMillisOrZero(data.startAt),
          endAt: toMillisOrZero(data.endAt),
          counts: {
            judges: data.counts?.judges ?? 0,
            participants: data.counts?.participants ?? 0,
          },
          petUid: participant.petId,
          petName: participant.petName,
          photoUrl: participant.photoUrl ?? null,
        };
      }),
    );

    return { winners: winners.flatMap((winner) => (winner ? [winner] : [])) };
  }),
);
