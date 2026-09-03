import { setGlobalOptions } from "firebase-functions";

setGlobalOptions({ maxInstances: 10 });

// L2 — lectures. Déployées à côté des anciennes, rien n'est cassé.
export * from "./api/contests";
export * from "./api/voteSession";
export * from "./api/profile";

// L3 — écritures.
export * from "./api/join";
export * from "./api/vote";
export * from "./api/pets";
export * from "./api/device";
export * from "./api/session";

// L4 — cycle de vie : 18 h est la seule horloge du jeu.
export * from "./triggers/lifecycle";
