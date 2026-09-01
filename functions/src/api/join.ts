import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { CONTESTS, PARTICIPANTS, PETS, db } from "../firebase";
import { ContestDoc, ContestParticipantDoc } from "../models/contest";
import { PetDoc } from "../models/pet";
import { DEFAULT_ELO } from "../core/elo";
import { JoinRejection, rejectJoin } from "../core/joinRules";
import { JoinContestResponse } from "./contract";
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

/**
 * Inscription d'un animal. Pendant `DRAFT` uniquement (D39) : il faut connaître
 * le nombre de participants pour figer le plafond, et fermer à l'activation
 * supprime le cas de l'inscrit tardif qui joue moins de duels.
 *
 * Tous les animaux d'un même propriétaire peuvent s'inscrire au même concours
 * (D89) — la clé `participants/{petUid}` suffit à empêcher le doublon, il n'y a
 * rien à compter au niveau du joueur.
 */
export const joinContestHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<JoinContestResponse> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const contestUid = requiredField(body, "contestUid");
    const petUid = requiredField(body, "petUid");

    const now = Date.now();
    const contestRef = db.collection(CONTESTS).doc(contestUid);
    const participantRef = contestRef.collection(PARTICIPANTS).doc(petUid);
    const petRef = db.collection(PETS).doc(petUid);

    const joined = await db.runTransaction(async (t) => {
      const [contestSnap, petSnap, participantSnap] = await t.getAll(
        contestRef,
        petRef,
        participantRef,
      );

      if (!contestSnap.exists) throw notFound(`concours ${contestUid} introuvable`);
      if (!petSnap.exists) throw notFound(`animal ${petUid} introuvable`);

      const contest = contestSnap.data() as ContestDoc;
      const pet = petSnap.data() as PetDoc;

      const rejection = rejectJoin({
        status: contest.status,
        petOwnerUid: pet.userUid,
        callerUid: userUid,
        alreadyRegistered: participantSnap.exists,
        petPhotoUrl: pet.photoUrl,
      });
      if (rejection) throw joinError(rejection, petUid, contestUid);

      // Déjà couvert par PET_HAS_NO_PHOTO ; ici pour le typage.
      const photoUrl = pet.photoUrl;
      if (!photoUrl) throw badRequest(`${petUid} n'a pas de photo`);

      // Le rang du premier tour, avant tout classement (D87).
      const registrationIndex = (contest.counts?.participants ?? 0) + 1;

      const participant: ContestParticipantDoc = {
        petId: petUid,
        ownerUid: pet.userUid,
        petNumber: pet.number,
        petName: pet.name,
        petBreed: pet.breed,
        species: pet.species,
        // La photo inscrite, dénormalisée : c'est elle qui sera imprimée.
        photoUrl,
        registrationIndex,
        elo: DEFAULT_ELO,
        wins: 0,
        losses: 0,
        duels: 0,
        votesReceived: 0,
        // Avant le premier 18 h, tout le monde est à 1200 / 0 (D54).
        eloSnapshot: DEFAULT_ELO,
        votesReceivedSnapshot: 0,
        rank: null,
        rankPrevious: null,
        createdAt: Timestamp.fromMillis(now),
      };

      t.set(participantRef, participant);
      t.update(contestRef, { "counts.participants": registrationIndex });

      return {
        contest: {
          ...contest,
          counts: { ...contest.counts, participants: registrationIndex },
        },
        participant,
      };
    });

    return {
      dailyVotes: await resolveDailyVotes(userUid, now),
      contest: contestCard(contestUid, joined.contest, {
        participant: joined.participant,
        judge: null,
      }),
    };
  }),
);

function joinError(
  rejection: JoinRejection,
  petUid: string,
  contestUid: string,
): HttpError {
  switch (rejection) {
  case "NOT_OWNER":
    return forbidden(`${petUid} n'appartient pas à l'appelant`);
  case "CONTEST_NOT_DRAFT":
    return conflict(`les inscriptions de ${contestUid} sont fermées`);
  case "ALREADY_REGISTERED":
    return conflict(`${petUid} est déjà inscrit à ${contestUid}`);
  case "PET_HAS_NO_PHOTO":
    return badRequest(`${petUid} n'a pas de photo`);
  }
}
