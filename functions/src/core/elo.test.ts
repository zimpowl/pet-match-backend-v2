import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ELO, calculateExpectedScore, calculateUpdatedElo, pairKey } from "./elo";

test("deux ELO égaux donnent une chance sur deux", () => {
  assert.equal(calculateExpectedScore(DEFAULT_ELO, DEFAULT_ELO), 0.5);
});

test("300 points d'écart donnent environ 85 % au favori", () => {
  const expected = calculateExpectedScore(1400, 1100);
  assert.ok(expected > 0.84 && expected < 0.86, `obtenu ${expected}`);
});

test("l'ELO reste flottant, il n'est plus arrondi", () => {
  const updated = calculateUpdatedElo(DEFAULT_ELO, 0.5, 1, 24);
  assert.equal(updated, 1212);

  const uneven = calculateUpdatedElo(DEFAULT_ELO, 0.4321, 1, 24);
  assert.ok(!Number.isInteger(uneven), `attendu un flottant, obtenu ${uneven}`);
});

test("gagner et perdre le même duel se compensent", () => {
  const expected = calculateExpectedScore(1200, 1200);
  const win = calculateUpdatedElo(1200, expected, 1, 24);
  const loss = calculateUpdatedElo(1200, expected, 0, 24);
  assert.equal((win + loss) / 2, 1200);
});

test("la clé de paire est indépendante de l'ordre", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
});
