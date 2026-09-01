import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_VOTES_PER_JUDGE, computeMaxVotesPerJudge } from "./cap";

test("le plafond suit la table du §4.3", () => {
  assert.equal(computeMaxVotesPerJudge(10), 15);
  assert.equal(computeMaxVotesPerJudge(15), 35);
  assert.equal(computeMaxVotesPerJudge(20), 63);
  assert.equal(computeMaxVotesPerJudge(21), 70);
  assert.equal(computeMaxVotesPerJudge(25), 70);
  assert.equal(computeMaxVotesPerJudge(30), 70);
});

test("le plafond est atteint dès 21 participants et n'augmente plus", () => {
  assert.equal(computeMaxVotesPerJudge(21), MAX_VOTES_PER_JUDGE);
  assert.equal(computeMaxVotesPerJudge(500), MAX_VOTES_PER_JUDGE);
});

test("un concours sans duel possible n'a pas de plafond", () => {
  assert.equal(computeMaxVotesPerJudge(0), 0);
  assert.equal(computeMaxVotesPerJudge(1), 0);
});
