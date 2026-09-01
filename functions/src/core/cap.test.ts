import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTEST_DAYS } from "./allocation";
import {
  LARGE_MAX_VOTES_PER_JUDGE,
  SMALL_MAX_VOTES_PER_JUDGE,
  computeMaxVotesPerJudge,
  computeVotesPerDay,
} from "./cap";

test("deux paliers, pas une formule (D85)", () => {
  assert.equal(computeMaxVotesPerJudge(10), 35);
  assert.equal(computeMaxVotesPerJudge(15), 35);
  assert.equal(computeMaxVotesPerJudge(20), 35);
  assert.equal(computeMaxVotesPerJudge(21), 70);
  assert.equal(computeMaxVotesPerJudge(30), 70);
  assert.equal(computeMaxVotesPerJudge(5000), 70);
});

test("le palier bascule à 21 participants, pas à 20", () => {
  assert.equal(computeVotesPerDay(20), 5);
  assert.equal(computeVotesPerDay(21), 10);
});

test("sept jours d'allocation font exactement le plafond", () => {
  assert.equal(computeVotesPerDay(20) * CONTEST_DAYS, SMALL_MAX_VOTES_PER_JUDGE);
  assert.equal(computeVotesPerDay(21) * CONTEST_DAYS, LARGE_MAX_VOTES_PER_JUDGE);
  assert.equal(SMALL_MAX_VOTES_PER_JUDGE, 35);
  assert.equal(LARGE_MAX_VOTES_PER_JUDGE, 70);
});
