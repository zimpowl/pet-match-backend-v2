import { onRequest } from "firebase-functions/v2/https";
import { CONTESTS, PARTICIPANTS, db } from "../firebase";
import { ContestDoc, ContestParticipantDoc } from "../models/contest";
import { EntryRejection, rejectEntryChange } from "../core/joinRules";
import { EntryChangeResponse } from "./contract";
import { contestCard } from "./mappers";
import { resolveDailyVotes } from "../data/dailyVotes";
import {
  HttpError,
  JsonResponse,
  Query,
  badRequest,
  conflict,
  forbidden,
  notFound,
  requiredField,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";
import { assertActive } from "../core/suspension";

/**
 * Reprendre une inscription déjà posée : en changer la photo, ou l'annuler.
 *
 * La fenêtre est celle de l'inscription elle-même (D39) — `DRAFT` et rien
 * d'autre. Tant que le concours n'a pas démarré, une inscription n'engage
 * personne : aucun duel n'a été joué contre elle, aucun ELO ne la cite. Dès
 * l'activation elle est en course, et l'en sortir referait les duels des
 * autres — c'est le même raisonnement qu'à la fermeture d'un compte (§6).
 *
 * Les deux gestes partagent leur garde et leur retour : le concours tel qu'il
 * est **après** le geste, pour que l'app n'ait rien à recharger.
 */
export const updateEntryPhotoHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<EntryChangeResponse> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);
    await assertActive(userUid);
    const contestUid = requiredField(body, "contestUid");
    const petUid = requiredField(body, "petUid");
    const photoUrl = requiredField(body, "photoUrl");

    const now = Date.now();
    const contestRef = db.collection(CONTESTS).doc(contestUid);
    const participantRef = contestRef.collection(PARTICIPANTS).doc(petUid);

    const changed = await db.runTransaction(async (t) => {
      const [contestSnap, participantSnap] = await t.getAll(contestRef, participantRef);
      if (!contestSnap.exists) throw notFound(`concours ${contestUid} introuvable`);

      const contest = contestSnap.data() as ContestDoc;
      const participant = participantSnap.exists ?
        (participantSnap.data() as ContestParticipantDoc) :
        null;

      const rejection = rejectEntryChange({
        status: contest.status,
        participantOwnerUid: participant?.ownerUid ?? null,
        callerUid: userUid,
        photoUrl,
        requiresPhoto: true,
      });
      if (rejection) throw entryError(rejection, petUid, contestUid);

      // Déjà couvert par NOT_REGISTERED ; ici pour le typage.
      if (!participant) throw conflict("état d'inscription incohérent");

      t.update(participantRef, { photoUrl });

      // Seule la photo bouge. Le rang d'inscription, l'ELO et l'instantané
      // restent ceux du premier jour : changer d'image n'est pas se réinscrire.
      return { contest, participant: { ...participant, photoUrl } };
    });

    return {
      dailyVotes: await resolveDailyVotes(userUid, now),
      contest: contestCard(contestUid, changed.contest, {
        participant: changed.participant,
        judge: null,
      }),
    };
  }),
);

/**
 * Annuler l'inscription de son animal. Le doc participant part, et le compteur
 * du concours suit — sans quoi il annoncerait un participant qu'il n'a plus.
 *
 * Seul l'effectif descend. `counts.registrations` reste où il est : la place
 * se libère, le numéro d'ordre déjà distribué non — deux inscrits ne peuvent
 * pas porter le même rang de passage (D87).
 */
export const withdrawEntryHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<EntryChangeResponse> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = await callerUid(query, body, req.headers.authorization);
    await assertActive(userUid);
    const contestUid = requiredField(body, "contestUid");
    const petUid = requiredField(body, "petUid");

    const now = Date.now();
    const contestRef = db.collection(CONTESTS).doc(contestUid);
    const participantRef = contestRef.collection(PARTICIPANTS).doc(petUid);

    const contest = await db.runTransaction(async (t) => {
      const [contestSnap, participantSnap] = await t.getAll(contestRef, participantRef);
      if (!contestSnap.exists) throw notFound(`concours ${contestUid} introuvable`);

      const doc = contestSnap.data() as ContestDoc;
      const participant = participantSnap.exists ?
        (participantSnap.data() as ContestParticipantDoc) :
        null;

      const rejection = rejectEntryChange({
        status: doc.status,
        participantOwnerUid: participant?.ownerUid ?? null,
        callerUid: userUid,
        photoUrl: null,
        requiresPhoto: false,
      });
      if (rejection) throw entryError(rejection, petUid, contestUid);

      // L'invariant tient dans la transaction : on vient de lire le doc
      // participant qu'on supprime, donc l'effectif le comptait.
      const participants = doc.counts.participants - 1;

      t.delete(participantRef);
      t.update(contestRef, { "counts.participants": participants });

      return { ...doc, counts: { ...doc.counts, participants } };
    });

    return {
      dailyVotes: await resolveDailyVotes(userUid, now),
      // Plus d'inscription : la carte revient au rôle `NONE`, et l'app y
      // retrouve le bouton « s'inscrire » sans rien recharger.
      contest: contestCard(contestUid, contest, { participant: null, judge: null }),
    };
  }),
);

function entryError(
  rejection: EntryRejection,
  petUid: string,
  contestUid: string,
): HttpError {
  switch (rejection) {
  case "NOT_REGISTERED":
    return notFound(`${petUid} n'est pas inscrit à ${contestUid}`);
  case "NOT_OWNER":
    return forbidden(`${petUid} n'appartient pas à l'appelant`);
  case "CONTEST_NOT_DRAFT":
    return conflict(`${contestUid} a commencé : l'inscription est engagée`);
  case "PET_HAS_NO_PHOTO":
    return badRequest("une inscription sans photo n'a rien à imprimer");
  }
}
