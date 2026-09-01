import assert from "node:assert/strict";
import { test } from "node:test";
import { pairKey } from "../core/elo";
import {
  assignNumbers,
  mapSex,
  mapSpecies,
  mapStatus,
  normalizeName,
  parseBirthDate,
  petCreationFields,
  remapPairKey,
  resolvePet,
  statsFromRanks,
} from "./mapping";

test("REWARDED était un concours clos et payé : il devient CLOSED (§6)", () => {
  assert.equal(mapStatus("REWARDED"), "CLOSED");
  assert.equal(mapStatus("CLOSED"), "CLOSED");
  assert.equal(mapStatus("ACTIVE"), "ACTIVE");
  assert.equal(mapStatus("DRAFT"), "DRAFT");
});

test("un statut inconnu n'est pas deviné, il est signalé", () => {
  assert.equal(mapStatus("PENDING"), null);
  assert.equal(mapStatus(undefined), null);
});

test("espèce et sexe sont des énumérations fermées", () => {
  assert.equal(mapSpecies("DOG"), "DOG");
  assert.equal(mapSpecies("HORSE"), null);
  assert.equal(mapSex("FEMALE"), "FEMALE");
  assert.equal(mapSex("F"), null);
});

test("une date ISO devient minuit UTC, le reste devient null", () => {
  assert.equal(parseBirthDate("2019-11-21"), Date.parse("2019-11-21T00:00:00.000Z"));
  assert.equal(parseBirthDate(" 2019-11-21 "), Date.parse("2019-11-21T00:00:00.000Z"));
  assert.equal(parseBirthDate(null), null);
  assert.equal(parseBirthDate(undefined), null);
  assert.equal(parseBirthDate("21/11/2019"), null);
  assert.equal(parseBirthDate(1_600_000_000_000), null);
});

test("un Timestamp déjà propre passe tel quel", () => {
  assert.equal(parseBirthDate({ toMillis: () => 42 }), 42);
});

test("les noms se comparent sans casse ni espaces superflus", () => {
  assert.equal(normalizeName("  Heureux  "), "heureux");
  assert.equal(normalizeName("Le  Grand   Chien"), "le grand chien");
  assert.equal(normalizeName(undefined), "");
});

test("un participant qui porte son petUid le garde", () => {
  const resolution = resolvePet({ userUid: "u1", petUid: "pet-9", petName: "Autre" }, []);
  assert.deepEqual(resolution, { kind: "DECLARED", petId: "pet-9" });
});

test("sans petUid, on retrouve l'animal par son nom chez son propriétaire", () => {
  const resolution = resolvePet({ userUid: "u1", petName: " heureux " }, [
    { petId: "pet-1", name: "Mia" },
    { petId: "pet-2", name: "Heureux" },
  ]);
  assert.deepEqual(resolution, { kind: "MATCHED", petId: "pet-2" });
});

test("aucun nom ne correspond : l'animal est à créer", () => {
  assert.deepEqual(
    resolvePet({ userUid: "u1", petName: "Inconnu" }, [{ petId: "pet-1", name: "Mia" }]),
    { kind: "CREATE" },
  );
});

test("un participant sans nom d'animal ne matche personne par accident", () => {
  assert.deepEqual(
    resolvePet({ userUid: "u1", petName: "   " }, [{ petId: "pet-1", name: undefined }]),
    { kind: "CREATE" },
  );
});

test("une clé de paire passe des userUid aux petId", () => {
  const map = new Map([
    ["userA", "petZ"],
    ["userB", "petA"],
  ]);
  assert.equal(remapPairKey("userA_userB", map), pairKey("petZ", "petA"));
  // La clé reste indépendante de l'ordre après remappage.
  assert.equal(remapPairKey("userB_userA", map), pairKey("petZ", "petA"));
});

test("une clé dont un côté est inconnu n'est pas réécrite au hasard", () => {
  const map = new Map([["userA", "petZ"]]);
  assert.equal(remapPairKey("userA_userB", map), null);
  assert.equal(remapPairKey("nimportequoi", map), null);
  assert.equal(remapPairKey("a_b_c", map), null);
});

test("les médailles se comptent sur les podiums, une médaille = une médaille", () => {
  assert.deepEqual(statsFromRanks([1, 1, 2, 3, 7, null]), {
    contests: 6,
    bestRank: 1,
    gold: 2,
    silver: 1,
    bronze: 1,
  });
});

test("aucun classement du tout : pas de meilleur rang", () => {
  assert.deepEqual(statsFromRanks([null, null]), {
    contests: 2,
    bestRank: null,
    gold: 0,
    silver: 0,
    bronze: 0,
  });
});

test("les numéros suivent l'ancienneté, jamais l'ordre de lecture", () => {
  const numbers = assignNumbers([
    { id: "c", createdAtMillis: 300 },
    { id: "a", createdAtMillis: 100 },
    { id: "b", createdAtMillis: 200 },
  ]);

  assert.equal(numbers.get("a"), 1);
  assert.equal(numbers.get("b"), 2);
  assert.equal(numbers.get("c"), 3);
});

test("à égalité de date, l'identifiant départage : la numérotation est déterministe", () => {
  const first = assignNumbers([
    { id: "zz", createdAtMillis: 0 },
    { id: "aa", createdAtMillis: 0 },
  ]);
  const second = assignNumbers([
    { id: "aa", createdAtMillis: 0 },
    { id: "zz", createdAtMillis: 0 },
  ]);

  assert.deepEqual([...first], [...second]);
  assert.equal(first.get("aa"), 1);
});

test("un animal à créer récupère les champs dénormalisés du participant", () => {
  assert.deepEqual(
    petCreationFields({ userUid: "u", petName: " Nala ", imageUrl: " http://x ", petBreed: "" }),
    { name: "Nala", photoUrl: "http://x", breed: null },
  );
});
