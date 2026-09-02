import assert from "node:assert/strict";
import { test } from "node:test";
import { composeClosing, composeEvening, resolveLocale } from "./notifications";

const fr = resolveLocale(null);

test("l'animal qui remonte : le mouvement porte le titre", () => {
  const news = composeEvening(
    { day: 3, pet: { name: "Heureux", rank: 4, rankPrevious: 7, total: 31 }, judge: null },
    fr,
  );

  assert.equal(news?.title, "Heureux gagne trois places");
  assert.equal(news?.body, "4e sur 31, au soir du jour 3.");
});

test("une seule place se dit au singulier", () => {
  const news = composeEvening(
    { day: 2, pet: { name: "Mia", rank: 5, rankPrevious: 6, total: 31 }, judge: null },
    fr,
  );

  assert.equal(news?.title, "Mia gagne une place");
});

test("l'animal qui recule : on le dit, sans le maquiller", () => {
  const news = composeEvening(
    { day: 4, pet: { name: "Heureux", rank: 9, rankPrevious: 7, total: 31 }, judge: null },
    fr,
  );

  assert.equal(news?.title, "Heureux perd deux places");
  assert.equal(news?.body, "9e sur 31, au soir du jour 4.");
});

test("on ne genre jamais l'animal : l'accord se fait avec « place »", () => {
  const first = composeEvening(
    { day: 5, pet: { name: "Nala", rank: 1, rankPrevious: 1, total: 31 }, judge: null },
    fr,
  );
  const third = composeEvening(
    { day: 5, pet: { name: "Volt", rank: 3, rankPrevious: 3, total: 31 }, judge: null },
    fr,
  );

  assert.equal(first?.title, "Nala tient la première place");
  assert.equal(third?.title, "Volt tient la troisième place");
});

test("un rang immobile hors du podium n'est pas une nouvelle", () => {
  assert.equal(
    composeEvening(
      { day: 3, pet: { name: "Heureux", rank: 12, rankPrevious: 12, total: 31 }, judge: null },
      fr,
    ),
    null,
  );
});

test("le podium immobile, lui, se dit chaque soir", () => {
  assert.ok(
    composeEvening(
      { day: 3, pet: { name: "Heureux", rank: 2, rankPrevious: 2, total: 31 }, judge: null },
      fr,
    ),
  );
});

test("un animal non classé ne déclenche rien", () => {
  assert.equal(
    composeEvening(
      { day: 1, pet: { name: "Heureux", rank: null, rankPrevious: null, total: 31 }, judge: null },
      fr,
    ),
    null,
  );
});

test("participant ET juré : une seule notification, pas deux", () => {
  const news = composeEvening(
    {
      day: 3,
      pet: { name: "Heureux", rank: 4, rankPrevious: 7, total: 31 },
      judge: { rank: 2, rankPrevious: 5, total: 24, dailyCapacity: 5 },
    },
    fr,
  );

  assert.equal(news?.title, "Heureux gagne trois places");
  assert.equal(
    news?.body,
    "4e sur 31, au soir du jour 3. Au jury, tu gagnes trois places et tu es 2e." +
      " Tes cinq votes du jour sont ouverts.",
  );
});

test("le juré seul : sa position, puis la relance de ses votes", () => {
  const news = composeEvening(
    { day: 3, pet: null, judge: { rank: 4, rankPrevious: 6, total: 24, dailyCapacity: 10 } },
    fr,
  );

  assert.equal(news?.title, "Tu gagnes deux places au jury");
  assert.equal(news?.body, "4e sur 24, au soir du jour 3. Tes dix votes du jour sont ouverts.");
});

test("le résultat et la relance sont le même geste (D38)", () => {
  // Même quand le rang du juré ne bouge pas, l'allocation est annoncée si son
  // animal, lui, a une nouvelle.
  const news = composeEvening(
    {
      day: 6,
      pet: { name: "Heureux", rank: 1, rankPrevious: 2, total: 31 },
      judge: { rank: 18, rankPrevious: 18, total: 24, dailyCapacity: 5 },
    },
    fr,
  );

  assert.equal(news?.title, "Heureux gagne une place");
  assert.equal(news?.body, "1er sur 31, au soir du jour 6. Tes cinq votes du jour sont ouverts.");
});

test("la clôture notifie toujours, podium ou pas", () => {
  const podium = composeClosing(
    { pet: { name: "Heureux", rank: 1, total: 31, elo: 1266.4 }, judge: null },
    fr,
  );
  const rest = composeClosing(
    { pet: { name: "Heureux", rank: 8, total: 31, elo: 1237.2 }, judge: null },
    fr,
  );

  assert.equal(podium?.title, "Heureux termine à la première place");
  assert.equal(podium?.body, "1er sur 31, ELO 1266. Ta slab est disponible.");
  assert.equal(rest?.title, "Heureux termine à la 8e place");
  assert.equal(rest?.body, "8e sur 31, ELO 1237. Ta slab est disponible.");
});

test("l'ELO n'apparaît qu'à la clôture, et il y est arrondi", () => {
  const news = composeClosing(
    { pet: { name: "Uno", rank: 1, total: 31, elo: 1299.7 }, judge: null },
    fr,
  );
  assert.match(news?.body ?? "", /ELO 1300/);
});

test("la clôture du juré donne la justesse, connue seulement là", () => {
  const news = composeClosing(
    { pet: null, judge: { rank: 2, total: 24, votes: 70, correctVotes: 58 } },
    fr,
  );

  assert.equal(news?.title, "Tu termines à la deuxième place du jury");
  assert.equal(news?.body, "58 votes justes sur 70, précision 83 %. Ta slab est disponible.");
});

test("un juré sans vote ne divise pas par zéro", () => {
  const news = composeClosing(
    { pet: null, judge: { rank: 24, total: 24, votes: 0, correctVotes: 0 } },
    fr,
  );
  assert.match(news?.body ?? "", /précision 0 %/);
});

test("aucun emoji, aucun point d'exclamation, aucune félicitation", () => {
  const all = [
    composeEvening(
      {
        day: 3,
        pet: { name: "Heureux", rank: 4, rankPrevious: 7, total: 31 },
        judge: { rank: 2, rankPrevious: 5, total: 24, dailyCapacity: 5 },
      },
      fr,
    ),
    composeClosing(
      {
        pet: { name: "Heureux", rank: 1, total: 31, elo: 1266 },
        judge: { rank: 2, total: 24, votes: 70, correctVotes: 58 },
      },
      fr,
    ),
  ];

  for (const news of all) {
    const text = `${news?.title} ${news?.body}`;
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, text);
    assert.doesNotMatch(text, /!/, text);
    assert.doesNotMatch(text, /bravo|félicitations|super|génial/i, text);
  }
});
