import { Timestamp } from "firebase-admin/firestore";
import { JUDGES, PARTICIPANTS, PETS, USERS, db } from "../firebase";
import { toMillisOrZero } from "../core/time";
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

/**
 * Une page d'étagère, du plus récent au plus ancien. `olderCursor` est la date
 * de la dernière ligne rendue, en millisecondes, et il est **null quand il n'y
 * a plus rien** — c'est lui qui dit à l'app qu'elle tient le bout.
 */
export interface ShelfPage<T> {
  readonly rows: T[];
  readonly olderCursor: string | null;
}

function startAt(cursor: string | null): Timestamp | null {
  const millis = Number(cursor);
  return cursor && Number.isFinite(millis) ? Timestamp.fromMillis(millis) : null;
}

/**
 * On tire un document de plus que demandé pour savoir s'il en reste : c'est
 * moins cher qu'un `count()` et ça ne se trompe jamais.
 */
function page<T>(
  snap: FirebaseFirestore.QuerySnapshot,
  limit: number,
  field: string,
  read: (doc: FirebaseFirestore.QueryDocumentSnapshot) => T[],
): ShelfPage<T> {
  const docs = snap.docs.slice(0, limit);
  const last = docs[docs.length - 1];

  return {
    rows: docs.flatMap(read),
    olderCursor:
      snap.size > limit && last ? String(toMillisOrZero(last.get(field))) : null,
  };
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

/** Les concours jugés, du plus récemment rejoint au plus ancien. */
export async function loadJudgedContests(
  userUid: string,
  cursor: string | null = null,
  limit = PROFILE_CONTESTS_LIMIT,
): Promise<ShelfPage<JudgedContest>> {
  let query = db
    .collectionGroup(JUDGES)
    .where("userUid", "==", userUid)
    .orderBy("joinedAt", "desc");

  const after = startAt(cursor);
  if (after) query = query.startAfter(after);

  const snap = await query.limit(limit + 1).get();

  return page(snap, limit, "joinedAt", (doc) => {
    const contestUid = doc.ref.parent.parent?.id;
    return contestUid ? [{ contestUid, judge: doc.data() as ContestJudgeDoc }] : [];
  });
}

/** Les concours où cet animal a couru, du plus récent au plus ancien. */
export async function loadParticipations(
  petUid: string,
  cursor: string | null = null,
  limit = PROFILE_CONTESTS_LIMIT,
): Promise<ShelfPage<Participation>> {
  let query = db
    .collectionGroup(PARTICIPANTS)
    .where("petId", "==", petUid)
    .orderBy("createdAt", "desc");

  const after = startAt(cursor);
  if (after) query = query.startAfter(after);

  const snap = await query.limit(limit + 1).get();

  return page(snap, limit, "createdAt", (doc) => {
    const contestUid = doc.ref.parent.parent?.id;
    return contestUid ? [{ contestUid, participant: doc.data() as ContestParticipantDoc }] : [];
  });
}
