import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { sharePercents } from "./share";

describe("share", () => {
  describe("sharePercents", () => {
    it("retourne 50/50 pour 0/0", () => {
      const result = sharePercents(0, 0);
      assert.equal(result.a, 50);
      assert.equal(result.b, 50);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 100/0 pour 1/0", () => {
      const result = sharePercents(1, 0);
      assert.equal(result.a, 100);
      assert.equal(result.b, 0);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 0/100 pour 0/1", () => {
      const result = sharePercents(0, 1);
      assert.equal(result.a, 0);
      assert.equal(result.b, 100);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 33/67 pour 1/2 (arrondi correct)", () => {
      const result = sharePercents(1, 2);
      assert.equal(result.a, 33);
      assert.equal(result.b, 67);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 67/33 pour 2/1", () => {
      const result = sharePercents(2, 1);
      assert.equal(result.a, 67);
      assert.equal(result.b, 33);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 50/50 pour 1/1", () => {
      const result = sharePercents(1, 1);
      assert.equal(result.a, 50);
      assert.equal(result.b, 50);
      assert.equal(result.a + result.b, 100);
    });

    it("retourne 75/25 pour 3/1", () => {
      const result = sharePercents(3, 1);
      assert.equal(result.a, 75);
      assert.equal(result.b, 25);
      assert.equal(result.a + result.b, 100);
    });

    it("somme toujours à 100 pour 7/3", () => {
      const result = sharePercents(7, 3);
      assert.equal(result.a, 70);
      assert.equal(result.b, 30);
      assert.equal(result.a + result.b, 100);
    });

    it("somme toujours à 100 pour 99/1", () => {
      const result = sharePercents(99, 1);
      assert.equal(result.a, 99);
      assert.equal(result.b, 1);
      assert.equal(result.a + result.b, 100);
    });

    it("somme toujours à 100 pour de grands nombres", () => {
      const result = sharePercents(1234, 5678);
      assert.equal(result.a + result.b, 100);
    });
  });
});
