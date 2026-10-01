import { setGlobalOptions } from "firebase-functions";

/**
 * Le plafond d'instances est du CPU **réservé** aux yeux de Cloud Run, pas du
 * CPU consommé : il compte dans le quota de la région même au repos. À dix, les
 * vingt-cinq fonctions HTTP en réclamaient 250, plus que `us-central1` n'en
 * accorde — le déploiement échouait sur des révisions qui ne démarraient pas.
 *
 * À trois, on réserve 75. Chaque instance sert 80 requêtes simultanées, donc
 * une fonction tient 240 requêtes en parallèle : très au-delà de la pointe de
 * 18 h, quand les notifications ouvrent l'app en même temps chez tout le monde.
 *
 * Remonter ce chiffre demande d'abord une augmentation du quota
 * « Total allowable CPU » de la région.
 */
setGlobalOptions({ maxInstances: 3 });

// L2 — lectures. Déployées à côté des anciennes, rien n'est cassé.
export * from "./api/contests";
export * from "./api/voteSession";
export * from "./api/profile";
export * from "./api/search";
export * from "./api/close";
export * from "./api/podiums";
export * from "./api/verify";

// La porte de version : sans jeton, parce qu'une app bloquée peut ne plus
// savoir en présenter un.
export * from "./api/config";
export * from "./api/go";

// L3 — écritures.
export * from "./api/join";
export * from "./api/entry";
export * from "./api/vote";
export * from "./api/pets";
export * from "./api/device";
export * from "./api/session";
export * from "./api/rules";
export * from "./api/report";

// L4 — cycle de vie : 18 h est la seule horloge du jeu.
export * from "./triggers/lifecycle";

// La confirmation d'identité relève le grade sans attendre 18 h.
export * from "./triggers/account";
