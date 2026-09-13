import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { ReportDoc } from "../models/report";
import { CONTEST_ZONE } from "../core/time";

/**
 * La file des signalements (D129), et les trois gestes qui la vident.
 *
 *   npm run reports -- --project=X                            la file
 *   npm run reports -- --project=X --id=<id> --close --commit       vu, rien à faire
 *   npm run reports -- --project=X --id=<id> --takedown --commit    l'image part partout
 *   npm run reports -- --project=X --id=<id> --suspend=14 --commit  et le compte se tait
 *
 * `--takedown` retire **l'image**, jamais le résultat : la participation reste,
 * le rang reste, les votes restent. Effacer une participation referait le
 * classement de tous les autres, qui n'ont rien demandé (D117).
 *
 * `--suspend` et `--takedown` se cumulent, et ferment le signalement d'office :
 * on ne traite pas deux fois la même ligne.
 */

const DAY_MILLIS = 24 * 60 * 60 * 1000;

interface Options {
  readonly projectId: string;
  readonly all: boolean;
  readonly id: string | null;
  readonly close: boolean;
  readonly takedown: boolean;
  readonly suspendDays: number | null;
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

  const days = flag("suspend");

  return {
    projectId,
    all: argv.includes("--all"),
    id: flag("id"),
    close: argv.includes("--close"),
    takedown: argv.includes("--takedown"),
    suspendDays: days === null ? null : Number(days),
    commit: argv.includes("--commit"),
  };
}

function readable(stamp: Timestamp): string {
  return stamp.toDate().toLocaleString("sv-SE", { timeZone: CONTEST_ZONE });
}

type Db = FirebaseFirestore.Firestore;

/** De quoi décider sans ouvrir la console : le nom, le numéro, et l'image visée. */
async function describe(db: Db, report: ReportDoc) {
  const snap = await db
    .collection(report.target === "PET" ? "pets" : "users")
    .doc(report.targetUid)
    .get();
  if (!snap.exists) return { name: "(introuvable)", number: "?", photoUrl: null, ownerUid: null };

  const judgeName = snap.get("nickname") ?? snap.get("name");

  return {
    name: (report.target === "PET" ? snap.get("name") : judgeName) ?? "?",
    number: snap.get("number") ?? snap.get("judgeNumber") ?? "?",
    photoUrl: (report.target === "PET" ? snap.get("photoUrl") : snap.get("avatarUrl")) ?? null,
    ownerUid: report.target === "PET" ? snap.get("userUid") : snap.id,
  };
}

async function list(db: Db, options: Options): Promise<void> {
  let query = db.collection("reports").orderBy("createdAt", "desc");
  if (!options.all) query = query.where("status", "==", "OPEN");

  const snap = await query.get();
  if (snap.empty) {
    console.log("aucun signalement.");
    return;
  }

  for (const doc of snap.docs) {
    const report = doc.data() as ReportDoc;
    const about = await describe(db, report);
    console.log(
      `${doc.id}  ${report.status.padEnd(6)}  ${readable(report.createdAt)}  ` +
        `${report.target.padEnd(5)}  ${about.name} — n° ${about.number}`,
    );
    console.log(`    image   : ${about.photoUrl ?? "(aucune)"}`);
    console.log(`    signalé par ${report.reporterUid}\n`);
  }

  console.log(`${snap.size} signalement(s).`);
}

/**
 * L'image disparaît partout où elle a été recopiée : sur la fiche, sur chaque
 * participation, et sur la slab des jurés qui l'ont vue gagner.
 */
async function takedown(db: Db, report: ReportDoc, commit: boolean): Promise<number> {
  const writer = commit ? db.bulkWriter() : null;
  let touched = 0;

  const erase = (ref: FirebaseFirestore.DocumentReference, patch: Record<string, unknown>) => {
    touched++;
    void writer?.update(ref, patch);
  };

  if (report.target === "PET") {
    erase(db.collection("pets").doc(report.targetUid), { photoUrl: null });

    const entries = await db
      .collectionGroup("participants")
      .where("petId", "==", report.targetUid)
      .orderBy("createdAt", "desc")
      .get();
    for (const doc of entries.docs) erase(doc.ref, { photoUrl: null });

    const witnesses = await db
      .collectionGroup("judges")
      .where("winner.petId", "==", report.targetUid)
      .get();
    for (const doc of witnesses.docs) erase(doc.ref, { "winner.photoUrl": null });
  } else {
    erase(db.collection("users").doc(report.targetUid), { avatarUrl: null });

    const seats = await db
      .collectionGroup("judges")
      .where("userUid", "==", report.targetUid)
      .orderBy("joinedAt", "desc")
      .get();
    for (const doc of seats.docs) erase(doc.ref, { userAvatarUrl: null });
  }

  await writer?.close();
  return touched;
}

async function suspend(db: Db, uid: string, days: number, commit: boolean): Promise<number> {
  const until = Timestamp.fromMillis(Date.now() + days * DAY_MILLIS);
  if (commit) await db.collection("users").doc(uid).update({ suspendedUntil: until });

  return until.toMillis();
}

async function act(db: Db, options: Options): Promise<void> {
  const ref = db.collection("reports").doc(options.id as string);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`signalement ${options.id} introuvable`);

  const report = snap.data() as ReportDoc;
  const about = await describe(db, report);
  console.log(`${report.target} ${about.name} — n° ${about.number}`);
  console.log(`image : ${about.photoUrl ?? "(aucune)"}\n`);

  if (options.takedown) {
    const touched = await takedown(db, report, options.commit);
    console.log(`image retirée de ${touched} document(s)`);
  }

  if (options.suspendDays !== null) {
    if (!about.ownerUid) throw new Error("propriétaire introuvable : suspension impossible");
    const until = await suspend(db, about.ownerUid, options.suspendDays, options.commit);
    console.log(
      `compte ${about.ownerUid} suspendu jusqu'au ${readable(Timestamp.fromMillis(until))}`,
    );
  }

  if (options.commit) {
    await ref.update({ status: "CLOSED", reviewedAt: Timestamp.now() });
    console.log("signalement fermé");
  } else {
    console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}\n`);

  if (!options.id) {
    await list(db, options);
    return;
  }

  if (!options.close && !options.takedown && options.suspendDays === null) {
    throw new Error("--id demande un geste : --close, --takedown ou --suspend=<jours>");
  }

  await act(db, options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
