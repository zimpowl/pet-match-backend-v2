import { onRequest } from "firebase-functions/v2/https";
import { JudgeProfileResponse, JudgeWire, PetProfileResponse } from "./contract";
import { NO_ME, contestCard, judgeProfile, petProfile } from "./mappers";
import { loadActiveContests, loadContestsByIds } from "../data/contests";
import { USERS, db } from "../firebase";
import { UserDoc } from "../models/user";
import {
  loadJudgedContests,
  loadParticipations,
  loadPet,
  loadPets,
  loadUser,
} from "../data/profile";
import { PrefetchedContest, resolveDailyVotes } from "../data/dailyVotes";
import {
  JsonResponse,
  Query,
  badRequest,
  notFound,
  param,
  requiredParam,
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
    const prefetched: PrefetchedContest[] = judged.flatMap((entry) => {
      const contest = contests.get(entry.contestUid);
      return contest ?
        [{ contest, me: { participant: null, judge: entry.judge } }] :
        [];
    });

    // Le concours en cours figure sur l'étagère même sans y avoir jamais voté
    // (D95). Sans ça un juré neuf ne voit rien : la liste ne connaît que les
    // concours où un document juré existe déjà, et ce document naît du premier
    // vote — l'étagère n'offrait donc aucune porte d'entrée.
    const active = await loadActiveContests();
    for (const contest of active) {
      if (prefetched.some((entry) => entry.contest.uid === contest.uid)) continue;
      prefetched.unshift({ contest, me: NO_ME });
    }

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
 * Mise à jour du profil. **Partielle** : seuls les champs présents sont écrits.
 * L'écran d'édition en envoie plusieurs d'un coup, mais changer sa seule photo
 * ne doit pas obliger à renvoyer son nom et son pays — c'est aussi ce qui
 * permet à cet endpoint de remplacer les trois anciens `updateNameHttp`,
 * `updatePictureHttp` et `updateDescriptionHttp`.
 *
 * `stats`, `totals`, `judgeNumber`, `judgeSince`, `locale` et `isVerified` sont
 * des champs serveur : l'appelant ne les écrit jamais.
 */
export const updateProfileHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<JudgeWire> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const source = (body ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | null> = {};

    for (const field of ["name", "countryCode", "avatarUrl", "description"] as const) {
      const raw = source[field];
      if (raw === undefined) continue;
      if (raw !== null && typeof raw !== "string") {
        throw badRequest(`${field} doit être une chaîne ou null`);
      }
      const value = typeof raw === "string" ? raw.trim() : "";
      // Le nom ne peut pas être effacé ; les autres champs, si.
      if (field === "name" && value.length === 0) throw badRequest("le nom ne peut pas être vide");
      patch[field] = value.length > 0 ? value : null;
    }

    if (Object.keys(patch).length === 0) throw badRequest("aucun champ à mettre à jour");

    const userRef = db.collection(USERS).doc(userUid);
    const updated = await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

      t.update(userRef, patch);
      return { ...(snap.data() as UserDoc), ...patch };
    });

    return judgeProfile(userUid, updated);
  }),
);
