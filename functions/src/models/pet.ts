import { firestore } from "firebase-admin";
import { Sex, Species } from "./contest";
import { StatsDoc } from "./user";

export interface PetDoc {
  userUid: string;
  number: number;
  name: string;
  photoUrl: string | null;
  species: Species;
  sex: Sex | null;
  breed: string | null;
  birthDate: firestore.Timestamp | null;
  countryCode: string | null;
  createdAt: firestore.Timestamp;
  microchipId: string | null;
  verifiedAt: firestore.Timestamp | null;
  /** Retiré de l'étagère et de la recherche ; ses participations demeurent. */
  deletedAt: firestore.Timestamp | null;
  /** Grade de l'animal (§4.8), progression séparée de celle du juré. */
  grade: { level: number };
  stats: StatsDoc;
}
