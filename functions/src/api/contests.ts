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
import { resolveDailyVotes } from "../data/dailyVotes";
import { JsonResponse, Query, notFound, param, requiredParam, respond } from "../http/respond";

/**
 * Le feed. Renvoie les votes du jour et une page d'étiquettes triée par numéro
 * décroissant (D84) : `direction=newer` remonte vers le plus récent,
 * `older` descend vers le plus ancien.
 */
export const getContestsHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<ContestsResponse> => {
    const query = req.query as Query;
    const userUid = requiredParam(query, "userUid");
    const request: ContestPageRequest = {
      direction: parsePageDirection(param(query, "direction")),
      cursor: parseCursor(param(query, "cursor")),
      limit: parseLimit(param(query, "limit"), CONTEST_PAGE_SIZE, CONTEST_PAGE_SIZE_MAX),
    };

    const now = Date.now();
    const [page, petIds] = await Promise.all([
      loadContestPage(request),
      loadPetIds(userUid),
    ]);
    const me = await loadMe(page.contests, userUid, petIds);

    const prefetched = page.contests.map((contest) => ({
      contest,
      me: me.get(contest.uid) ?? NO_ME,
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

    const mine = me.get(contest.uid) ?? NO_ME;

    return {
      dailyVotes: await resolveDailyVotes(userUid, now, [{ contest, me: mine }]),
      contest: contestCard(contest.uid, contest.doc, mine),
      participants: participants.map((row) => participantRow(row, contest.doc.status)),
      judges: judges.map((row) => judgeRow(row, contest.doc.status, contest.doc.maxVotesPerJudge)),
    };
  }),
);
