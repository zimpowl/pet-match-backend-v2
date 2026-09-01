import assert from "node:assert/strict";
import { test } from "node:test";
import { RANK_ORDER, REGISTRATION_ORDER, hasSnapshot, listOrder } from "./ordering";

test("avant le premier 18 h, dernier inscrit en tête (D87)", () => {
  assert.deepEqual(listOrder(null), REGISTRATION_ORDER);
  assert.equal(REGISTRATION_ORDER.field, "registrationIndex");
  assert.equal(REGISTRATION_ORDER.direction, "desc");
});

test("dès le premier résultat, les listes passent au classement", () => {
  assert.deepEqual(listOrder(1_700_000_000_000), RANK_ORDER);
  assert.equal(RANK_ORDER.direction, "asc");
});

test("snapshotAt est le seul signal", () => {
  assert.equal(hasSnapshot(null), false);
  assert.equal(hasSnapshot(0), true);
});
