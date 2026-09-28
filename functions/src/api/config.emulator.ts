import assert from "node:assert/strict";
import { before, test } from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = "pet-match---debug";
const BASE = `http://127.0.0.1:5001/${PROJECT}/us-central1/getAppConfigHttp`;

initializeApp({ projectId: PROJECT });

/**
 * La porte de version, de bout en bout.
 *
 * Le document est posé **une seule fois, avant tout appel** : l'endpoint garde
 * sa lecture en mémoire une minute, donc le modifier entre deux tests ne se
 * verrait pas. Les variantes se jouent sur les paramètres de requête, qui ne
 * sont pas mis en cache.
 *
 * Les cas de document absent ou malformé sont couverts par les tests unitaires
 * de `core/gate`, sans émulateur.
 */
before(async () => {
  await getFirestore()
    .collection("configuration")
    .doc("version")
    .set({
      android: { minimumCode: 198, latestCode: 210 },
      ios: { minimumCode: 3, latestCode: 8 },
    });
});

async function get(query = ""): Promise<{ status: number; headers: Headers; body: any }> {
  const response = await fetch(`${BASE}${query}`);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("la porte répond sans le moindre jeton", async () => {
  const { status, body } = await get();

  assert.equal(status, 200, "une app bloquée doit pouvoir lire la porte");
  assert.equal(body.android.minimumCode, 198);
  assert.equal(body.ios.minimumCode, 3);
});

test("un build trop vieux se voit répondre qu'il doit se mettre à jour", async () => {
  const { body } = await get("?platform=android&code=197");

  assert.equal(body.updateRequired, true);
});

test("le minimum lui-même passe", async () => {
  const { body } = await get("?platform=android&code=198");

  assert.equal(body.updateRequired, false);
});

test("chaque plateforme a sa propre porte", async () => {
  const android = await get("?platform=android&code=3");
  const ios = await get("?platform=ios&code=3");

  assert.equal(android.body.updateRequired, true, "3 est sous le minimum d'Android");
  assert.equal(ios.body.updateRequired, false, "3 est le minimum d'iOS");
});

test("une plateforme inconnue n'est pas une erreur", async () => {
  const { status, body } = await get("?platform=web&code=1");

  assert.equal(status, 200);
  assert.equal(body.updateRequired, undefined, "sans verdict, l'app compare elle-même");
  assert.equal(body.android.minimumCode, 198);
});

test("un code illisible n'est pas une erreur", async () => {
  const { status, body } = await get("?platform=android&code=beaucoup");

  assert.equal(status, 200);
  assert.equal(body.updateRequired, undefined);
});

test("la réponse se met en cache une minute", async () => {
  const { headers } = await get();

  assert.match(headers.get("cache-control") ?? "", /max-age=60/);
});
