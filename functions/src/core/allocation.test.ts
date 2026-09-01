import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTEST_DAYS,
  DAY_MILLIS,
  contestDayIndex,
  emptyVotesPerDay,
  normalizeVotesPerDay,
  remainingVotesToday,
  secondsToReset,
  totalVotes,
} from "./allocation";

const START = 1_700_000_000_000;

test("le jour 0 commence à startAt", () => {
  assert.equal(contestDayIndex(START, START), 0);
  assert.equal(contestDayIndex(START + DAY_MILLIS - 1, START), 0);
});

test("le jour bascule exactement à l'anniversaire du concours", () => {
  assert.equal(contestDayIndex(START + DAY_MILLIS, START), 1);
  assert.equal(contestDayIndex(START + 6 * DAY_MILLIS, START), 6);
});

test("hors fenêtre le jour n'existe pas", () => {
  assert.equal(contestDayIndex(START - 1, START), null);
  assert.equal(contestDayIndex(START + CONTEST_DAYS * DAY_MILLIS, START), null);
});

test("l'allocation ne se cumule pas d'un jour sur l'autre", () => {
  const votesPerDay = emptyVotesPerDay();
  votesPerDay[0] = 3;

  assert.equal(remainingVotesToday(votesPerDay, 0, 10), 7);
  assert.equal(remainingVotesToday(votesPerDay, 1, 10), 10);
});

test("l'allocation ne descend jamais sous zéro", () => {
  assert.equal(remainingVotesToday([12, 0, 0, 0, 0, 0, 0], 0, 10), 0);
});

test("le total posé est la somme du tableau", () => {
  assert.equal(totalVotes([10, 10, 8, 0, 0, 0, 0]), 28);
});

test("la remise tombe au prochain anniversaire", () => {
  assert.equal(secondsToReset(START, START), DAY_MILLIS / 1000);
  assert.equal(secondsToReset(START + DAY_MILLIS / 2, START), DAY_MILLIS / 2000);
});

test("un votesPerDay douteux est ramené à sept entiers positifs", () => {
  assert.deepEqual(normalizeVotesPerDay(undefined), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(normalizeVotesPerDay([3]), [3, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    normalizeVotesPerDay([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(normalizeVotesPerDay([-4, 2.7]), [0, 2, 0, 0, 0, 0, 0]);
});
