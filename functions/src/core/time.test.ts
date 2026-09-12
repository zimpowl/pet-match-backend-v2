import { strict as assert } from "node:assert";
import test from "node:test";
import { CONTEST_ZONE, atContestHour } from "./time";

function parisHour(millis: number): string {
  return new Date(millis).toLocaleString("sv-SE", { timeZone: CONTEST_ZONE }).slice(11, 16);
}

function parisDay(millis: number): string {
  return new Date(millis).toLocaleString("sv-SE", { timeZone: CONTEST_ZONE }).slice(0, 10);
}

test("un instant d'été retombe à 18 h de Paris, le même jour", () => {
  const summer = Date.parse("2026-07-15T09:32:11Z");
  assert.equal(parisHour(atContestHour(summer)), "18:00");
  assert.equal(parisDay(atContestHour(summer)), "2026-07-15");
});

test("un instant d'hiver aussi, malgré l'heure d'hiver", () => {
  const winter = Date.parse("2026-01-15T23:10:00Z");
  assert.equal(parisHour(atContestHour(winter)), "18:00");
  assert.equal(parisDay(atContestHour(winter)), "2026-01-16");
});

test("le dimanche du passage à l'heure d'hiver ne glisse pas", () => {
  const change = Date.parse("2026-10-25T02:30:00Z");
  assert.equal(parisHour(atContestHour(change)), "18:00");
  assert.equal(parisDay(atContestHour(change)), "2026-10-25");
});

test("appliquer deux fois ne change rien", () => {
  const once = atContestHour(Date.parse("2026-09-06T18:00:00Z"));
  assert.equal(atContestHour(once), once);
});
