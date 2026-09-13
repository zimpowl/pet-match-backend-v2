import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PETS, USERS, VERIFICATIONS, db } from "../firebase";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import {
  VerificationDoc,
  VerificationFileDoc,
  VerificationStatus,
  VerificationTarget,
} from "../models/verification";
import {
  JsonResponse,
  Query,
  badRequest,
  conflict,
  forbidden,
  notFound,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";

const MAX_FILES = 4;

/**
 * L'état de confirmation du juré et de chacun de ses animaux (D126). Un seul
 * appel : l'écran montre les deux côte à côte, et demander l'un sans l'autre
 * obligerait la vue à recoller ce que le serveur sait déjà.
 */
export const getVerificationsHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const userUid = await callerUid(
      req.query as Query,
      req.body as unknown,
      req.headers.authorization,
    );

    const [userSnap, petSnaps, requests] = await Promise.all([
      db.collection(USERS).doc(userUid).get(),
      db.collection(PETS).where("userUid", "==", userUid).get(),
      db.collection(VERIFICATIONS).where("userUid", "==", userUid).get(),
    ]);
    if (!userSnap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

    const user = userSnap.data() as UserDoc;
    const pending = latestByTarget(requests.docs);

    return {
      judge: entry("JUDGE", null, user.isVerified === true, pending),
      pets: petSnaps.docs
        .map((doc) => ({ uid: doc.id, pet: doc.data() as PetDoc }))
        .filter(({ pet }) => !pet.deletedAt)
        .map(({ uid, pet }) => ({
          petUid: uid,
          name: pet.name,
          photoUrl: pet.photoUrl ?? null,
          ...entry("PET", uid, pet.verifiedAt != null, pending),
        })),
    };
  }),
);

/**
 * Déposer une demande. Les fichiers sont déjà dans le bucket — l'app les y met
 * elle-même, sous un chemin privé — et on n'en garde que le chemin : une URL de
 * téléchargement dans un document est une fuite qui attend son tour.
 */
export const requestVerificationHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);

    const target = readTarget(body);
    const petUid = target === "PET" ? readPetUid(body) : null;
    const files = readFiles(body);

    if (petUid) {
      const petSnap = await db.collection(PETS).doc(petUid).get();
      const pet = petSnap.data() as PetDoc | undefined;
      if (!petSnap.exists || !pet) throw notFound(`animal ${petUid} introuvable`);
      if (pet.userUid !== userUid) throw forbidden("cet animal n'est pas le vôtre");
      if (pet.verifiedAt) throw conflict("cet animal est déjà confirmé");
    } else {
      const userSnap = await db.collection(USERS).doc(userUid).get();
      if (!userSnap.exists) throw notFound(`utilisateur ${userUid} introuvable`);
      if ((userSnap.data() as UserDoc).isVerified) throw conflict("ce profil est déjà confirmé");
    }

    const open = await db
      .collection(VERIFICATIONS)
      .where("userUid", "==", userUid)
      .where("target", "==", target)
      .where("petUid", "==", petUid)
      .where("status", "==", "PENDING")
      .limit(1)
      .get();
    if (!open.empty) throw conflict("une demande est déjà en cours d'examen");

    const doc: VerificationDoc = {
      userUid,
      target,
      petUid,
      files,
      status: "PENDING",
      createdAt: Timestamp.now(),
      reviewedAt: null,
      reason: null,
    };
    const ref = await db.collection(VERIFICATIONS).add(doc);

    return { uid: ref.id, status: doc.status, requestedAt: doc.createdAt.toMillis() };
  }),
);

interface Latest {
  readonly status: VerificationDoc["status"];
  readonly requestedAt: number;
  readonly reason: string | null;
}

/**
 * La dernière demande par cible. Un refus se remplace par une nouvelle demande,
 * donc c'est la plus récente qui dit où on en est — pas la première.
 */
function latestByTarget(
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
): Map<string, Latest> {
  const latest = new Map<string, Latest>();

  for (const doc of docs) {
    const request = doc.data() as VerificationDoc;
    const key = keyOf(request.target, request.petUid);
    const requestedAt = request.createdAt.toMillis();
    if ((latest.get(key)?.requestedAt ?? 0) >= requestedAt) continue;
    latest.set(key, { status: request.status, requestedAt, reason: request.reason });
  }

  return latest;
}

function keyOf(target: VerificationTarget, petUid: string | null): string {
  return `${target}:${petUid ?? ""}`;
}

function entry(
  target: VerificationTarget,
  petUid: string | null,
  verified: boolean,
  pending: Map<string, Latest>,
): { status: VerificationStatus; requestedAt: number | null; reason: string | null } {
  if (verified) return { status: "VERIFIED", requestedAt: null, reason: null };

  const last = pending.get(keyOf(target, petUid));
  if (!last) return { status: "NONE", requestedAt: null, reason: null };

  return { status: last.status, requestedAt: last.requestedAt, reason: last.reason };
}

function readTarget(body: unknown): VerificationTarget {
  const raw = (body as Record<string, unknown>)?.target;
  if (raw === "JUDGE" || raw === "PET") return raw;
  throw badRequest("target doit valoir JUDGE ou PET");
}

function readPetUid(body: unknown): string {
  const raw = (body as Record<string, unknown>)?.petUid;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  throw badRequest("petUid manquant");
}

function readFiles(body: unknown): VerificationFileDoc[] {
  const raw = (body as Record<string, unknown>)?.files;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("aucune pièce déposée");
  if (raw.length > MAX_FILES) throw badRequest(`${MAX_FILES} pièces au maximum`);

  return raw.map((entry) => {
    const source = (entry ?? {}) as Record<string, unknown>;
    const path = source.path;
    if (typeof path !== "string" || !path.trim()) throw badRequest("chemin de pièce manquant");
    return {
      path: path.trim(),
      contentType: typeof source.contentType === "string" ? source.contentType : null,
    };
  });
}
