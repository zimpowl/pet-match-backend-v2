import { onRequest } from "firebase-functions/v2/https";
import { CONFIGURATION, db } from "../firebase";
import { NO_ONBOARDING, ONBOARDING, Onboarding, readOnboarding } from "../core/onboarding";
import { JsonResponse, respond } from "../http/respond";

/** Une lecture par instance tiède plutôt qu'une par premier lancement. */
const CACHE_MILLIS = 60_000;

let cached: { readonly onboarding: Onboarding; readonly at: number } | null = null;

/**
 * La présentation du premier lancement : ses pages, titre, texte et photo.
 *
 * Posée à la main dans `configuration/onboarding`, pour la réécrire sans
 * publier l'app — et pour les photos, plutôt que de les tirer des podiums à
 * chaque lancement : la route des podiums relit trois participants par
 * concours clos, et la photo mettait près de dix secondes à paraître.
 *
 * Sans authentification — on la lit avant d'avoir un compte — et elle ne rend
 * jamais d'erreur : sans pages, l'app montre sa présentation intégrée.
 *
 *   GET getOnboardingHttp
 */
export const getOnboardingHttp = onRequest({ cors: true }, (_req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<Onboarding> => {
    res.set("Cache-Control", `public, max-age=${CACHE_MILLIS / 1000}`);
    return load();
  }),
);

async function load(): Promise<Onboarding> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MILLIS) return cached.onboarding;

  try {
    const snap = await db.collection(CONFIGURATION).doc(ONBOARDING).get();
    const onboarding = readOnboarding(snap.data());
    cached = { onboarding, at: now };
    return onboarding;
  } catch (error) {
    console.error("présentation illisible", error);
    return NO_ONBOARDING;
  }
}
