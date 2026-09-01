import assert from "node:assert/strict";
import { test } from "node:test";
import { PairingCandidate, buildDuels } from "./pairing";
import { pairKey } from "./elo";

/** Fenêtre de 10 animaux à 10 points d'écart, tous à des propriétaires distincts. */
function window(size: number): PairingCandidate[] {
  return Array.from({ length: size }, (_unused, index) => ({
    petId: `pet-${index}`,
    ownerUid: `user-${index}`,
    elo: 1300 - index * 10,
  }));
}

const stable = () => 0.1; // pas d'inversion gauche/droite

test("les duels opposent des voisins d'ELO", () => {
  const duels = buildDuels(window(10), {
    judgeUserUid: "zimpo",
    seenPairs: new Set(),
    count: 3,
    random: stable,
  });

  assert.deepEqual(duels, [
    { aPetId: "pet-0", bPetId: "pet-1" },
    { aPetId: "pet-2", bPetId: "pet-3" },
    { aPetId: "pet-4", bPetId: "pet-5" },
  ]);
});

test("un animal n'apparaît qu'une fois par session", () => {
  const duels = buildDuels(window(10), {
    judgeUserUid: "zimpo",
    seenPairs: new Set(),
    random: stable,
  });

  const seen = duels.flatMap((duel) => [duel.aPetId, duel.bPetId]);
  assert.equal(new Set(seen).size, seen.length);
});

test("une paire déjà vue par CE juré fait glisser sur le voisin suivant", () => {
  const duels = buildDuels(window(10), {
    judgeUserUid: "zimpo",
    seenPairs: new Set([pairKey("pet-0", "pet-1")]),
    count: 1,
    random: stable,
  });

  assert.deepEqual(duels, [{ aPetId: "pet-0", bPetId: "pet-2" }]);
});

test("le juré ne juge jamais ses propres animaux", () => {
  const pool = window(6).map((candidate, index) =>
    index === 0 ? { ...candidate, ownerUid: "zimpo" } : candidate,
  );

  const duels = buildDuels(pool, {
    judgeUserUid: "zimpo",
    seenPairs: new Set(),
    random: stable,
  });

  assert.ok(!duels.some((duel) => duel.aPetId === "pet-0" || duel.bPetId === "pet-0"));
});

test("le côté gauche n'est pas toujours le meilleur ELO", () => {
  const duels = buildDuels(window(4), {
    judgeUserUid: "zimpo",
    seenPairs: new Set(),
    count: 1,
    random: () => 0.9,
  });

  assert.deepEqual(duels, [{ aPetId: "pet-1", bPetId: "pet-0" }]);
});

test("une fenêtre trop pauvre rend moins de duels, sans planter", () => {
  assert.equal(buildDuels([], { judgeUserUid: "zimpo", seenPairs: new Set() }).length, 0);
  assert.equal(
    buildDuels(window(3), { judgeUserUid: "zimpo", seenPairs: new Set(), random: stable })
      .length,
    1,
  );
});
