import assert from "node:assert/strict";
import { test } from "node:test";
import { JoinInput, rejectJoin } from "./joinRules";

function input(overrides: Partial<JoinInput> = {}): JoinInput {
  return {
    status: "DRAFT",
    petOwnerUid: "zimpo",
    callerUid: "zimpo",
    alreadyRegistered: false,
    petPhotoUrl: "https://placedog.net/300/300?id=42",
    ...overrides,
  };
}

test("une inscription valide ne renvoie aucun rejet", () => {
  assert.equal(rejectJoin(input()), null);
});

test("on n'inscrit pas l'animal de quelqu'un d'autre", () => {
  assert.equal(rejectJoin(input({ petOwnerUid: "autre" })), "NOT_OWNER");
});

test("les participants s'inscrivent pendant DRAFT uniquement (D39)", () => {
  assert.equal(rejectJoin(input({ status: "ACTIVE" })), "CONTEST_NOT_DRAFT");
  assert.equal(rejectJoin(input({ status: "CLOSED" })), "CONTEST_NOT_DRAFT");
});

test("la clé participants/{petUid} empêche le doublon (D89)", () => {
  assert.equal(rejectJoin(input({ alreadyRegistered: true })), "ALREADY_REGISTERED");
});

test("sans photo il n'y a rien à juger ni rien à imprimer", () => {
  assert.equal(rejectJoin(input({ petPhotoUrl: null })), "PET_HAS_NO_PHOTO");
  assert.equal(rejectJoin(input({ petPhotoUrl: "" })), "PET_HAS_NO_PHOTO");
});

test("tous les animaux d'un même joueur peuvent viser le même concours (D89)", () => {
  // Rien au niveau du user n'est compté : deux animaux, deux inscriptions.
  assert.equal(rejectJoin(input({ petOwnerUid: "zimpo", callerUid: "zimpo" })), null);
});
