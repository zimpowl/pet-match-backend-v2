import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeClosing,
  composeGrade,
  composeOpening,
  composeReminder,
  composeVerification,
  remainingToday,
  resolveLocale,
  shouldRemind,
} from "./notifications";

const fr = resolveLocale(null);
const THEME = "Concours d'été";

test("la clôture dit que c'est tombé, et rien de plus", () => {
  const both = composeClosing({ theme: THEME, petName: "Heureux", wasJudge: true }, fr);
  const pet = composeClosing({ theme: THEME, petName: "Heureux", wasJudge: false }, fr);
  const judge = composeClosing({ theme: THEME, petName: null, wasJudge: true }, fr);

  for (const news of [both, pet, judge]) {
    assert.equal(news?.title, "Les résultats de « Concours d'été » sont tombés");
    assert.equal(news?.body, "Venez découvrir le classement final.");
    // Ni rang, ni sens, ni médaille : le dénouement est dans l'app.
    assert.doesNotMatch(`${news?.title} ${news?.body}`, /\d|monté|descendu|médaille|ELO/);
  }
});

test("qui n'a ni animal ni vote sur ce concours n'est pas notifié de la clôture", () => {
  assert.equal(composeClosing({ theme: THEME, petName: null, wasJudge: false }, fr), null);
});

test("le concours qui commence invite à voter et à s'inscrire au suivant", () => {
  const news = composeOpening({ theme: "Automne" }, fr);

  assert.equal(news.title, "Le concours « Automne » commence");
  assert.equal(news.body, "Venez voter. Les inscriptions du suivant sont ouvertes.");
});

test("le rappel dit ce qui reste et ce qui se perd", () => {
  const news = composeReminder({ theme: THEME, remaining: 5 }, fr);

  assert.equal(news?.title, "Vos votes vous attendent");
  assert.equal(
    news?.body,
    "Il vous en reste cinq pour « Concours d'été » avant 18 h. Après, ils sont perdus.",
  );
});

test("ce qui reste est l'allocation du jour, bornée par le plafond", () => {
  assert.equal(remainingToday({ votesCast: 20, maxVotesPerJudge: 70, dailyCapacity: 10 }), 10);
  assert.equal(remainingToday({ votesCast: 66, maxVotesPerJudge: 70, dailyCapacity: 10 }), 4);
  assert.equal(remainingToday({ votesCast: 70, maxVotesPerJudge: 70, dailyCapacity: 10 }), 0);
  assert.equal(composeReminder({ theme: THEME, remaining: 0 }, fr), null);
});

test("on ne rappelle que le juré qui n'a rien posé aujourd'hui", () => {
  const base = { votesToday: 0, votesCast: 20, maxVotesPerJudge: 70, dailyCapacity: 10 };

  assert.equal(shouldRemind(base), true);
  assert.equal(shouldRemind({ ...base, votesToday: 1 }), false);
});

test("on ne dit jamais « venez voter » à quelqu'un qui est Complet", () => {
  assert.equal(
    shouldRemind({ votesToday: 0, votesCast: 70, maxVotesPerJudge: 70, dailyCapacity: 10 }),
    false,
  );
});

test("un concours sans allocation ne rappelle rien", () => {
  assert.equal(
    shouldRemind({ votesToday: 0, votesCast: 0, maxVotesPerJudge: 0, dailyCapacity: 0 }),
    false,
  );
});

test("un grade se dit en un nom, et invite à voir la progression", () => {
  const pet = composeGrade({ level: 3, name: "Aguerri", petName: "Uno" }, fr);
  const judge = composeGrade({ level: 2, name: "Confirmé", petName: null }, fr);

  assert.equal(pet.title, "Uno devient Aguerri");
  assert.equal(pet.body, "Venez voir sa progression.");
  assert.equal(judge.title, "Vous devenez Confirmé");
  assert.equal(judge.body, "Venez voir votre progression.");
});

test("le refus d'une pièce ne recopie jamais le motif tapé pendant la revue", () => {
  const mine = composeVerification({ accepted: false, petName: null }, fr);
  const pet = composeVerification({ accepted: false, petName: "Uno" }, fr);

  assert.equal(mine.title, "Pièce non validée");
  assert.equal(mine.body, "Votre pièce n'a pas pu être validée. Ouvrez l'app pour voir pourquoi.");
  assert.equal(
    pet.body,
    "La pièce déposée pour Uno n'a pas pu être validée. Ouvrez l'app pour voir pourquoi.",
  );
});

test("une identité validée ne genre pas l'animal", () => {
  const pet = composeVerification({ accepted: true, petName: "Nala" }, fr);

  assert.equal(pet.body, "L'identité de Nala est validée. Venez voir sa progression.");
});

test("aucun emoji, aucun point d'exclamation, aucune félicitation, aucun tutoiement", () => {
  const all = [
    composeClosing({ theme: THEME, petName: "Heureux", wasJudge: true }, fr),
    composeOpening({ theme: THEME }, fr),
    composeReminder({ theme: THEME, remaining: 5 }, fr),
    composeGrade({ level: 3, name: "Aguerri", petName: "Uno" }, fr),
    composeGrade({ level: 3, name: "Aguerri", petName: null }, fr),
    composeVerification({ accepted: true, petName: null }, fr),
    composeVerification({ accepted: false, petName: null }, fr),
  ];

  for (const news of all) {
    const text = `${news?.title} ${news?.body}`;
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, text);
    assert.doesNotMatch(text, /!/, text);
    assert.doesNotMatch(text, /bravo|félicitations|super|génial/i, text);
    // Frontières Unicode obligatoires : en JavaScript `\b` est ASCII, donc
    // `\bTes\b` matcherait « tes » à l'intérieur de « êtes ».
    assert.doesNotMatch(text, /(?<!\p{L})(tu|tes|ton|ta|toi|tien|viens)(?!\p{L})/iu, text);
  }
});
