import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { DAY_MILLIS } from "../core/allocation";
import { DEFAULT_K_FACTOR } from "../core/elo";
import { ContestDoc, ContestJudgeDoc, ContestParticipantDoc } from "../models/contest";
import { PetDoc } from "../models/pet";
import { SequencesDoc, StatsDoc, UserDoc } from "../models/user";
import {
  JUDGE_COUNT,
  MY_UID,
  NEWEST_NUMBER,
  OLDEST_NUMBER,
  PARTICIPANT_COUNT,
  contestFixture,
  judgeFixture,
  participantFixture,
  photo,
} from "./fixtures";

/**
 * Seed du projet de debug. Idempotent : les identifiants sont fixes, chaque
 * exécution réécrit les mêmes documents. `--dry-run` par défaut, et un garde
 * qui refuse tout projet dont l'id ne dit pas « debug » — la prod n'est jamais
 * une cible.
 *
 *   npm run seed -- --project=pet-match---debug            # compte à blanc
 *   npm run seed -- --project=pet-match---debug --commit    # écrit
 */

const BATCH_SIZE = 400;
const EMPTY_STATS: StatsDoc = {
  contests: 0,
  bestRank: null,
  gold: 0,
  silver: 0,
  bronze: 0,
};

interface Options {
  readonly projectId: string;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId =
    flag("project") ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    "";

  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  // Le garde. L'émulateur est toujours autorisé, il n'atteint rien de réel.
  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!emulated && !/debug/i.test(projectId)) {
    throw new Error(
      `refus d'écrire sur « ${projectId} » : le seed ne cible que les projets de debug`,
    );
  }

  return { projectId, commit: argv.includes("--commit") };
}

/** Accumule les écritures pour pouvoir les compter avant de les poser. */
class Writer {
  private readonly operations: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: unknown;
  }> = [];

  constructor(private readonly db: FirebaseFirestore.Firestore) {}

  set(path: string, data: unknown): void {
    this.operations.push({ ref: this.db.doc(path), data });
  }

  get size(): number {
    return this.operations.length;
  }

  async flush(): Promise<void> {
    for (let i = 0; i < this.operations.length; i += BATCH_SIZE) {
      const batch = this.db.batch();
      for (const operation of this.operations.slice(i, i + BATCH_SIZE)) {
        batch.set(operation.ref, operation.data as FirebaseFirestore.DocumentData, {
          merge: false,
        });
      }
      await batch.commit();
      const done = Math.min(i + BATCH_SIZE, this.operations.length);
      console.log(`  ${done} / ${this.operations.length}`);
    }
  }
}

function stamp(millis: number): Timestamp {
  return Timestamp.fromMillis(millis);
}

function buildUser(
  uid: string,
  name: string,
  avatarUrl: string | null,
  judgeNumber: number | null,
  judgeSince: number | null,
  stats: StatsDoc,
  createdAt: number,
): UserDoc {
  return {
    name,
    avatarUrl,
    description: null,
    countryCode: "FR",
    createdAt: stamp(createdAt),
    fcmToken: null,
    isVerified: false,
    locale: "fr",
    grade: { level: 0 },
    judgeNumber,
    judgeSince: judgeSince === null ? null : stamp(judgeSince),
    stats,
    totals: {
      votes: stats.contests * 70,
      correctVotes: Math.round(stats.contests * 70 * 0.89),
    },
  };
}

function seed(writer: Writer, nowMillis: number): void {
  const contests = [];
  for (let number = NEWEST_NUMBER; number >= OLDEST_NUMBER; number--) {
    contests.push(contestFixture(number, nowMillis));
  }

  const oldest = contests[contests.length - 1];
  const accountCreatedAt = (oldest?.startAt ?? nowMillis) - 30 * DAY_MILLIS;
  const playedContests = contests.filter((contest) => contest.status !== "DRAFT");

  const sequences: SequencesDoc = {
    dogs: 30 + PARTICIPANT_COUNT * 7,
    cats: 30 + PARTICIPANT_COUNT * 7,
    judges: 12 + JUDGE_COUNT * 5,
    contests: NEWEST_NUMBER,
  };
  writer.set("counters/sequences", sequences);

  // Un seul passage sur les fixtures du concours en cours suffit à connaître
  // tous les animaux et tous les jurés : ce sont les mêmes d'une semaine sur
  // l'autre, comme dans la vraie vie.
  const reference = playedContests[0];
  if (!reference) throw new Error("aucun concours jouable dans les fixtures");

  for (let index = 0; index < PARTICIPANT_COUNT; index++) {
    const fixture = participantFixture(index, reference);
    const mine = fixture.ownerUid === MY_UID;

    const pet: PetDoc = {
      userUid: fixture.ownerUid,
      number: fixture.petNumber,
      name: fixture.petName,
      photoUrl: fixture.photoUrl,
      species: fixture.species,
      sex: fixture.sex,
      breed: fixture.petBreed,
      birthDate: stamp(accountCreatedAt - 700 * DAY_MILLIS),
      countryCode: "FR",
      createdAt: stamp(accountCreatedAt + index * 1000),
      microchipId: null,
      verifiedAt: null,
      grade: { level: 0 },
      stats: {
        contests: playedContests.length,
        bestRank: index + 1,
        gold: index === 0 ? 3 : 0,
        silver: index === 1 ? 2 : 0,
        bronze: index === 2 ? 1 : 0,
      },
    };
    writer.set(`pets/${fixture.petId}`, pet);

    if (!mine) {
      writer.set(
        `users/${fixture.ownerUid}`,
        buildUser(
          fixture.ownerUid,
          `Proprio ${index}`,
          null,
          null,
          null,
          EMPTY_STATS,
          accountCreatedAt + index * 1000,
        ),
      );
    }
  }

  for (let index = 0; index < JUDGE_COUNT; index++) {
    const fixture = judgeFixture(index, reference, nowMillis);
    writer.set(
      `users/${fixture.userUid}`,
      buildUser(
        fixture.userUid,
        fixture.userName,
        fixture.userAvatarUrl,
        fixture.judgeNumber,
        accountCreatedAt,
        {
          contests: playedContests.length,
          bestRank: index + 1,
          gold: index === 0 ? 1 : 0,
          silver: 0,
          bronze: index < 3 ? 2 : 0,
        },
        accountCreatedAt,
      ),
    );
  }

  // `zimpo` a un second animal, jamais inscrit : il sert l'écran d'inscription.
  const mia: PetDoc = {
    userUid: MY_UID,
    number: 57,
    name: "Mia",
    photoUrl: photo(21),
    species: "DOG",
    sex: "FEMALE",
    breed: "shiba inu",
    birthDate: null,
    countryCode: "FR",
    createdAt: stamp(accountCreatedAt + 5000),
    microchipId: null,
    verifiedAt: null,
    grade: { level: 0 },
    stats: EMPTY_STATS,
  };
  writer.set("pets/mia", mia);

  for (const contest of contests) {
    const doc: ContestDoc = {
      theme: contest.theme,
      number: contest.number,
      status: contest.status,
      createdAt: stamp(contest.startAt - 7 * DAY_MILLIS),
      startAt: stamp(contest.startAt),
      endAt: stamp(contest.endAt),
      maxVotesPerJudge: contest.maxVotesPerJudge,
      maxVotesPerDay: contest.maxVotesPerDay,
      eloKFactor: DEFAULT_K_FACTOR,
      counts: { participants: contest.participants, judges: contest.judges },
      snapshotAt: contest.snapshotAt === null ? null : stamp(contest.snapshotAt),
    };
    writer.set(`contests/${contest.uid}`, doc);

    for (let index = 0; index < contest.participants; index++) {
      const fixture = participantFixture(index, contest);
      const participant: ContestParticipantDoc = {
        petId: fixture.petId,
        ownerUid: fixture.ownerUid,
        petNumber: fixture.petNumber,
        petName: fixture.petName,
        petBreed: fixture.petBreed,
        species: fixture.species,
        sex: fixture.sex,
        photoUrl: fixture.photoUrl,
        registrationIndex: fixture.registrationIndex,
        gradeAtEntry: 0,
        statsAtContest: EMPTY_STATS,
        elo: fixture.elo,
        wins: fixture.wins,
        losses: fixture.losses,
        duels: fixture.duels,
        votesReceived: fixture.votesReceived,
        eloSnapshot: fixture.eloSnapshot,
        votesReceivedSnapshot: fixture.votesReceivedSnapshot,
        rank: fixture.rank,
        rankPrevious: fixture.rank === null ? null : fixture.rank,
        createdAt: stamp(contest.startAt - (contest.participants - index) * 60_000),
      };
      writer.set(`contests/${contest.uid}/participants/${fixture.petId}`, participant);
    }

    for (let index = 0; index < contest.judges; index++) {
      const fixture = judgeFixture(index, contest, nowMillis);
      const judge: ContestJudgeDoc = {
        userUid: fixture.userUid,
        judgeNumber: fixture.judgeNumber,
        userName: fixture.userName,
        userAvatarUrl: fixture.userAvatarUrl,
        registrationIndex: fixture.registrationIndex,
        gradeAtEntry: 0,
        statsAtContest: EMPTY_STATS,
        winner: null,
        votesPerDay: fixture.votesPerDay,
        votes: fixture.votes,
        votesSnapshot: fixture.votesSnapshot,
        correctVotes: fixture.correctVotes,
        difficultyScore: fixture.difficultyScore,
        rank: fixture.rank,
        rankPrevious: fixture.rank === null ? null : fixture.rank,
        seenPairs: [],
        joinedAt: stamp(contest.startAt - (contest.judges - index) * 60_000),
      };
      writer.set(`contests/${contest.uid}/judges/${fixture.userUid}`, judge);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const app = initializeApp({ projectId: options.projectId });
  const db = getFirestore(app);
  const writer = new Writer(db);

  seed(writer, Date.now());

  console.log(`projet    : ${options.projectId}`);
  console.log(`documents : ${writer.size}`);

  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour poser.");
    return;
  }

  console.log("écriture…");
  await writer.flush();
  console.log("fait.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
