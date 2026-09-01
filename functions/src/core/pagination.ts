export const CONTEST_PAGE_SIZE = 5;
export const CONTEST_PAGE_SIZE_MAX = 25;

export type PageDirection = "older" | "newer";

export interface ContestPageRequest {
  readonly direction: PageDirection;
  /** Numéro de concours, inclusif. null = la page la plus récente. */
  readonly cursor: number | null;
  readonly limit: number;
}

export interface ContestCursors {
  readonly olderCursor: string | null;
  readonly newerCursor: string | null;
}

/**
 * Les curseurs de la pagination d'étiquettes (D84). La liste est triée par
 * numéro décroissant : `newer` va vers la gauche, `older` vers la droite. Le
 * curseur renvoyé est le **prochain numéro à servir**, donc inclusif à la
 * requête suivante — c'est ce que consomment les fakes de l'app.
 */
export function contestCursors(
  numbers: readonly number[],
  request: ContestPageRequest,
  hasMore: boolean,
): ContestCursors {
  const min = numbers.length > 0 ? Math.min(...numbers) : request.cursor;
  const max = numbers.length > 0 ? Math.max(...numbers) : request.cursor;

  if (request.direction === "newer") {
    return {
      olderCursor: numberCursor(min === null ? null : min - 1),
      newerCursor: hasMore ? numberCursor(max === null ? null : max + 1) : null,
    };
  }

  return {
    olderCursor: hasMore ? numberCursor(min === null ? null : min - 1) : null,
    // Sans curseur on est par construction sur la page la plus récente.
    newerCursor:
      request.cursor === null ? null : numberCursor(max === null ? null : max + 1),
  };
}

export function parsePageDirection(raw: string | undefined): PageDirection {
  return raw === "newer" ? "newer" : "older";
}

export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseCursor(raw: string | undefined): number | null {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberCursor(value: number | null): string | null {
  return value !== null && value >= 1 ? String(value) : null;
}
