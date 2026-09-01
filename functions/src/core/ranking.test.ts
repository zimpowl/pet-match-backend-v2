import assert from "node:assert/strict";
import { test } from "node:test";
import { compareJudges, compareParticipants, rank } from "./ranking";

const judge = (correctVotes: number, votes: number, difficultyScore: number, joinedAt = 0) => ({
  correctVotes,
  votes,
  difficultyScore,
  joinedAt,
});

test("le classement des jurés se fait sur les bons votes", () => {
  const ranked = rank([judge(40, 70, 30), judge(63, 70, 20)], compareJudges);
  assert.equal(ranked[0]?.correctVotes, 63);
});

test("à égalité de bons votes, le plus actif passe devant", () => {
  const ranked = rank([judge(3, 3, 2), judge(3, 6, 1)], compareJudges);
  assert.equal(ranked[0]?.votes, 6);
});

test("à égalité de votes, le score de difficulté départage", () => {
  const ranked = rank([judge(63, 70, 28.4), judge(63, 70, 31.2)], compareJudges);
  assert.equal(ranked[0]?.difficultyScore, 31.2);
});

test("l'antériorité est le filet ultime", () => {
  const ranked = rank([judge(63, 70, 30, 200), judge(63, 70, 30, 100)], compareJudges);
  assert.equal(ranked[0]?.joinedAt, 100);
});

test("les participants sont classés à l'ELO puis au taux de victoire", () => {
  const ranked = rank(
    [
      { elo: 1266.4, wins: 40, duels: 60, createdAt: 0 },
      { elo: 1266.4, wins: 45, duels: 60, createdAt: 0 },
      { elo: 1301.2, wins: 30, duels: 60, createdAt: 0 },
    ],
    compareParticipants,
  );

  assert.equal(ranked[0]?.elo, 1301.2);
  assert.equal(ranked[1]?.wins, 45);
});
