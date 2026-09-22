import { onRequest } from "firebase-functions/v2/https";
import { CONTESTS, PARTICIPANTS, db } from "../firebase";
import { ContestDoc, ContestParticipantDoc } from "../models/contest";
import { PodiumEntryWire, PodiumsResponse } from "./contract";
import { stats } from "./mappers";
import { toMillisOrZero } from "../core/time";
import { JsonResponse, respond } from "../http/respond";

const PODIUM = 3;

/**
 * Les podiums des concours clos, à plat : une entrée par place, de la première
 * à la troisième. Le règlement s'ouvre dessus — trois files qui dérivent en
 * sens contraires disent qu'il y a eu beaucoup de concours, et que la deuxième
 * et la troisième place y ont leur slab comme la première.
 *
 * Les places ne sont pas stockées sur le concours : on relit les trois premiers
 * participants. Trois requêtes par concours clos, sur un écran qu'on ouvre
 * rarement.
 *
 * C'est la **seule route sans authentification** : ce qu'elle rend est publié
 * sur le site, lisible sans compte. Une photo tue par la modération n'y entre
 * donc pas du tout — ailleurs on la remplace par « photo supprimée », ici la
 * vitrine se contente de ne pas la montrer.
 */
export const getPodiumsHttp = onRequest({ cors: true }, (_req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<PodiumsResponse> => {
    const contests = await db
      .collection(CONTESTS)
      .where("status", "==", "CLOSED")
      .orderBy("number", "desc")
      .get();

    const podiums = await Promise.all(
      contests.docs.map(async (contest) => {
        const top = await contest.ref
          .collection(PARTICIPANTS)
          .orderBy("rank", "asc")
          .limit(PODIUM)
          .get();

        const data = contest.data() as ContestDoc;

        return top.docs.flatMap((doc): PodiumEntryWire[] => {
          const participant = doc.data() as ContestParticipantDoc;
          const rank = participant.rank;
          if (rank === null || rank > PODIUM) return [];
          if (participant.hiddenAt != null) return [];

          return [
            {
              contestUid: contest.id,
              number: data.number,
              theme: data.theme,
              startAt: toMillisOrZero(data.startAt),
              endAt: toMillisOrZero(data.endAt),
              counts: {
                judges: data.counts.judges,
                participants: data.counts.participants,
              },
              rank,
              pet: {
                petUid: participant.petId,
                number: participant.petNumber,
                name: participant.petName,
                breed: participant.petBreed,
                species: participant.species,
                sex: participant.sex,
                level: participant.gradeAtEntry ?? 0,
                stats: stats(participant.statsAtContest),
                photoUrl: participant.photoUrl ?? null,
              },
            },
          ];
        });
      }),
    );

    return { entries: podiums.flat() };
  }),
);
