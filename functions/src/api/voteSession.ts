import { onRequest } from "firebase-functions/v2/https";
import { DUELS_PER_SESSION, buildDuels } from "../core/pairing";
import { VoteSessionResponse } from "./contract";
import { duelPet } from "./mappers";
import {
  loadContest,
  loadJudge,
  loadPairingWindow,
  loadParticipantsByIds,
} from "../data/contests";
import { resolveDailyVotes } from "../data/dailyVotes";
import { toMillisOrZero } from "../core/time";
import { JsonResponse, Query, notFound, requiredParam, respond } from "../http/respond";

/**
 * Les duels de la session. Un juré qui n'a pas encore voté n'a pas de doc
 * `judges/{uid}` — c'est `submitVote` qui le crée (L3) : on sert quand même
 * une session complète, avec un plafond entier et aucune paire vue.
 */
export const getVoteSessionHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<VoteSessionResponse> => {
    const query = req.query as Query;
    const contestUid = requiredParam(query, "contestUid");
    const userUid = requiredParam(query, "userUid");

    const now = Date.now();
    const contest = await loadContest(contestUid);
    if (!contest) throw notFound(`concours ${contestUid} introuvable`);

    const [judge, window] = await Promise.all([
      loadJudge(contestUid, userUid),
      loadPairingWindow(contestUid),
    ]);

    const duels = buildDuels(window, {
      judgeUserUid: userUid,
      seenPairs: new Set(judge?.seenPairs ?? []),
      count: DUELS_PER_SESSION,
    });

    const petIds = duels.flatMap((duel) => [duel.aPetId, duel.bPetId]);
    const pets = await loadParticipantsByIds(contestUid, petIds);

    return {
      dailyVotes: await resolveDailyVotes(userUid, now, [
        { contest, me: { participant: null, judge } },
      ]),
      theme: contest.doc.theme,
      duels: duels.flatMap((duel) => {
        const a = pets.get(duel.aPetId);
        const b = pets.get(duel.bPetId);
        return a && b ? [{ a: duelPet(a), b: duelPet(b) }] : [];
      }),
      votesCast: judge?.votes ?? 0,
      votesLimit: contest.doc.maxVotesPerJudge,
      perDay: contest.doc.maxVotesPerDay,
      votesPerDay: judge?.votesPerDay ?? [],
      startAt: toMillisOrZero(contest.doc.startAt),
      avatarUrl: judge?.userAvatarUrl ?? null,
    };
  }),
);
