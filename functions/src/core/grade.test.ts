import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_GRADE, computeGradeLevel, medalCount, raiseGradeLevel } from "./grade";
import { StatsDoc } from "../models/user";

const stats = (over: Partial<StatsDoc> = {}): StatsDoc => ({
  contests: 0,
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

test("la vérification seule ouvre le niveau 1, et elle est gratuite (D42)", () => {
  assert.equal(computeGradeLevel(stats(), true), 1);
});

test("les paliers du bas se comptent en médailles, sans exiger d'or", () => {
  assert.equal(computeGradeLevel(stats({ bronze: 2 }), true), 1);
  assert.equal(computeGradeLevel(stats({ bronze: 3 }), true), 2);
  assert.equal(computeGradeLevel(stats({ bronze: 8 }), true), 3);
});

test("à partir du niveau 4, la régularité ne suffit plus : il faut de l'or", () => {
  // Quinze médailles mais aucun or : l'éternel troisième reste à 3.
  assert.equal(computeGradeLevel(stats({ bronze: 15 }), true), 3);
  assert.equal(computeGradeLevel(stats({ bronze: 14, gold: 1 }), true), 4);
});

test("MAÎTRE et LÉGENDE demandent 30/4 et 60/12", () => {
  assert.equal(computeGradeLevel(stats({ bronze: 26, gold: 4 }), true), 5);
  assert.equal(computeGradeLevel(stats({ bronze: 55, gold: 4 }), true), 5);
  assert.equal(computeGradeLevel(stats({ bronze: 48, gold: 12 }), true), MAX_GRADE);
});

test("l'or manquant bloque au cran précédent, jamais au-delà", () => {
  assert.equal(computeGradeLevel(stats({ bronze: 60 }), true), 3);
  assert.equal(computeGradeLevel(stats({ bronze: 56, gold: 4 }), true), 5);
});

test("l'échelle est plus dure qu'avant : les anciens seuils ne suffisent plus", () => {
  assert.equal(computeGradeLevel(stats({ bronze: 1 }), true), 1);
  assert.equal(computeGradeLevel(stats({ bronze: 5, gold: 1 }), true), 2);
  assert.equal(computeGradeLevel(stats({ bronze: 22, gold: 8 }), true), 5);
});

test("l'ancienneté ne compte pas (D61) : les concours joués n'ouvrent rien", () => {
  assert.equal(computeGradeLevel(stats({ contests: 200 }), true), 1);
});

test("un niveau ne redescend jamais (D30)", () => {
  assert.equal(raiseGradeLevel(5, 2), 5);
  assert.equal(raiseGradeLevel(2, 5), 5);
  assert.equal(raiseGradeLevel(undefined, 3), 3);
});
