import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTEST_PAGE_SIZE,
  CONTEST_PAGE_SIZE_MAX,
  contestCursors,
  parseCursor,
  parseLimit,
  parsePageDirection,
} from "./pagination";

const older = (cursor: number | null) =>
  ({ direction: "older", cursor, limit: 5 } as const);
const newer = (cursor: number | null) =>
  ({ direction: "newer", cursor, limit: 5 } as const);

test("la première page est la plus récente : rien de plus neuf à charger", () => {
  const cursors = contestCursors([14, 13, 12, 11, 10], older(null), true);
  assert.equal(cursors.newerCursor, null);
  assert.equal(cursors.olderCursor, "9");
});

test("le bout de la liste ferme le curseur ancien", () => {
  const cursors = contestCursors([3, 2, 1], older(3), false);
  assert.equal(cursors.olderCursor, null);
  assert.equal(cursors.newerCursor, "4");
});

test("en remontant, on rouvre toujours le côté ancien", () => {
  const cursors = contestCursors([9, 8, 7, 6, 5], newer(5), true);
  assert.equal(cursors.olderCursor, "4");
  assert.equal(cursors.newerCursor, "10");
});

test("le concours numéro 1 n'a rien derrière lui", () => {
  assert.equal(contestCursors([2, 1], newer(1), false).olderCursor, null);
});

test("une page vide retombe sur le curseur demandé", () => {
  assert.deepEqual(contestCursors([], older(4), false), {
    olderCursor: null,
    newerCursor: "5",
  });
});

test("les paramètres de requête sont bornés, jamais devinés", () => {
  assert.equal(parsePageDirection("newer"), "newer");
  assert.equal(parsePageDirection("n'importe quoi"), "older");
  assert.equal(parseCursor(undefined), null);
  assert.equal(parseCursor("12"), 12);
  assert.equal(parseLimit(undefined, CONTEST_PAGE_SIZE, CONTEST_PAGE_SIZE_MAX), 5);
  assert.equal(parseLimit("0", CONTEST_PAGE_SIZE, CONTEST_PAGE_SIZE_MAX), 5);
  assert.equal(parseLimit("999", CONTEST_PAGE_SIZE, CONTEST_PAGE_SIZE_MAX), 25);
});
