import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeClosing,
  composeEvening,
  composeReminder,
  resolveLocale,
  shouldRemind,
} from "./notifications";

const fr = resolveLocale(null);
const THEME = "Concours d'été";

test("la notification constate le sens, jamais le rang (§4.2 bis)", () => {
  const up = composeEvening(
    { theme: THEME, pet: { name: "Heureux", rank: 4, rankPrevious: 7 }, judge: null },
    fr,
  );

  assert.equal(up?.title, "Heureux est monté au classement");
  assert.equal(up?.body, "Concours « Concours d'été ». Venez découvrir son rang.");
  // Aucun chiffre de classement ne doit fuiter : la tension est dans l'inconnu.
  assert.doesNotMatch(`${up?.title} ${up?.body}`, /\d/);
});

test("descendre se dit, sans le maquiller", () => {
  const down = composeEvening(
    { theme: THEME, pet: { name: "Heureux", rank: 9, rankPrevious: 7 }, judge: null },
    fr,
  );

  assert.equal(down?.title, "Heureux est descendu au classement");
  assert.equal(down?.body, "Concours « Concours d'été ». Venez découvrir son rang.");
});

test("un rang immobile hors du podium ne notifie rien", () => {
  assert.equal(
    composeEvening(
      { theme: THEME, pet: { name: "Heureux", rank: 12, rankPrevious: 12 }, judge: null },
      fr,
    ),
    null,
  );
});

test("sur le podium, tenir sa place est une nouvelle", () => {
  const held = composeEvening(
    { theme: THEME, pet: { name: "Uno", rank: 1, rankPrevious: 1 }, judge: null },
    fr,
  );

  assert.equal(held?.title, "Uno garde sa place sur le podium");
});

test("on ne genre jamais l'animal", () => {
  for (const name of ["Nala", "Mia", "Heureux"]) {
    const news = composeEvening(
      { theme: THEME, pet: { name, rank: 2, rankPrevious: 2 }, judge: null },
      fr,
    );
    // « monté », « descendu », « garde sa place » : rien ne s'accorde avec l'animal.
    assert.doesNotMatch(news?.title ?? "", /première|deuxième|montée|descendue/);
  }
});

test("un animal non classé ne déclenche rien", () => {
  assert.equal(
    composeEvening(
      { theme: THEME, pet: { name: "Heureux", rank: null, rankPrevious: null }, judge: null },
      fr,
    ),
    null,
  );
});

test("participant ET juré : une seule notification", () => {
  const news = composeEvening(
    {
      theme: THEME,
      pet: { name: "Heureux", rank: 4, rankPrevious: 7 },
      judge: { rank: 2, rankPrevious: 5 },
    },
    fr,
  );

  assert.equal(news?.title, "Heureux est monté au classement");
  assert.equal(
    news?.body,
    "Concours « Concours d'été ». Vous êtes également monté au jury." +
      " Venez découvrir vos rangs.",
  );
});

test("le juré seul a son propre titre", () => {
  const news = composeEvening(
    { theme: THEME, pet: null, judge: { rank: 9, rankPrevious: 6 } },
    fr,
  );

  assert.equal(news?.title, "Vous êtes descendu au classement du jury");
  assert.equal(news?.body, "Concours « Concours d'été ». Venez découvrir votre rang.");
});

test("le thème garde sa majuscule dans le titre de clôture", () => {
  const news = composeClosing({ theme: "Pleine lune", petName: "Uno", wasJudge: false }, fr);
  assert.equal(news?.title, "Le concours « Pleine lune » est clos");
});

test("la clôture ne dit que la clôture : ni sens, ni rang, ni médaille", () => {
  const both = composeClosing({ theme: THEME, petName: "Heureux", wasJudge: true }, fr);
  const pet = composeClosing({ theme: THEME, petName: "Heureux", wasJudge: false }, fr);
  const judge = composeClosing({ theme: THEME, petName: null, wasJudge: true }, fr);

  assert.equal(both?.title, "Le concours « Concours d'été » est clos");
  assert.equal(both?.body, "Le résultat de Heureux et le vôtre vous attendent.");
  assert.equal(pet?.body, "Le résultat de Heureux vous attend.");
  assert.equal(judge?.body, "Votre résultat de juré vous attend.");

  for (const news of [both, pet, judge]) {
    assert.doesNotMatch(`${news?.title} ${news?.body}`, /\d|monté|descendu|or|médaille|ELO/);
  }
});

test("qui n'a ni animal ni vote sur ce concours n'est pas notifié", () => {
  assert.equal(composeClosing({ theme: THEME, petName: null, wasJudge: false }, fr), null);
});

test("le rappel de l'après-midi donne le seul chiffre permis : mon budget", () => {
  const news = composeReminder({ theme: THEME, dailyCapacity: 10 }, fr);

  assert.equal(news?.title, "Vos dix votes du jour expirent à 18 h");
  assert.equal(news?.body, "Concours « Concours d'été ». Ce qui n'est pas posé est perdu.");
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
  assert.equal(composeReminder({ theme: THEME, dailyCapacity: 0 }, fr), null);
});

test("aucun emoji, aucun point d'exclamation, aucune félicitation, aucun tutoiement", () => {
  const all = [
    composeEvening(
      {
        theme: THEME,
        pet: { name: "Heureux", rank: 4, rankPrevious: 7 },
        judge: { rank: 2, rankPrevious: 5 },
      },
      fr,
    ),
    composeClosing({ theme: THEME, petName: "Heureux", wasJudge: true }, fr),
    composeReminder({ theme: THEME, dailyCapacity: 5 }, fr),
  ];

  for (const news of all) {
    const text = `${news?.title} ${news?.body}`;
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, text);
    assert.doesNotMatch(text, /!/, text);
    assert.doesNotMatch(text, /bravo|félicitations|super|génial/i, text);
    // Frontières Unicode obligatoires : en JavaScript `\b` est ASCII, donc
    // `\bTes\b` matcherait « tes » à l'intérieur de « êtes ».
    assert.doesNotMatch(text, /(?<!\p{L})(tu|tes|ton|ta|toi|tien)(?!\p{L})/iu, text);
  }
});
