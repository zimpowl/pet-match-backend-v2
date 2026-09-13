import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_GRADE, computeGradeLevel, medalCount, raiseGradeLevel } from "./grade";
import { StatsDoc } from "../models/user";

const stats = (over: Partial<StatsDoc> = {}): StatsDoc => ({
  contests: 4,
  bestRank: null,
  gold: 0,
  silver: 0,
  bronze: 0,
  ...over,
});

test("une médaille est une médaille : aucune pondération (D55)", () => {
  assert.equal(medalCount(stats({ gold: 1, silver: 1, bronze: 1 })), 3);
  assert.equal(medalCount(stats({ bronze: 3 })), 3);
});

test("non vérifié plafonne à 0, même médaillé : c'est une échelle", () => {
  assert.equal(computeGradeLevel(stats({ gold: 60 }), false), 0);
});

test("la confirmation demande les deux : quatre concours et l'identité (D123)", () => {
  assert.equal(computeGradeLevel(stats({ contests: 4 }), true), 1);
  assert.equal(computeGradeLevel(stats({ contests: 3 }), true), 0);
  assert.equal(computeGradeLevel(stats({ contests: 3, gold: 3 }), true), 0);
});

test("les paliers du bas se comptent en médailles, sans exiger d'or", () => {
  assert.equal(computeGradeLevel(stats(), true), 1);
  assert.equal(computeGradeLevel(stats({ bronze: 1 }), true), 2);
  assert.equal(computeGradeLevel(stats({ bronze: 3 }), true), 3);
});

test("à partir du niveau 4, la régularité ne suffit plus : il faut de l'or", () => {
  // L'éternel troisième reste à 3, quel que soit le nombre de podiums.
  assert.equal(computeGradeLevel(stats({ bronze: 40 }), true), 3);
  assert.equal(computeGradeLevel(stats({ bronze: 5, gold: 1 }), true), 4);
});

test("MAÎTRE et LÉGENDE demandent 10/2 et 15/5", () => {
  assert.equal(computeGradeLevel(stats({ bronze: 8, gold: 2 }), true), 5);
  assert.equal(computeGradeLevel(stats({ bronze: 13, gold: 2 }), true), 5);
  assert.equal(computeGradeLevel(stats({ bronze: 10, gold: 5 }), true), MAX_GRADE);
});

test("l'ancienneté ne fait pas monter (D61) : passé le cran 1, seuls les podiums comptent", () => {
  assert.equal(computeGradeLevel(stats({ contests: 200 }), true), 1);
});

test("un niveau ne redescend jamais (D30)", () => {
  assert.equal(raiseGradeLevel(5, 2), 5);
  assert.equal(raiseGradeLevel(2, 5), 5);
  assert.equal(raiseGradeLevel(undefined, 3), 3);
});
