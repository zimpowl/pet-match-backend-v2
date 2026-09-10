import { onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { CONTESTS, JUDGES, PARTICIPANTS, USERS, VOTES, db } from "../firebase";
import {
  ContestDoc,
  ContestJudgeDoc,
  ContestParticipantDoc,
  ContestVoteDoc,
} from "../models/contest";
import { UserDoc } from "../models/user";
import {
  contestDayIndex,
  normalizeVotesPerDay,
  remainingVotesToday,
  secondsToReset,
} from "../core/allocation";
import {
  DEFAULT_K_FACTOR,
  calculateExpectedScore,
  calculateUpdatedElo,
  pairKey,
} from "../core/elo";
import { VoteRejection, rejectVote } from "../core/voteRules";
import { toMillisOrZero } from "../core/time";
import { VoteSubmissionResponse } from "./contract";
import { nextSequence } from "../data/sequences";
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
 * Le vote. Une seule transaction : allocation du jour, ELO des deux animaux,
 * doc de vote, doc juré, cumul du user.
 *
 * On devient juré **au premier vote** — zéro friction. Le doc `judges/{uid}`
 * n'existe pas avant, et c'est ici qu'il naît, avec son `judgeNumber` tiré de la
 * séquence globale (D83) si le joueur n'en avait pas encore.
 *
 * Le retour ne contient que l'allocation du jour : ni ELO, ni rang, ni justesse.
 * Le verdict est déjà à l'écran quand la réponse arrive — l'app l'a calculé sur
 * les ELO servis avec le duel (D97). La justesse, elle, n'est même pas connue :
 * un vote est juste si l'animal choisi finit devant, ce qui attend la clôture.
 */
export const submitVoteHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async (): Promise<VoteSubmissionResponse> => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const userUid = callerUid(query, body);
    const contestUid = requiredField(body, "contestUid");
    const aPetUid = requiredField(body, "aPetUid");
    const bPetUid = requiredField(body, "bPetUid");
    const pickedPetUid = requiredField(body, "pickedPetUid");

    const now = Date.now();
    const key = pairKey(aPetUid, bPetUid);
    const contestRef = db.collection(CONTESTS).doc(contestUid);
    const judgeRef = contestRef.collection(JUDGES).doc(userUid);
    const userRef = db.collection(USERS).doc(userUid);
    const aRef = contestRef.collection(PARTICIPANTS).doc(aPetUid);
    const bRef = contestRef.collection(PARTICIPANTS).doc(bPetUid);

    const cast = await db.runTransaction(async (t) => {
      const [contestSnap, judgeSnap, userSnap, aSnap, bSnap] = await t.getAll(
        contestRef,
        judgeRef,
        userRef,
        aRef,
        bRef,
      );

      if (!contestSnap.exists) throw notFound(`concours ${contestUid} introuvable`);
      if (!userSnap.exists) throw notFound(`utilisateur ${userUid} introuvable`);

      const contest = contestSnap.data() as ContestDoc;
      const user = userSnap.data() as UserDoc;
      const judge = judgeSnap.exists ? (judgeSnap.data() as ContestJudgeDoc) : null;
      const a = aSnap.exists ? (aSnap.data() as ContestParticipantDoc) : null;
      const b = bSnap.exists ? (bSnap.data() as ContestParticipantDoc) : null;

      const startAt = toMillisOrZero(contest.startAt);
      const day = contestDayIndex(now, startAt);
      const votesPerDay = normalizeVotesPerDay(judge?.votesPerDay);
      const votesCast = judge?.votes ?? 0;

      const rejection = rejectVote({
        status: contest.status,
        day,
        aPetId: aPetUid,
        bPetId: bPetUid,
        pickedPetId: pickedPetUid,
        judgeUserUid: userUid,
        aOwnerUid: a?.ownerUid ?? null,
        bOwnerUid: b?.ownerUid ?? null,
        pairKey: key,
        seenPairs: new Set(judge?.seenPairs ?? []),
        votesCast,
        maxVotesPerJudge: contest.maxVotesPerJudge,
        votesToday: votesPerDay[day ?? 0] ?? 0,
        maxVotesPerDay: contest.maxVotesPerDay,
      });
      if (rejection) throw voteError(rejection, contestUid);

      // Déjà couverts par rejectVote ; ici pour le typage.
      if (day === null || !a || !b) throw conflict("état de vote incohérent");

      // DERNIERE LECTURE de la transaction : Firestore exige que toutes les
      // lectures precedent toutes les ecritures, et la sequence en est une.
      // Le numero de jure est attribue une seule fois, a vie (D83).
      const judgeNumber =
        user.judgeNumber ?? judge?.judgeNumber ?? (await nextSequence(t, "judges"));

      const pickedIsA = pickedPetUid === aPetUid;
      const picked = pickedIsA ? a : b;
      const other = pickedIsA ? b : a;
      const pickedRef = pickedIsA ? aRef : bRef;
      const otherRef = pickedIsA ? bRef : aRef;

      const kFactor = contest.eloKFactor || DEFAULT_K_FACTOR;
      const pickedElo = calculateUpdatedElo(
        picked.elo,
        calculateExpectedScore(picked.elo, other.elo),
        1,
        kFactor,
      );
      const otherElo = calculateUpdatedElo(
        other.elo,
        1 - calculateExpectedScore(picked.elo, other.elo),
        0,
        kFactor,
      );
      // `expectedPicked` doit être stocké : sans lui le score de difficulté est
      // définitivement perdu, il n'est pas recalculable après coup (§4.5).
      const expectedPicked = calculateExpectedScore(picked.elo, other.elo);

      t.update(pickedRef, {
        elo: pickedElo,
        wins: picked.wins + 1,
        duels: picked.duels + 1,
        votesReceived: picked.votesReceived + 1,
      });
      t.update(otherRef, {
        elo: otherElo,
        losses: other.losses + 1,
        duels: other.duels + 1,
      });

      const vote: ContestVoteDoc = {
        judgeUserUid: userUid,
        aPetId: aPetUid,
        bPetId: bPetUid,
        pickedPetId: pickedPetUid,
        pairKey: key,
        expectedPicked,
        createdAt: Timestamp.fromMillis(now),
      };
      t.set(contestRef.collection(VOTES).doc(`${key}_${userUid}`), vote);

      votesPerDay[day] = (votesPerDay[day] ?? 0) + 1;
      const votesAfter = votesCast + 1;

      if (judge) {
        t.update(judgeRef, {
          votesPerDay,
          votes: votesAfter,
          seenPairs: FieldValue.arrayUnion(key),
        });
      } else {
        const registrationIndex = (contest.counts?.judges ?? 0) + 1;
        const created: ContestJudgeDoc = {
          userUid,
          judgeNumber,
          userName: user.name,
          userAvatarUrl: user.avatarUrl,
          registrationIndex,
          // Le juré à ce concours-ci (D90) : il se compte dès son premier
          // vote, sa médaille attend la clôture.
          gradeAtEntry: user.grade?.level ?? 0,
          statsAtContest: { ...user.stats, contests: (user.stats?.contests ?? 0) + 1 },
          // Pas de vainqueur avant la clôture : la slab garde sa jauge.
          winner: null,
          votesPerDay,
          votes: votesAfter,
          // Les instantanés appartiennent au job de 18 h, jamais au vote (D54).
          votesSnapshot: 0,
          correctVotes: 0,
          difficultyScore: 0,
          /**
           * Un juré qui arrive en cours de concours n'a pas de rang calculé.
           * Mais Firestore trie les `null` **en premier** en ordre croissant :
           * le laisser à null le placerait en tête du classement jusqu'au
           * prochain 18 h. On le pose donc dernier, ce qui est la vérité — il a
           * un vote et finit dernier tout seul (D58) — jusqu'à ce que le job de
           * 18 h le recalcule. Avant le premier instantané il reste null, parce
           * que la liste sort alors dans l'ordre d'inscription inversé (D87).
           */
          rank: contest.snapshotAt ? registrationIndex : null,
          rankPrevious: null,
          seenPairs: [key],
          joinedAt: Timestamp.fromMillis(now),
        };
        t.set(judgeRef, created);
        t.update(contestRef, { "counts.judges": registrationIndex });
      }

      const userUpdate: Record<string, unknown> = {
        "totals.votes": (user.totals?.votes ?? 0) + 1,
      };
      if (!user.judgeNumber) {
        userUpdate.judgeNumber = judgeNumber;
        userUpdate.judgeSince = Timestamp.fromMillis(now);
      }
      t.update(userRef, userUpdate);

      return {
        day,
        startAt,
        votesPerDay,
        votesCast: votesAfter,
        maxVotesPerDay: contest.maxVotesPerDay,
      };
    });

    return {
      dailyVotes: {
        remaining: remainingVotesToday(cast.votesPerDay, cast.day, cast.maxVotesPerDay),
        capacity: cast.maxVotesPerDay,
        secondsToReset: secondsToReset(now, cast.startAt),
      },
      votesCast: cast.votesCast,
    };
  }),
);

function voteError(rejection: VoteRejection, contestUid: string): HttpError {
  switch (rejection) {
  case "PAIR_IDENTICAL":
    return badRequest("un animal ne peut pas s'affronter lui-même");
  case "PICK_OUTSIDE_PAIR":
    return badRequest("l'animal choisi n'est pas dans le duel");
  case "CONTEST_NOT_RUNNING":
    return conflict(`${contestUid} n'est pas en cours`);
  case "PARTICIPANT_MISSING":
    return notFound("un des deux animaux n'est pas inscrit à ce concours");
  case "OWN_PET":
    return forbidden("on ne juge pas ses propres animaux");
  case "PAIR_ALREADY_JUDGED":
    return conflict("ce duel a déjà été jugé");
  case "CAP_REACHED":
    return conflict("plafond du concours atteint");
  case "DAILY_ALLOCATION_SPENT":
    return conflict("allocation du jour épuisée, remise à 18 h");
  }
}
