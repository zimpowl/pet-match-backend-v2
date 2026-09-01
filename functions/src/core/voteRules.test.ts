import assert from "node:assert/strict";
import { test } from "node:test";
import { VoteInput, rejectVote } from "./voteRules";
import { pairKey } from "./elo";

const KEY = pairKey("uno", "nala");

function input(overrides: Partial<VoteInput> = {}): VoteInput {
  return {
    status: "ACTIVE",
    day: 2,
    aPetId: "uno",
    bPetId: "nala",
    pickedPetId: "uno",
    judgeUserUid: "zimpo",
    aOwnerUid: "user-0",
    bOwnerUid: "user-3",
    pairKey: KEY,
    seenPairs: new Set<string>(),
    votesCast: 20,
    maxVotesPerJudge: 70,
    votesToday: 3,
    maxVotesPerDay: 10,
    ...overrides,
  };
}

test("un vote valide ne renvoie aucun rejet", () => {
  assert.equal(rejectVote(input()), null);
});

test("un animal ne s'affronte pas lui-même", () => {
  assert.equal(rejectVote(input({ bPetId: "uno" })), "PAIR_IDENTICAL");
});

test("le choix doit être l'un des deux animaux du duel", () => {
  assert.equal(rejectVote(input({ pickedPetId: "milo" })), "PICK_OUTSIDE_PAIR");
});

test("on ne vote pas sur un concours qui n'est pas en cours", () => {
  assert.equal(rejectVote(input({ status: "DRAFT" })), "CONTEST_NOT_RUNNING");
  assert.equal(rejectVote(input({ status: "CLOSED" })), "CONTEST_NOT_RUNNING");
});

test("hors de la fenêtre de sept jours il n'y a pas de journée où poser le vote", () => {
  assert.equal(rejectVote(input({ day: null })), "CONTEST_NOT_RUNNING");
});

test("les deux animaux doivent être inscrits à ce concours", () => {
  assert.equal(rejectVote(input({ aOwnerUid: null })), "PARTICIPANT_MISSING");
  assert.equal(rejectVote(input({ bOwnerUid: null })), "PARTICIPANT_MISSING");
});

test("un juré ne juge jamais ses propres animaux", () => {
  assert.equal(rejectVote(input({ aOwnerUid: "zimpo" })), "OWN_PET");
  assert.equal(rejectVote(input({ bOwnerUid: "zimpo" })), "OWN_PET");
});

test("l'anti-doublon est par juré : une paire déjà jugée est refusée", () => {
  assert.equal(rejectVote(input({ seenPairs: new Set([KEY]) })), "PAIR_ALREADY_JUDGED");
});

test("le plafond du concours ferme la porte, c'est « Complet »", () => {
  assert.equal(rejectVote(input({ votesCast: 70 })), "CAP_REACHED");
  assert.equal(rejectVote(input({ votesCast: 71 })), "CAP_REACHED");
});

test("l'allocation du jour épuisée ne se cumule pas : rendez-vous à 18 h", () => {
  assert.equal(rejectVote(input({ votesToday: 10 })), "DAILY_ALLOCATION_SPENT");
});

test("le plafond passe avant l'allocation : « Complet » est plus vrai que « demain »", () => {
  const both = input({ votesCast: 70, votesToday: 10 });
  assert.equal(rejectVote(both), "CAP_REACHED");
});

test("l'entrée invalide est signalée avant l'état du concours", () => {
  // Un duel mal formé est une erreur d'appel, pas un conflit d'état.
  assert.equal(rejectVote(input({ bPetId: "uno", status: "CLOSED" })), "PAIR_IDENTICAL");
});
