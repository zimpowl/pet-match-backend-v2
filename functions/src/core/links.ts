/**
 * Les liens courts de `pet-match.fr/go/<code>` (D-liens). Logique pure : pas de
 * Firestore ici, pas d'Express — seulement ce qui se teste sans émulateur.
 *
 * Ce qu'on compte et ce qu'on ne compte pas : un compteur par lien, par jour et
 * par plateforme, et **rien d'autre**. Pas d'adresse IP, pas d'identifiant, pas
 * de cookie. Ce n'est pas une pudeur, c'est un choix d'ingénierie : une mesure
 * sans donnée personnelle n'a besoin ni de bandeau de consentement, ni de
 * registre, ni d'être expliquée dans la politique de confidentialité. Et à
 * l'échelle qui nous intéresse — « est-ce que la clinique Durand ramène du
 * monde ? » — un compteur répond aussi bien qu'un pisteur.
 */

export type LinkPlatform = "ios" | "android" | "web";

/**
 * La plateforme, lue dans l'en-tête `User-Agent`. On ne cherche pas la finesse :
 * trois destinations possibles, donc trois réponses. Tout ce qui n'est pas
 * clairement un iPhone ou un Android est traité comme un navigateur — c'est le
 * repli sûr, puisque le site sait accueillir tout le monde.
 *
 * `iPad` compte comme iOS : l'app y tourne, et l'App Store aussi. Un Mac, non —
 * il tombe sur le site, ce qui est juste.
 */
export function platformOf(userAgent: string | undefined): LinkPlatform {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  return "web";
}

/**
 * Le code, extrait du chemin. Firebase Hosting transmet le chemin complet —
 * `/go/clinique-durand` — et la fonction peut aussi être appelée directement
 * avec `?c=`. Les deux sont acceptés : le second sert à tester sans passer par
 * l'hébergement.
 *
 * Le code est normalisé en minuscules : un QR code imprimé est lu par des
 * appareils qui ne respectent pas tous la casse, et un flyer ne se corrige pas.
 */
export function codeFrom(path: string | undefined, query: string | undefined): string | null {
  const fromPath = (path ?? "").split("?")[0].replace(/^\/+|\/+$/g, "").split("/").pop() ?? "";
  const raw = fromPath && fromPath !== "go" ? fromPath : (query ?? "");
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : null;
}

/** La clé du jour, en heure de Paris : c'est le fuseau de tout le produit. */
export function dayKey(nowMillis: number): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMillis));
}
