import assert from "node:assert/strict";
import { test } from "node:test";
import { readPetInput } from "./petInput";

const valid = {
  name: "  Heureux ",
  species: "DOG",
  sex: "MALE",
  breed: "berger australien",
  birthDate: 1_600_000_000_000,
  countryCode: "FR",
  photoUrl: "https://placedog.net/300/300?id=42",
  microchipId: "250 269 604 000 001",
};

function unwrap(raw: unknown) {
  const result = readPetInput(raw);
  assert.ok(result.ok, "attendu une entrée valide");
  return result.input;
}

function rejection(raw: unknown) {
  const result = readPetInput(raw);
  assert.ok(!result.ok, "attendu un rejet");
  return result.rejection;
}

test("une entrée complète est acceptée et normalisée", () => {
  const input = unwrap(valid);

  assert.equal(input.name, "Heureux");
  assert.equal(input.species, "DOG");
  assert.equal(input.microchipId, "250269604000001");
});

test("le nom est obligatoire, et un nom d'espaces n'en est pas un", () => {
  assert.equal(rejection({ ...valid, name: "   " }), "NAME_REQUIRED");
  assert.equal(rejection({ ...valid, name: undefined }), "NAME_REQUIRED");
});

test("l'espèce et le sexe sont des énumérations fermées", () => {
  assert.equal(rejection({ ...valid, species: "HORSE" }), "SPECIES_INVALID");
  assert.equal(rejection({ ...valid, sex: "OTHER" }), "SEX_INVALID");
});

test("le pays est obligatoire", () => {
  assert.equal(rejection({ ...valid, countryCode: "" }), "COUNTRY_REQUIRED");
});

test("une puce mal formée est refusée, une puce absente est permise", () => {
  assert.equal(rejection({ ...valid, microchipId: "25026960400000" }), "MICROCHIP_INVALID");
  assert.equal(rejection({ ...valid, microchipId: "abcdefghijklmno" }), "MICROCHIP_INVALID");
  assert.equal(unwrap({ ...valid, microchipId: null }).microchipId, null);
});

test("les champs facultatifs tombent à null, jamais à undefined", () => {
  const input = unwrap({ name: "Mia", species: "CAT", sex: "FEMALE", countryCode: "FR" });

  assert.equal(input.breed, null);
  assert.equal(input.birthDate, null);
  assert.equal(input.photoUrl, null);
  assert.equal(input.microchipId, null);
});

test("les champs serveur passés par l'appelant sont ignorés", () => {
  const input = unwrap({ ...valid, number: 999, verifiedAt: 1, stats: { gold: 99 } });

  // La sortie ne porte que les champs du contrat : rien ne fuit vers Firestore.
  assert.deepEqual(Object.keys(input).sort(), [
    "birthDate",
    "breed",
    "countryCode",
    "microchipId",
    "name",
    "photoUrl",
    "sex",
    "species",
  ]);
});
