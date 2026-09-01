export const DAY_MILLIS = 86_400_000;
export const CONTEST_DAYS = 7;

/**
 * Jour du concours, déduit de son propre `startAt` qui est à 18 h par
 * construction (D8). Aucun cron, aucun dayKey, aucun fuseau horaire.
 * Renvoie null si `now` est hors de la fenêtre du concours.
 */
export function contestDayIndex(nowMillis: number, startAtMillis: number): number | null {
  const day = Math.floor((nowMillis - startAtMillis) / DAY_MILLIS);
  return day >= 0 && day < CONTEST_DAYS ? day : null;
}

export function emptyVotesPerDay(): number[] {
  return new Array<number>(CONTEST_DAYS).fill(0);
}

export function totalVotes(votesPerDay: readonly number[]): number {
  return votesPerDay.reduce((sum, value) => sum + value, 0);
}

/**
 * Votes restants aujourd'hui. L'allocation ne se cumule pas : ce qui n'a pas
 * été posé la veille est perdu (D37).
 */
export function remainingVotesToday(
  votesPerDay: readonly number[],
  day: number,
  maxVotesPerDay: number,
): number {
  const used = votesPerDay[day] ?? 0;
  return Math.max(0, maxVotesPerDay - used);
}

/** Secondes jusqu'à la prochaine remise, c'est-à-dire l'anniversaire du concours. */
export function secondsToReset(nowMillis: number, startAtMillis: number): number {
  const elapsed = nowMillis - startAtMillis;
  const untilNextDay = DAY_MILLIS - (((elapsed % DAY_MILLIS) + DAY_MILLIS) % DAY_MILLIS);
  return Math.ceil(untilNextDay / 1000);
}

/**
 * Ramène un `votesPerDay` venu de Firestore à un tableau de sept entiers, quoi
 * qu'il contienne. Un doc juré écrit par une version antérieure ne doit pas
 * pouvoir faire sortir une allocation du néant.
 */
export function normalizeVotesPerDay(source: readonly number[] | undefined | null): number[] {
  const result = emptyVotesPerDay();
  if (!source) return result;
  for (let day = 0; day < CONTEST_DAYS; day++) {
    const value = source[day];
    result[day] = typeof value === "number" && value > 0 ? Math.floor(value) : 0;
  }
  return result;
}
