import assert from "node:assert/strict";
import { test } from "node:test";
import { EntryChangeInput, JoinInput, rejectEntryChange, rejectJoin } from "./joinRules";

function input(overrides: Partial<JoinInput> = {}): JoinInput {
  return {
    status: "DRAFT",
    petOwnerUid: "zimpo",
    callerUid: "zimpo",
    alreadyRegistered: false,
    photoUrl: "https://placedog.net/300/300?id=42",
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
  assert.equal(rejectJoin(input({ photoUrl: null })), "PET_HAS_NO_PHOTO");
  assert.equal(rejectJoin(input({ photoUrl: "" })), "PET_HAS_NO_PHOTO");
});

test("tous les animaux d'un même joueur peuvent viser le même concours (D89)", () => {
  // Rien au niveau du user n'est compté : deux animaux, deux inscriptions.
  assert.equal(rejectJoin(input({ petOwnerUid: "zimpo", callerUid: "zimpo" })), null);
});

function change(overrides: Partial<EntryChangeInput> = {}): EntryChangeInput {
  return {
    status: "DRAFT",
    participantOwnerUid: "zimpo",
    callerUid: "zimpo",
    photoUrl: "https://placedog.net/300/300?id=42",
    requiresPhoto: true,
    ...overrides,
  };
}

test("reprendre son inscription pendant DRAFT ne renvoie aucun rejet", () => {
  assert.equal(rejectEntryChange(change()), null);
});

test("on ne reprend pas une inscription qui n'existe pas", () => {
  assert.equal(rejectEntryChange(change({ participantOwnerUid: null })), "NOT_REGISTERED");
});

test("on ne reprend pas l'inscription de quelqu'un d'autre", () => {
  assert.equal(rejectEntryChange(change({ participantOwnerUid: "autre" })), "NOT_OWNER");
});

test("une fois le concours lancé, l'inscription est engagée (D39)", () => {
  assert.equal(rejectEntryChange(change({ status: "ACTIVE" })), "CONTEST_NOT_DRAFT");
  assert.equal(rejectEntryChange(change({ status: "CLOSED" })), "CONTEST_NOT_DRAFT");
});

test("changer de photo en demande une ; un retrait n'en demande aucune", () => {
  assert.equal(rejectEntryChange(change({ photoUrl: null })), "PET_HAS_NO_PHOTO");
  assert.equal(rejectEntryChange(change({ photoUrl: null, requiresPhoto: false })), null);
});

test("un retrait hors DRAFT reste refusé, photo ou pas", () => {
  assert.equal(
    rejectEntryChange(change({ status: "ACTIVE", photoUrl: null, requiresPhoto: false })),
    "CONTEST_NOT_DRAFT",
  );
});
