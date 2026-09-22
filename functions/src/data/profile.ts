import { JUDGES, PARTICIPANTS, PETS, USERS, contestOf, db } from "../firebase";
import { ContestJudgeDoc, ContestParticipantDoc } from "../models/contest";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";

export interface LoadedPet {
  readonly uid: string;
  readonly doc: PetDoc;
}

export interface JudgedContest {
  readonly contestUid: string;
  readonly judge: ContestJudgeDoc;
}

export interface Participation {
  readonly contestUid: string;
  readonly participant: ContestParticipantDoc;
}

export async function loadUser(userUid: string): Promise<UserDoc | null> {
  const snap = await db.collection(USERS).doc(userUid).get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

export async function loadPet(petUid: string): Promise<LoadedPet | null> {
  const snap = await db.collection(PETS).doc(petUid).get();
  return snap.exists ? { uid: snap.id, doc: snap.data() as PetDoc } : null;
}

export async function loadPets(userUid: string): Promise<LoadedPet[]> {
  const snap = await db
    .collection(PETS)
    .where("userUid", "==", userUid)
    .orderBy("createdAt", "desc")
    .get();
  // Un animal retiré quitte l'étagère, pas les concours où il a couru.
  return snap.docs
    .map((doc) => ({ uid: doc.id, doc: doc.data() as PetDoc }))
    .filter((pet) => !pet.doc.deletedAt);
}

/**
 * Tous les concours jugés, du plus récemment rejoint au plus ancien. Sans
 * pagination : une étagère est une collection qu'on parcourt d'un bout à
 * l'autre, et un concours par semaine met des années à devenir un volume.
 */
export async function loadJudgedContests(userUid: string): Promise<JudgedContest[]> {
  const snap = await db
    .collectionGroup(JUDGES)
    .where("userUid", "==", userUid)
    .orderBy("joinedAt", "desc")
    .get();

  return snap.docs.flatMap((doc) => {
    const contestUid = contestOf(doc.ref)?.id;
    return contestUid ? [{ contestUid, judge: doc.data() as ContestJudgeDoc }] : [];
  });
}

/** Tous les concours où cet animal a couru, du plus récent au plus ancien. */
export async function loadParticipations(petUid: string): Promise<Participation[]> {
  const snap = await db
    .collectionGroup(PARTICIPANTS)
    .where("petId", "==", petUid)
    .orderBy("createdAt", "desc")
    .get();

  return snap.docs.flatMap((doc) => {
    const contestUid = contestOf(doc.ref)?.id;
    return contestUid ? [{ contestUid, participant: doc.data() as ContestParticipantDoc }] : [];
  });
}
