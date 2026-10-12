import { onRequest } from "firebase-functions/v2/https";
import { CONTESTS, PARTICIPANTS, db } from "../firebase";
import { ContestDoc, ContestParticipantDoc } from "../models/contest";
import { PodiumEntryWire, PodiumsResponse } from "./contract";
import { stats } from "./mappers";
import { careerFrom, loadPetCareers } from "../data/careers";
import { Careers } from "../core/career";
import { toMillisOrZero } from "../core/time";
import { JsonResponse, respond } from "../http/respond";

const PODIUM = 3;

interface PodiumRow {
  readonly contestUid: string;
  readonly contest: ContestDoc;
  readonly rank: number;
  readonly participant: ContestParticipantDoc;
}

function entry(row: PodiumRow, careers: Careers): PodiumEntryWire {
  const { contest, participant } = row;
  const career = careerFrom(careers, participant.petId);

  return {
    contestUid: row.contestUid,
    number: contest.number,
    theme: contest.theme,
    startAt: toMillisOrZero(contest.startAt),
    endAt: toMillisOrZero(contest.endAt),
    counts: {
      judges: contest.counts.judges,
      participants: contest.counts.participants,
    },
    rank: row.rank,
    pet: {
      petUid: participant.petId,
      number: participant.petNumber,
      name: participant.petName,
      breed: participant.petBreed,
      species: participant.species,
      sex: participant.sex,
      level: career.level,
      stats: stats(career.stats),
      photoUrl: participant.photoUrl ?? null,
    },
  };
}

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

        return top.docs.flatMap((doc): PodiumRow[] => {
          const participant = doc.data() as ContestParticipantDoc;
          const rank = participant.rank;
          if (rank === null || rank > PODIUM) return [];
          if (participant.hiddenAt != null) return [];

          return [{ contestUid: contest.id, contest: data, rank, participant }];
        });
      }),
    );

    // Le niveau et le palmarès montrés sont ceux du jour : la vitrine dit ce
    // que l'animal est devenu, pas ce qu'il était ce dimanche-là.
    const rows = podiums.flat();
    const careers = await loadPetCareers(rows.map((row) => row.participant.petId));

    return { entries: rows.map((row) => entry(row, careers)) };
  }),
);
