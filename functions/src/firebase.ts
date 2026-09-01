import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const app = initializeApp();
export const db = getFirestore(app);

/** Les six collections du §3, plus les compteurs du D83. */
export const USERS = "users";
export const PETS = "pets";
export const CONTESTS = "contests";
export const PARTICIPANTS = "participants";
export const JUDGES = "judges";
export const VOTES = "votes";
export const COUNTERS = "counters";
export const SEQUENCES = "sequences";
