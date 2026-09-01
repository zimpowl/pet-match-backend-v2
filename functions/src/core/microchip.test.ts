import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { normalizeMicrochipId, isValidMicrochipId } from "./microchip";

describe("microchip", () => {
  describe("normalizeMicrochipId", () => {
    it("retourne null pour une entrée null", () => {
      assert.equal(normalizeMicrochipId(null), null);
    });

    it("retourne null pour une entrée undefined", () => {
      assert.equal(normalizeMicrochipId(undefined), null);
    });

    it("retourne null pour une chaîne vide", () => {
      assert.equal(normalizeMicrochipId(""), null);
    });

    it("retourne null pour une chaîne d'espaces", () => {
      assert.equal(normalizeMicrochipId("   "), null);
    });

    it("retire les espaces d'un numéro valide", () => {
      assert.equal(normalizeMicrochipId("123 456 789 012 345"), "123456789012345");
    });

    it("conserve un numéro sans espaces", () => {
      assert.equal(normalizeMicrochipId("123456789012345"), "123456789012345");
    });

    it("retire les espaces en début et fin", () => {
      assert.equal(normalizeMicrochipId("  123456789012345  "), "123456789012345");
    });
  });

  describe("isValidMicrochipId", () => {
    it("accepte un numéro de 15 chiffres", () => {
      assert.equal(isValidMicrochipId("123456789012345"), true);
    });

    it("refuse un numéro de 14 chiffres", () => {
      assert.equal(isValidMicrochipId("12345678901234"), false);
    });

    it("refuse un numéro de 16 chiffres", () => {
      assert.equal(isValidMicrochipId("1234567890123456"), false);
    });

    it("refuse un numéro contenant des lettres", () => {
      assert.equal(isValidMicrochipId("12345678901234A"), false);
    });

    it("refuse un numéro contenant des espaces", () => {
      assert.equal(isValidMicrochipId("123 456 789 012 345"), false);
    });

    it("refuse une chaîne vide", () => {
      assert.equal(isValidMicrochipId(""), false);
    });

    it("refuse un numéro avec caractères spéciaux", () => {
      assert.equal(isValidMicrochipId("123-456-789-012-345"), false);
    });
  });
});
