import { onRequest } from "firebase-functions/v2/https";
import {
  CONTEST_PAGE_SIZE,
  CONTEST_PAGE_SIZE_MAX,
  ContestPageRequest,
  contestCursors,
  parseCursor,
  parseLimit,
  parsePageDirection,
} from "../core/pagination";
import { ContestDetailResponse, ContestsResponse } from "./contract";
import { NO_ME, contestCard, judgeRow, participantRow } from "./mappers";
import {
  loadContest,
  loadContestPage,
  loadJudges,
  loadMe,
  loadParticipants,
  loadPetIds,
} from "../data/contests";
import { careerFrom, loadJudgeCareers, loadPetCareers } from "../data/careers";
import { resolveDailyVotes } from "../data/dailyVotes";
import { JsonResponse, Query, notFound, param, requiredParam, respond } from "../http/respond";

/**
 * Le feed. Renvoie les votes du jour et une page d'étiquettes triée par numéro
 * décroissant (D84) : `direction=newer` remonte vers le plus récent,
 * `older` descend vers le plus ancien.
 *
 * **`userUid` est facultatif** : on lit l'app sans compte, et c'est seulement
 * pour agir — voter, inscrire un animal, ouvrir son profil — qu'une licence est
 * demandée. Sans lui, chaque carte sort avec `NO_ME` et l'allocation du jour
 * est l'allocation entière, comme pour un juré qui n'a encore rien posé.
 */
export const getContestsHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<ContestsResponse> => {
    const query = req.query as Query;
    const userUid = param(query, "userUid") ?? null;
    const request: ContestPageRequest = {
      direction: parsePageDirection(param(query, "direction")),
      cursor: parseCursor(param(query, "cursor")),
      limit: parseLimit(param(query, "limit"), CONTEST_PAGE_SIZE, CONTEST_PAGE_SIZE_MAX),
    };

    const now = Date.now();
    const [page, petIds] = await Promise.all([
      loadContestPage(request),
      userUid ? loadPetIds(userUid) : Promise.resolve([] as string[]),
    ]);
    const me = await loadMe(page.contests, userUid, petIds);

    const prefetched = page.contests.map((contest) => ({
      contest,
      me: { ...(me.get(contest.uid) ?? NO_ME), viewerUid: userUid },
    }));

    return {
      dailyVotes: await resolveDailyVotes(userUid, now, prefetched),
      contests: prefetched.map((entry) =>
        contestCard(entry.contest.uid, entry.contest.doc, entry.me),
      ),
      ...contestCursors(
        page.contests.map((contest) => contest.doc.number),
        request,
        page.hasMore,
      ),
    };
  }),
);

/**
 * Le détail : la carte, plus la première page des participants et des jurés.
 * L'ordre des deux listes est celui du §4.12 — inscription inversée avant le
 * premier classement, classement ensuite.
 */
export const getContestHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<ContestDetailResponse> => {
    const query = req.query as Query;
    const contestUid = requiredParam(query, "contestUid");
    const userUid = param(query, "userUid") ?? null;

    const now = Date.now();
    const contest = await loadContest(contestUid);
    if (!contest) throw notFound(`concours ${contestUid} introuvable`);

    const petIds = userUid ? await loadPetIds(userUid) : [];
    const [me, participants, judges] = await Promise.all([
      loadMe([contest], userUid, petIds),
      loadParticipants(contest),
      loadJudges(contest),
    ]);

    const mine = { ...(me.get(contest.uid) ?? NO_ME), viewerUid: userUid };

    // Les médailles affichées sur une ligne sont celles du jour : une lecture
    // par animal en lice et par juré listé, groupées en deux allers-retours.
    const [petCareers, judgeCareers] = await Promise.all([
      loadPetCareers(participants.map((row) => row.petId)),
      loadJudgeCareers(judges.map((row) => row.userUid)),
    ]);

    return {
      dailyVotes: await resolveDailyVotes(userUid, now, [{ contest, me: mine }]),
      contest: contestCard(contest.uid, contest.doc, mine),
      participants: participants.map((row) =>
        participantRow(row, contest.doc.status, careerFrom(petCareers, row.petId), userUid),
      ),
      judges: judges.map((row) =>
        judgeRow(
          row,
          contest.doc,
          contest.doc.maxVotesPerJudge,
          careerFrom(judgeCareers, row.userUid),
        ),
      ),
    };
  }),
);
