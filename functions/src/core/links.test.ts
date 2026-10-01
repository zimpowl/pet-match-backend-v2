import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFrom, dayKey, platformOf } from "./links";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Safari/537.36";

test("un iPhone va sur l'App Store, un Android sur le Play Store", () => {
  assert.equal(platformOf(IPHONE), "ios");
  assert.equal(platformOf(ANDROID), "android");
});

test("un iPad compte comme iOS : l'app y tourne", () => {
  assert.equal(platformOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "ios");
});

test("un Mac n'est pas un iPhone : il tombe sur le site", () => {
  assert.equal(platformOf(MAC), "web");
});

test("sans en-tête, le repli est le site — jamais une fiche de magasin", () => {
  assert.equal(platformOf(undefined), "web");
  assert.equal(platformOf(""), "web");
});

test("le code se lit dans le chemin que transmet l'hébergement", () => {
  assert.equal(codeFrom("/go/clinique-durand", undefined), "clinique-durand");
  assert.equal(codeFrom("/go/insta-bio/", undefined), "insta-bio");
});

test("le code se lit aussi dans la requête, pour tester sans l'hébergement", () => {
  assert.equal(codeFrom("/", "insta-bio"), "insta-bio");
  assert.equal(codeFrom(undefined, "insta-bio"), "insta-bio");
});

test("la casse ne compte pas : un QR imprimé ne se corrige pas", () => {
  assert.equal(codeFrom("/go/Clinique-DURAND", undefined), "clinique-durand");
});

test("un code absent ou malformé ne rend rien, il ne devine pas", () => {
  assert.equal(codeFrom("/go/", undefined), null);
  assert.equal(codeFrom("/go/-tiret-devant", undefined), null);
  assert.equal(codeFrom("/go/avec espace", undefined), null);
  assert.equal(codeFrom("/go/" + "a".repeat(65), undefined), null);
});

test("le chemin nu `/go` ne vaut pas un code", () => {
  assert.equal(codeFrom("/go", undefined), null);
});

test("le jour est celui de Paris, pas celui du serveur", () => {
  // 2026-10-01 23:30 UTC = le 2 octobre à 01h30 à Paris.
  assert.equal(dayKey(Date.UTC(2026, 9, 1, 23, 30)), "2026-10-02");
  assert.equal(dayKey(Date.UTC(2026, 9, 1, 12, 0)), "2026-10-01");
});
