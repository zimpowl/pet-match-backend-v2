import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { ReportDoc } from "../models/report";
import { CONTEST_ZONE } from "../core/time";

/**
 * La file des signalements (D129). Un signalement n'agit sur rien : il attend
 * qu'on le lise. C'est ici qu'on le lit, et c'est ici qu'on le referme.
 *
 *   npm run reports -- --project=pet-match---debug
 *   npm run reports -- --project=pet-match---debug --all
 *   npm run reports -- --project=pet-match---debug --close=<id> --commit
 *
 * Fermer un signalement ne retire rien : c'est dire « vu, traité ». Ce qu'il
 * faut faire de la publication — la retirer, annuler la participation, retirer
 * la confirmation — se fait à côté, et se décide en la regardant.
 */

interface Options {
  readonly projectId: string;
  readonly all: boolean;
  readonly close: string | null;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length) ?? null;

  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  return {
    projectId,
    all: argv.includes("--all"),
    close: flag("close"),
    commit: argv.includes("--commit"),
  };
}

function readable(stamp: Timestamp): string {
  return stamp.toDate().toLocaleString("sv-SE", { timeZone: CONTEST_ZONE });
}

/** Le nom du visé, pour qu'une ligne se lise sans ouvrir la console. */
async function label(
  db: FirebaseFirestore.Firestore,
  report: ReportDoc,
): Promise<string> {
  const collection = report.target === "PET" ? "pets" : "users";
  const snap = await db.collection(collection).doc(report.targetUid).get();
  if (!snap.exists) return `${report.targetUid} (introuvable)`;

  const name =
    report.target === "PET" ? snap.get("name") : snap.get("nickname") ?? snap.get("name");
  const number = snap.get("number") ?? snap.get("judgeNumber") ?? "?";

  return `${name ?? "?"} — n° ${number}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}\n`);

  if (options.close) {
    const ref = db.collection("reports").doc(options.close);
    if (!(await ref.get()).exists) throw new Error(`signalement ${options.close} introuvable`);

    if (options.commit) {
      await ref.update({ status: "CLOSED", reviewedAt: Timestamp.now() });
      console.log(`signalement ${options.close} fermé`);
    } else {
      console.log(`--dry-run : ajouter --commit pour fermer ${options.close}`);
    }
    return;
  }

  let query = db.collection("reports").orderBy("createdAt", "desc");
  if (!options.all) query = query.where("status", "==", "OPEN");

  const snap = await query.get();
  if (snap.empty) {
    console.log("aucun signalement.");
    return;
  }

  for (const doc of snap.docs) {
    const report = doc.data() as ReportDoc;
    console.log(
      `${doc.id}  ${report.status.padEnd(6)}  ${readable(report.createdAt)}  ` +
        `${report.target.padEnd(5)}  ${await label(db, report)}`,
    );
    console.log(`    signalé par ${report.reporterUid}\n`);
  }

  console.log(`${snap.size} signalement(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
