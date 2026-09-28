import { onRequest } from "firebase-functions/v2/https";
import { CONFIGURATION, VERSION, db } from "../firebase";
import { OPEN_GATE, VersionGate, isPlatform, readGate, updateRequired } from "../core/gate";
import { JsonResponse, Query, param, respond } from "../http/respond";

/** Une lecture par instance tiède plutôt qu'une par lancement d'app. */
const CACHE_MILLIS = 60_000;

let cached: { readonly gate: VersionGate; readonly at: number } | null = null;

interface ConfigResponse extends VersionGate {
  readonly updateRequired?: boolean;
}

/**
 * La porte de version, telle que l'app la lit au lancement.
 *
 * **Sans authentification, et c'est le point.** Une app assez vieille pour être
 * bloquée est peut-être assez vieille pour ne plus savoir présenter un jeton
 * valide. Une porte qui exige de s'authentifier est une porte qui ne peut pas
 * s'ouvrir.
 *
 * **Elle ne rend jamais d'erreur.** Document absent, malformé, Firestore
 * injoignable : la réponse est 200 avec une porte ouverte. C'est la seule route
 * du dépôt qui avale ses exceptions, parce qu'elle est la seule dont la panne
 * empêcherait l'app de démarrer.
 *
 *   GET getAppConfigHttp
 *   GET getAppConfigHttp?platform=android&code=198
 *
 * Sans `platform` ni `code`, elle rend les deux plateformes et laisse l'app
 * comparer. Avec, elle ajoute son propre verdict — de quoi déplacer la règle
 * côté serveur plus tard sans changer de route.
 */
export const getAppConfigHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<ConfigResponse> => {
    const gate = await load();
    const query = req.query as Query;
    const platform = param(query, "platform");
    const raw = param(query, "code");
    const build = raw === undefined ? undefined : Number.parseInt(raw, 10);

    res.set("Cache-Control", `public, max-age=${CACHE_MILLIS / 1000}`);

    if (!isPlatform(platform) || build === undefined || !Number.isFinite(build)) {
      return gate;
    }

    return { ...gate, updateRequired: updateRequired(gate, platform, build) };
  }),
);

async function load(): Promise<VersionGate> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MILLIS) return cached.gate;

  try {
    const snap = await db.collection(CONFIGURATION).doc(VERSION).get();
    const gate = readGate(snap.data());
    cached = { gate, at: now };
    return gate;
  } catch (error) {
    // Ne jamais laisser `respond` traduire ça en 500 : une porte qu'on ne sait
    // pas lire est une porte ouverte.
    console.error("porte de version illisible", error);
    return OPEN_GATE;
  }
}
