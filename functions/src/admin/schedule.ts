import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { CONTEST_ZONE, atContestHour } from "../core/time";

/**
 * Recale sur **18 h de Paris** le départ et la fin des concours qui n'ont pas
 * encore fermé. L'heure de bascule d'un concours est son `startAt` et le cycle
 * du soir tourne à 18 h : quand les deux ne coïncident pas, l'instantané fige
 * une journée qui n'est pas finie. Les dix-huit concours repris démarraient à
 * 20 h, et comme chaque concours hérite de la fin du précédent, la dérive se
 * propageait indéfiniment.
 *
 * Les concours **clos ne bougent pas** : leurs dates sont leur histoire.
 *
 * Même garde que la migration et le nettoyage : refus de tout projet dont l'id ne
 * dit pas « debug ». Et `--dry-run` par défaut.
 *
 *   npm run schedule -- --project=pet-match---debug
 *   npm run schedule -- --project=pet-match---debug --commit
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

function readable(millis: number): string {
  return new Date(millis).toLocaleString("sv-SE", { timeZone: CONTEST_ZONE });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);

  const snap = await db.collection("contests").where("status", "!=", "CLOSED").get();
  const writer = options.commit ? db.bulkWriter() : null;
  let moved = 0;

  for (const doc of snap.docs) {
    const startAt = (doc.get("startAt") as Timestamp | undefined)?.toMillis();
    const endAt = (doc.get("endAt") as Timestamp | undefined)?.toMillis();
    if (startAt === undefined || endAt === undefined) continue;

    const nextStart = atContestHour(startAt);
    const nextEnd = atContestHour(endAt);
    if (nextStart === startAt && nextEnd === endAt) continue;

    moved++;
    console.log(
      `n° ${doc.get("number")} ${doc.get("status")} : ` +
        `${readable(startAt)} → ${readable(nextStart)}`,
    );

    void writer?.update(doc.ref, {
      startAt: Timestamp.fromMillis(nextStart),
      endAt: Timestamp.fromMillis(nextEnd),
    });
  }

  await writer?.close();

  console.log(`\nconcours ${options.commit ? "recalés" : "à recaler"} : ${moved}`);
  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
