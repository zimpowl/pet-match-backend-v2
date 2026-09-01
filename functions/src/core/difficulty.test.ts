import assert from "node:assert/strict";
import { test } from "node:test";
import { difficultyScore } from "./difficulty";
import { calculateExpectedScore } from "./elo";

test("un duel serré vaut la moitié d'un point", () => {
  const expected = calculateExpectedScore(1200, 1200);
  assert.equal(difficultyScore([{ expectedPicked: expected, isCorrect: true }]), 0.5);
});

test("voir juste contre le favori rapporte plus que suivre le favori", () => {
  const favourite = calculateExpectedScore(1400, 1100);
  const outsider = calculateExpectedScore(1100, 1400);

  const onFavourite = difficultyScore([{ expectedPicked: favourite, isCorrect: true }]);
  const onOutsider = difficultyScore([{ expectedPicked: outsider, isCorrect: true }]);

  assert.ok(onFavourite < 0.16, `attendu ~0,15 obtenu ${onFavourite}`);
  assert.ok(onOutsider > 0.84, `attendu ~0,85 obtenu ${onOutsider}`);
});

test("un vote faux ne rapporte rien, jamais de malus", () => {
  assert.equal(difficultyScore([{ expectedPicked: 0.15, isCorrect: false }]), 0);
});

test("les deux stratégies ont la même espérance", () => {
  const favourite = calculateExpectedScore(1400, 1100);
  const outsider = 1 - favourite;

  const expectationOnFavourite = favourite * (1 - favourite);
  const expectationOnOutsider = outsider * (1 - outsider);

  assert.ok(Math.abs(expectationOnFavourite - expectationOnOutsider) < 1e-9);
});
