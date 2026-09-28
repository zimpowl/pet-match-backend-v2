import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeApp } from "firebase-admin/app";
import { callerUid } from "./identity";
import { HttpError } from "./respond";
import { asProduction, idTokenFor } from "../test/tokens";

initializeApp({ projectId: "pet-match---debug" });

/**
 * Le point d'authentification, éprouvé contre les vrais émulateurs.
 *
 * Il n'avait aucun test, alors que c'est le seul endroit du dépôt où se décide
 * « qui parle ». Le premier cas est le plus important : un jeton valide pour un
 * compte ne doit jamais permettre d'agir sous un autre.
 */

test("le jeton fait foi : réclamer un autre uid ne change rien", async () => {
  const token = await idTokenFor("uid_A");

  const caller = await callerUid({ userUid: "uid_B" }, { userUid: "uid_B" }, `Bearer ${token}`);

  assert.equal(caller, "uid_A", "l'usurpation doit être sans effet");
});

test("le schéma bearer est insensible à la casse", async () => {
  const token = await idTokenFor("uid_C");

  assert.equal(await callerUid({}, null, `bearer ${token}`), "uid_C");
});

test("un jeton illisible est refusé, même sur un projet de debug", async () => {
  await assert.rejects(
    () => callerUid({ userUid: "uid_A" }, null, "Bearer n'importe-quoi"),
    (error: HttpError) => error.status === 403 && /invalide/.test(error.message),
    "un jeton présent mais faux ne doit jamais retomber sur l'uid déclaré",
  );
});

test("un autre schéma que bearer n'est pas analysé", async () => {
  await asProduction(async () => {
    await assert.rejects(
      () => callerUid({ userUid: "uid_A" }, null, "Basic abcdef"),
      (error: HttpError) => error.status === 403 && /manquant/.test(error.message),
    );
  });
});

test("en production, pas de jeton, pas d'appel", async () => {
  await asProduction(async () => {
    await assert.rejects(
      () => callerUid({ userUid: "uid_A" }, { userUid: "uid_A" }, undefined),
      (error: HttpError) => error.status === 403 && /manquant/.test(error.message),
    );
  });
});

test("en production, un jeton valide passe", async () => {
  const token = await idTokenFor("uid_D");

  const caller = await asProduction(() => callerUid({}, null, `Bearer ${token}`));

  assert.equal(caller, "uid_D");
});

test("sur un projet de debug, l'uid de la query sert de repli", async () => {
  assert.equal(await callerUid({ userUid: "uid_E" }, null, undefined), "uid_E");
});

test("le repli lit aussi le corps de la requête", async () => {
  assert.equal(await callerUid({}, { userUid: "uid_F" }, undefined), "uid_F");
});

test("le repli sans uid du tout est une requête mal formée", async () => {
  await assert.rejects(
    () => callerUid({}, null, undefined),
    (error: HttpError) => error.status === 400,
  );
});
