import { JUDGES, PARTICIPANTS, PETS, USERS, db } from "../firebase";
import { ContestJudgeDoc, ContestParticipantDoc } from "../models/contest";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";

/** Assez de concours pour remplir le carousel d'un profil. */
export const PROFILE_CONTESTS_LIMIT = 12;

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
  return snap.docs.map((doc) => ({ uid: doc.id, doc: doc.data() as PetDoc }));
}

/**
 * Les concours jugés, du plus récemment rejoint au plus ancien.
 *
 * Le second `orderBy` n'ordonne rien : c'est un **filtre**. Une requête de
 * groupe de collections matche par *nom* de sous-collection, sans regarder le
 * parent — donc `judges` ramasse aussi les 366 documents du legacy sous
 * `challenges/`, qui portent eux aussi `userUid` et `joinedAt`. Comme Firestore
 * exclut tout document dépourvu d'un champ utilisé dans un `orderBy`, ordonner
 * en second sur `registrationIndex` — que le legacy n'a pas — ne laisse passer
 * que les documents v2, sans dénaturer le tri principal ni inventer un champ
 * marqueur.
 *
 * À retirer en L7, quand les sous-collections du legacy disparaîtront.
 *
 * (`loadParticipations`, elle, n'a pas ce problème : elle filtre sur `petId`,
 * qu'aucun participant legacy ne porte.)
 */
export async function loadJudgedContests(
  userUid: string,
  limit = PROFILE_CONTESTS_LIMIT,
): Promise<JudgedContest[]> {
  const snap = await db
    .collectionGroup(JUDGES)
    .where("userUid", "==", userUid)
    .orderBy("joinedAt", "desc")
    .orderBy("registrationIndex", "asc")
    .limit(limit)
    .get();

  return snap.docs.flatMap((doc) => {
    const contestUid = doc.ref.parent.parent?.id;
    return contestUid ?
      [{ contestUid, judge: doc.data() as ContestJudgeDoc }] :
      [];
  });
}

/** Les concours où cet animal a couru, du plus récent au plus ancien. */
export async function loadParticipations(
  petUid: string,
  limit = PROFILE_CONTESTS_LIMIT,
): Promise<Participation[]> {
  const snap = await db
    .collectionGroup(PARTICIPANTS)
    .where("petId", "==", petUid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.flatMap((doc) => {
    const contestUid = doc.ref.parent.parent?.id;
    return contestUid ?
      [{ contestUid, participant: doc.data() as ContestParticipantDoc }] :
      [];
  });
}
