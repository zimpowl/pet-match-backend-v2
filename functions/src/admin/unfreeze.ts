import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { JUDGES, PARTICIPANTS, contestOf } from "../collections";

/**
 * Retire `gradeAtEntry` et `statsAtContest` des participations.
 *
 * Les médailles n'ont plus qu'une source : le document du porteur. Ces deux
 * champs en étaient une copie, posée à l'inscription et regelée à la clôture ;
 * plus personne ne les écrit ni ne les lit. Les laisser en base, c'est laisser
 * une seconde vérité derrière soi — celle qu'on relira par erreur dans six
 * mois, et qui mentira.
 *
 * Une donnée n'a qu'une seule forme : le code ne sait plus lire l'ancienne, on
 * reprend donc les documents plutôt que d'ajouter un repli.
 *
 * Même garde que les autres outils : refus de tout projet dont l'id ne dit pas
 * « debug », et `--dry-run` par défaut.
 *
 *   npm run unfreeze -- --project=pet-match---debug
 *   npm run unfreeze -- --project=pet-match---debug --commit
 */

interface Options {
  readonly projectId: string;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const projectId =
    argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length) ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!emulated && !/debug/i.test(projectId)) {
    throw new Error(
      `refus d'écrire sur « ${projectId} » : cet outil ne cible que les projets de debug`,
    );
  }

  return { projectId, commit: argv.includes("--commit") };
}

const FROZEN = ["gradeAtEntry", "statsAtContest"] as const;

/**
 * Le groupe de collections ramène aussi les sous-collections du legacy, qui
 * portent le même nom sans vivre sous `contests`. `contestOf` les écarte :
 * le garde n'est pas décoratif, il est appelé à chaque document.
 */
async function strip(
  db: FirebaseFirestore.Firestore,
  group: string,
  commit: boolean,
): Promise<number> {
  const snap = await db.collectionGroup(group).get();
  const writer = commit ? db.bulkWriter() : null;
  let stripped = 0;

  for (const doc of snap.docs) {
    if (!contestOf(doc.ref)) continue;
    const carried = FROZEN.filter((field) => doc.get(field) !== undefined);
    if (carried.length === 0) continue;

    stripped++;
    console.log(`${doc.ref.path} : ${carried.join(", ")}`);
    void writer?.update(
      doc.ref,
      Object.fromEntries(FROZEN.map((field) => [field, FieldValue.delete()])),
    );
  }

  await writer?.close();
  return stripped;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);

  const participants = await strip(db, PARTICIPANTS, options.commit);
  const judges = await strip(db, JUDGES, options.commit);

  console.log(`\nparticipations dégelées : ${participants}, jurés dégelés : ${judges}`);
  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
