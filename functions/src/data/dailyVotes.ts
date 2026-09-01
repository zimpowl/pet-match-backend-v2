import { DEFAULT_VOTES_PER_DAY } from "../core/cap";
import { DailyVotesWire } from "../api/contract";
import { MeSource, dailyVotesWire } from "../api/mappers";
import { LoadedContest, loadActiveContests, loadMe } from "./contests";

export interface PrefetchedContest {
  readonly contest: LoadedContest;
  readonly me: MeSource;
}

/**
 * Les votes du jour viennent du concours **actif** que ce joueur juge — il n'y
 * en a qu'un par semaine (D29). Quand l'appelant a déjà chargé la page, on s'y
 * sert ; sinon on paie une query et un `getAll`.
 */
export async function resolveDailyVotes(
  userUid: string | null,
  nowMillis: number,
  prefetched: readonly PrefetchedContest[] = [],
): Promise<DailyVotesWire> {
  if (!userUid) return dailyVotesWire(null, nowMillis, DEFAULT_VOTES_PER_DAY);

  const fromPage = prefetched.find(
    (entry) => entry.contest.doc.status === "ACTIVE" && entry.me.judge !== null,
  );
  if (fromPage) {
    return dailyVotesWire(
      { contest: fromPage.contest.doc, judge: fromPage.me.judge },
      nowMillis,
      DEFAULT_VOTES_PER_DAY,
    );
  }

  // La page ne portait aucun concours actif : on va le chercher.
  const seenActive = prefetched.some((entry) => entry.contest.doc.status === "ACTIVE");
  if (seenActive) return dailyVotesWire(null, nowMillis, DEFAULT_VOTES_PER_DAY);

  const active = await loadActiveContests();
  if (active.length === 0) return dailyVotesWire(null, nowMillis, DEFAULT_VOTES_PER_DAY);

  const me = await loadMe(active, userUid, []);
  const judged = active.find((contest) => me.get(contest.uid)?.judge);
  const chosen = judged ?? active[0];
  if (!chosen) return dailyVotesWire(null, nowMillis, DEFAULT_VOTES_PER_DAY);

  return dailyVotesWire(
    { contest: chosen.doc, judge: me.get(chosen.uid)?.judge ?? null },
    nowMillis,
    DEFAULT_VOTES_PER_DAY,
  );
}
