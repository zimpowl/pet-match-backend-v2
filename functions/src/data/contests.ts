import { CONTESTS, JUDGES, PARTICIPANTS, PETS, db } from "../firebase";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
  ContestStatus,
} from "../models/contest";
import { MeSource, NO_ME } from "../api/mappers";
import { ContestPageRequest } from "../core/pagination";
import { PAIRING_WINDOW, PairingCandidate } from "../core/pairing";
import { listOrder } from "../core/ordering";
import { toMillis } from "../core/time";

/** Un concours par palier et par semaine : sept actifs au plus (D28). */
export const ACTIVE_CONTESTS_LIMIT = 8;
/** Assez large pour qu'un concours de taille courante tienne en une page. */
export const ROWS_PAGE_SIZE = 50;

export interface LoadedContest {
  readonly uid: string;
  readonly doc: ContestDoc;
}

export interface ContestPage {
  readonly contests: LoadedContest[];
  readonly hasMore: boolean;
}

const contests = () => db.collection(CONTESTS);

function loaded(
  snap: FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot,
): LoadedContest {
  return { uid: snap.id, doc: snap.data() as ContestDoc };
}

export async function loadContest(contestUid: string): Promise<LoadedContest | null> {
  const snap = await contests().doc(contestUid).get();
  return snap.exists ? loaded(snap) : null;
}

/**
 * La page d'étiquettes (D84) : numéro décroissant, curseur inclusif. On tire
 * un document de plus que demandé pour savoir s'il reste quelque chose, au
 * lieu de deviner à partir du numéro le plus bas.
 */
export async function loadContestPage(request: ContestPageRequest): Promise<ContestPage> {
  const ascending = request.direction === "newer";
  let query = contests().orderBy("number", ascending ? "asc" : "desc");
  if (request.cursor !== null) query = query.startAt(request.cursor);

  const snap = await query.limit(request.limit + 1).get();
  const hasMore = snap.size > request.limit;
  const docs = snap.docs.slice(0, request.limit).map(loaded);

  // La liste sort toujours du plus récent au plus ancien, quel que soit le sens
  // dans lequel on l'a parcourue.
  return { contests: ascending ? docs.reverse() : docs, hasMore };
}

async function loadByStatus(status: ContestStatus): Promise<LoadedContest[]> {
  const snap = await contests()
    .where("status", "==", status)
    .orderBy("number", "desc")
    .limit(ACTIVE_CONTESTS_LIMIT)
    .get();
  return snap.docs.map(loaded);
}

/** Ceux qui courent : on y vote (D95). */
export const loadActiveContests = () => loadByStatus("ACTIVE");

/**
 * Ceux qui sont **ouverts à l'inscription**. L'inscription ne vaut qu'en DRAFT
 * (D39) — il faut connaître le nombre de participants pour figer le plafond —
 * donc le concours ouvert n'est jamais celui qui court, c'est le suivant, publié
 * une semaine à l'avance (D88).
 */
export const loadOpenContests = () => loadByStatus("DRAFT");

export async function loadPetIds(userUid: string): Promise<string[]> {
  const snap = await db
    .collection(PETS)
    .where("userUid", "==", userUid)
    .select()
    .get();
  return snap.docs.map((doc) => doc.id);
}

/**
 * Le bloc `me` de chaque carte de la page, en **un seul aller-retour** : une
 * référence `judges/{uid}` par concours, plus une `participants/{petId}` par
 * animal du joueur. C'est le budget de lectures du §5 — 1 user + 1 query
 * concours + 1 query pets + ce `getAll`, soit ~15 au lieu de ~66.
 */
export async function loadMe(
  page: readonly LoadedContest[],
  userUid: string | null,
  petIds: readonly string[],
): Promise<Map<string, MeSource>> {
  const result = new Map<string, MeSource>();
  for (const contest of page) result.set(contest.uid, NO_ME);
  if (!userUid || page.length === 0) return result;

  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const contest of page) {
    const ref = contests().doc(contest.uid);
    refs.push(ref.collection(JUDGES).doc(userUid));
    for (const petId of petIds) refs.push(ref.collection(PARTICIPANTS).doc(petId));
  }

  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const contestUid = snap.ref.parent.parent?.id;
    if (!contestUid) continue;

    const current = result.get(contestUid) ?? NO_ME;
    result.set(
      contestUid,
      snap.ref.parent.id === JUDGES ?
        { ...current, judge: snap.data() as ContestJudgeDoc } :
        { ...current, participant: snap.data() as ContestParticipantDoc },
    );
  }

  return result;
}

export async function loadJudge(
  contestUid: string,
  userUid: string,
): Promise<ContestJudgeDoc | null> {
  const snap = await contests().doc(contestUid).collection(JUDGES).doc(userUid).get();
  return snap.exists ? (snap.data() as ContestJudgeDoc) : null;
}

/** Ordre du §4.12 : classement s'il existe, sinon inscription inversée. */
export async function loadParticipants(
  contest: LoadedContest,
  limit = ROWS_PAGE_SIZE,
): Promise<ContestParticipantDoc[]> {
  const order = listOrder(toMillis(contest.doc.snapshotAt));
  const snap = await contests()
    .doc(contest.uid)
    .collection(PARTICIPANTS)
    .orderBy(order.field, order.direction)
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data() as ContestParticipantDoc);
}

export async function loadJudges(
  contest: LoadedContest,
  limit = ROWS_PAGE_SIZE,
): Promise<ContestJudgeDoc[]> {
  const order = listOrder(toMillis(contest.doc.snapshotAt));
  const snap = await contests()
    .doc(contest.uid)
    .collection(JUDGES)
    .orderBy(order.field, order.direction)
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data() as ContestJudgeDoc);
}

/**
 * Trois petites requêtes à coût constant (§4.7, D52) : l'ancre est l'animal le
 * moins joué — pas une valeur d'ELO tirée au hasard, qui ne visiterait jamais
 * le haut du classement — puis ses voisins d'ELO de part et d'autre.
 */
export async function loadPairingWindow(contestUid: string): Promise<PairingCandidate[]> {
  const participants = contests().doc(contestUid).collection(PARTICIPANTS);

  const anchorSnap = await participants.orderBy("duels", "asc").limit(1).get();
  const anchor = anchorSnap.docs[0];
  if (!anchor) return [];

  const anchorElo = (anchor.data() as ContestParticipantDoc).elo;
  const [up, down] = await Promise.all([
    participants.where("elo", ">=", anchorElo).orderBy("elo", "asc").limit(PAIRING_WINDOW).get(),
    participants.where("elo", "<", anchorElo).orderBy("elo", "desc").limit(PAIRING_WINDOW).get(),
  ]);

  const window = new Map<string, PairingCandidate>();
  for (const doc of [...up.docs, ...down.docs]) {
    const data = doc.data() as ContestParticipantDoc;
    window.set(doc.id, { petId: doc.id, ownerUid: data.ownerUid, elo: data.elo });
  }
  return [...window.values()];
}

export async function loadParticipantsByIds(
  contestUid: string,
  petIds: readonly string[],
): Promise<Map<string, ContestParticipantDoc>> {
  const result = new Map<string, ContestParticipantDoc>();
  if (petIds.length === 0) return result;

  const participants = contests().doc(contestUid).collection(PARTICIPANTS);
  const snaps = await db.getAll(...petIds.map((petId) => participants.doc(petId)));
  for (const snap of snaps) {
    if (snap.exists) result.set(snap.id, snap.data() as ContestParticipantDoc);
  }
  return result;
}

export async function loadContestsByIds(
  contestUids: readonly string[],
): Promise<Map<string, LoadedContest>> {
  const result = new Map<string, LoadedContest>();
  if (contestUids.length === 0) return result;

  const unique = [...new Set(contestUids)];
  const snaps = await db.getAll(...unique.map((uid) => contests().doc(uid)));
  for (const snap of snaps) {
    if (snap.exists) result.set(snap.id, loaded(snap));
  }
  return result;
}
