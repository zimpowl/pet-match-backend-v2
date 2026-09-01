import { firestore } from "firebase-admin";
import { Species } from "./contest";
import { StatsDoc } from "./user";

export interface PetDoc {
  userUid: string;
  number: number;
  name: string;
  photoUrl: string | null;
  species: Species;
  sex: "MALE" | "FEMALE" | null;
  breed: string | null;
  birthDate: firestore.Timestamp | null;
  countryCode: string | null;
  createdAt: firestore.Timestamp;
  microchipId: string | null;
  verifiedAt: firestore.Timestamp | null;
  stats: StatsDoc;
}
