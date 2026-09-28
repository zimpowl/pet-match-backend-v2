/**
 * Fabriquer un vrai jeton d'identité contre l'émulateur d'authentification.
 *
 * `verifyIdToken` accepte les jetons non signés de l'émulateur dès que
 * `FIREBASE_AUTH_EMULATOR_HOST` est posé : le trajet testé est donc le vrai,
 * de la création du compte jusqu'à la vérification.
 */
import { getAuth } from "firebase-admin/auth";

export async function idTokenFor(uid: string): Promise<string> {
  const auth = getAuth();
  await auth.createUser({ uid }).catch(() => undefined);

  const custom = await auth.createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("émulateur d'authentification absent");

  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );

  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`échange du jeton refusé : ${JSON.stringify(body)}`);

  return body.idToken;
}

/**
 * Jouer un bloc comme si l'on était en production.
 *
 * `isDebugProject()` est vrai dès que `FIRESTORE_EMULATOR_HOST` est posé, et
 * `emulators:exec` le pose toujours. Sans ce retrait temporaire, aucun chemin
 * « production » ne serait testable. C'est sans danger : `identity.ts` ne
 * touche pas à Firestore, et l'émulateur d'authentification se joint par
 * **l'autre** variable.
 */
export async function asProduction<T>(run: () => Promise<T>): Promise<T> {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;

  delete process.env.FIRESTORE_EMULATOR_HOST;
  process.env.GCLOUD_PROJECT = "pet-match-30417";
  try {
    return await run();
  } finally {
    if (firestore !== undefined) process.env.FIRESTORE_EMULATOR_HOST = firestore;
    if (project !== undefined) process.env.GCLOUD_PROJECT = project;
  }
}
