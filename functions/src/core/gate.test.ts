import assert from "node:assert/strict";
import { test } from "node:test";
import { OPEN_GATE, isPlatform, readGate, updateRequired } from "./gate";

test("un document absent ouvre la porte", () => {
  assert.deepEqual(readGate(undefined), OPEN_GATE);
  assert.deepEqual(readGate(null), OPEN_GATE);
});

test("un document d'un autre type ouvre la porte", () => {
  assert.deepEqual(readGate("bloque tout"), OPEN_GATE);
  assert.deepEqual(readGate(42), OPEN_GATE);
});

test("une plateforme manquante est ouverte, l'autre est lue", () => {
  const gate = readGate({ android: { minimumCode: 55, latestCode: 58 } });

  assert.equal(gate.android.minimumCode, 55);
  assert.equal(gate.ios.minimumCode, 0);
});

test("une chaîne n'est pas un numéro de build : elle ne ferme rien", () => {
  const gate = readGate({ android: { minimumCode: "55" }, ios: { minimumCode: "3" } });

  assert.equal(gate.android.minimumCode, 0);
  assert.equal(gate.ios.minimumCode, 0);
});

test("un minimum négatif ou fractionnaire ne ferme rien", () => {
  assert.equal(readGate({ android: { minimumCode: -1 } }).android.minimumCode, 0);
  assert.equal(readGate({ android: { minimumCode: 55.5 } }).android.minimumCode, 0);
});

test("un build sous le minimum doit se mettre à jour", () => {
  const gate = readGate({ android: { minimumCode: 55, latestCode: 58 } });

  assert.equal(updateRequired(gate, "android", 54), true);
});

test("le minimum lui-même passe : c'est le plus ancien accepté", () => {
  const gate = readGate({ android: { minimumCode: 55, latestCode: 58 } });

  assert.equal(updateRequired(gate, "android", 55), false);
  assert.equal(updateRequired(gate, "android", 56), false);
});

test("un minimum à zéro ne bloque personne, pas même le build zéro", () => {
  assert.equal(updateRequired(OPEN_GATE, "android", 0), false);
  assert.equal(updateRequired(OPEN_GATE, "ios", 0), false);
});

test("les deux plateformes sont indépendantes", () => {
  const gate = readGate({ android: { minimumCode: 200 }, ios: { minimumCode: 0 } });

  assert.equal(updateRequired(gate, "android", 198), true);
  assert.equal(updateRequired(gate, "ios", 3), false);
});

test("seules les deux plateformes connues sont acceptées", () => {
  assert.equal(isPlatform("android"), true);
  assert.equal(isPlatform("ios"), true);
  assert.equal(isPlatform("web"), false);
  assert.equal(isPlatform(undefined), false);
});
