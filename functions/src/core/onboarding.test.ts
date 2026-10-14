import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_ONBOARDING, readOnboarding } from "./onboarding";

test("garde les pages du document, dans l'ordre", () => {
  assert.deepEqual(
    readOnboarding({
      pages: [
        { title: "Un", body: "Premier", photo: "https://a" },
        { title: "Deux", body: "Second" },
      ],
    }),
    {
      pages: [
        { title: "Un", body: "Premier", photo: "https://a" },
        { title: "Deux", body: "Second", photo: null },
      ],
    },
  );
});

test("écarte une page sans titre ou sans texte", () => {
  assert.deepEqual(
    readOnboarding({ pages: [{ title: "", body: "x" }, { title: "Un", body: "  " }, 3, null] }),
    NO_ONBOARDING,
  );
});

test("une photo vide vaut pas de photo", () => {
  const page = readOnboarding({ pages: [{ title: "Un", body: "x", photo: " " }] }).pages[0];
  assert.equal(page.photo, null);
});

test("document absent ou malformé : aucune page", () => {
  assert.deepEqual(readOnboarding(undefined), NO_ONBOARDING);
  assert.deepEqual(readOnboarding({ pages: "Un" }), NO_ONBOARDING);
});
