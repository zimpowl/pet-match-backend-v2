import { onRequest } from "firebase-functions/v2/https";
import { JudgeProfileResponse, JudgeWire, PetProfileResponse } from "./contract";
import { NO_ME, contestCard, judgeProfile, petProfile } from "./mappers";
import { loadContestsByIds } from "../data/contests";
import { USERS, db } from "../firebase";
import { UserDoc } from "../models/user";
import {
  loadJudgedContests,
  loadParticipations,
  loadPet,
  loadPets,
  loadUser,
} from "../data/profile";
import { resolveDailyVotes } from "../data/dailyVotes";
import {
  JsonResponse,
  Query,
  badRequest,
  notFound,
  param,
  requiredParam,
  requiredField,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";

/** Profil de juré : l'en-tête, ses animaux, et les concours qu'il a jugés. */
export const getJudgeHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<JudgeProfileResponse> => {
    const query = req.query as Query;
    const userUid = requiredParam(query, "userUid");

    const now = Date.now();
    const [user, pets, judged] = await Promise.all([
      loadUser(userUid),
      loadPets(userUid),
      loadJudgedContests(userUid),
    ]);
    if (!user) throw notFound(`utilisateur ${userUid} introuvable`);

    const contests = await loadContestsByIds(judged.map((entry) => entry.contestUid));
    const prefetched = judged.flatMap((entry) => {
      const contest = contests.get(entry.contestUid);
      return contest ?
        [{ contest, me: { participant: null, judge: entry.judge } }] :
        [];
    });

    return {
      dailyVotes: await resolveDailyVotes(userUid, now, prefetched),
      judge: judgeProfile(userUid, user),
      pets: pets.map((pet) => petProfile(pet.uid, pet.doc)),
      contests: prefetched.map((entry) =>
        contestCard(entry.contest.uid, entry.contest.doc, entry.me),
      ),
    };
  }),
);

/**
 * Profil d'animal : l'en-tête, son propriétaire, et ses participations. Les
 * cartes sont vues **du point de vue de l'animal** — rang et index
 * d'inscription sont les siens, pas ceux du lecteur. `userUid` est optionnel :
 * sans lui, pas de votes du jour à calculer.
 */
export const getPetHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<PetProfileResponse> => {
    const query = req.query as Query;
    const petUid = requiredParam(query, "petUid");
    const userUid = param(query, "userUid") ?? null;

    const now = Date.now();
    const pet = await loadPet(petUid);
    if (!pet) throw notFound(`animal ${petUid} introuvable`);

    const [owner, participations] = await Promise.all([
      loadUser(pet.doc.userUid),
      loadParticipations(petUid),
    ]);
    if (!owner) throw notFound(`propriétaire de ${petUid} introuvable`);

    const contests = await loadContestsByIds(
      participations.map((entry) => entry.contestUid),
    );

    return {
      dailyVotes: await resolveDailyVotes(userUid, now),
      pet: petProfile(pet.uid, pet.doc),
      owner: judgeProfile(pet.doc.userUid, owner),
      contests: participations.flatMap((entry) => {
        const contest = contests.get(entry.contestUid);
        return contest ?
          [
            contestCard(contest.uid, contest.doc, {
              ...NO_ME,
              participant: entry.participant,
            }),
          ] :
          [];
      }),
    };
  }),
);

/**
 * Mise à jour du profil. Trois champs et rien d'autre : `grade`, `stats`,
 * `totals`, `judgeNumber`, `judgeSince` et `isVerified` sont des champs serveur.
 */
export const updateProfileHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<JudgeWire> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const name = requiredField(body, "name");
    const countryCode = requiredField(body, "countryCode");
    const rawAvatar = (body as Record<string, unknown>).avatarUrl;
    if (rawAvatar !== undefined && rawAvatar !== null && typeof rawAvatar !== "string") {
      throw badRequest("avatarUrl doit être une chaîne ou null");
    }
    const avatarUrl = typeof rawAvatar === "string" && rawAvatar.trim().length > 0 ?
      rawAvatar.trim() :
      null;

    const userRef = db.collection(USERS).doc(userUid);
    const updated = await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

      const patch = { name, countryCode, avatarUrl };
      t.update(userRef, patch);
      return { ...(snap.data() as UserDoc), ...patch };
    });

    return judgeProfile(userUid, updated);
  }),
);
