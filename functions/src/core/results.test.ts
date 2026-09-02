import assert from "node:assert/strict";
import { test } from "node:test";
import { CountedVote, isVoteCorrect, judgeResults, medalFromRank } from "./results";
import { calculateExpectedScore } from "./elo";

const elos = new Map([
  ["uno", 1300],
  ["nala", 1250],
  ["milo", 1100],
]);

const vote = (overrides: Partial<CountedVote> = {}): CountedVote => ({
  judgeUserUid: "zimpo",
  aPetId: "uno",
  bPetId: "nala",
  pickedPetId: "uno",
  expectedPicked: 0.5,
  ...overrides,
});

test("juste = l'animal choisi finit devant son adversaire de ce duel", () => {
  assert.equal(isVoteCorrect(vote({ pickedPetId: "uno" }), elos), true);
  assert.equal(isVoteCorrect(vote({ pickedPetId: "nala" }), elos), false);
});

test("la comparaison est interne au duel, pas au plateau", () => {
  // nala finit 2ᵉ du plateau, mais elle bat milo : le vote est juste.
  const duel = vote({ aPetId: "nala", bPetId: "milo", pickedPetId: "nala" });
  assert.equal(isVoteCorrect(duel, elos), true);
});

test("l'égalité d'ELO final est neutre, jamais juste", () => {
  const tied = new Map([
    ["uno", 1200],
    ["nala", 1200],
  ]);
  assert.equal(isVoteCorrect(vote(), tied), false);
});

test("un animal sans ELO final rend le vote indécidable, pas faux", () => {
  assert.equal(isVoteCorrect(vote({ bPetId: "fantome" }), elos), null);
});

test("un vote indécidable ne compte ni au numérateur ni au dénominateur", () => {
  const results = judgeResults(
    [
      vote(),
      vote({ bPetId: "fantome" }),
      vote({ aPetId: "nala", bPetId: "milo", pickedPetId: "milo" }),
    ],
    elos,
  );

  const zimpo = results.get("zimpo");
  assert.equal(zimpo?.votes, 2);
  assert.equal(zimpo?.correctVotes, 1);
});

test("le score de difficulté ne compte que les votes justes (D12)", () => {
  const serre = calculateExpectedScore(1200, 1200);
  const results = judgeResults(
    [
      vote({ expectedPicked: serre }),
      vote({ pickedPetId: "nala", expectedPicked: 0.15 }),
    ],
    elos,
  );

  // Un duel serré vu juste vaut 0,50 ; le vote faux ne rapporte rien.
  assert.equal(results.get("zimpo")?.difficultyScore, 0.5);
});

test("voir juste contre le favori rapporte plus que suivre le favori", () => {
  const outsider = new Map([
    ["favori", 1100],
    ["outsider", 1400],
  ]);
  const surAOutsider = judgeResults(
    [
      {
        judgeUserUid: "j",
        aPetId: "favori",
        bPetId: "outsider",
        pickedPetId: "outsider",
        expectedPicked: calculateExpectedScore(1100, 1400),
      },
    ],
    outsider,
  );

  assert.ok((surAOutsider.get("j")?.difficultyScore ?? 0) > 0.84);
});

test("chaque juré est compté séparément", () => {
  const results = judgeResults(
    [vote({ judgeUserUid: "a" }), vote({ judgeUserUid: "b", pickedPetId: "nala" })],
    elos,
  );

  assert.equal(results.get("a")?.correctVotes, 1);
  assert.equal(results.get("b")?.correctVotes, 0);
  assert.equal(results.get("b")?.votes, 1);
});

test("un juré sans aucun vote décidable n'apparaît pas", () => {
  assert.equal(judgeResults([vote({ bPetId: "fantome" })], elos).size, 0);
});

test("le podium reste à trois places", () => {
  assert.equal(medalFromRank(1), "gold");
  assert.equal(medalFromRank(2), "silver");
  assert.equal(medalFromRank(3), "bronze");
  assert.equal(medalFromRank(4), null);
  assert.equal(medalFromRank(null), null);
});
