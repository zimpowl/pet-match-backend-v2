import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { ReportDoc } from "../models/report";
import { CONTEST_ZONE } from "../core/time";

/**
 * La file des signalements (D129), et les gestes qui la vident (D134).
 *
 *   npm run reports -- --project=X                             la file
 *   npm run reports -- --project=X --id=<id> --close --commit        vu, rien à faire
 *   npm run reports -- --project=X --id=<id> --takedown --commit     tout, d'un coup
 *   npm run reports -- --project=X --id=<id> --hide --commit         l'image se tait
 *   npm run reports -- --project=X --id=<id> --withdraw --commit     hors des concours ouverts
 *   npm run reports -- --project=X --id=<id> --suspend=14 --commit   et le compte aussi
 *
 * `--hide` **ne supprime rien** : la photo reste en base, c'est la preuve du
 * signalement. Elle n'est simplement plus servie, et l'app affiche « photo
 * supprimée » à sa place — y compris sur les concours clos, qu'on ne réécrit
 * jamais.
 *
 * `--withdraw` ne touche **que les concours non clos** : l'inscription y est
 * retirée, et le deuxième passe premier au prochain classement du soir. Un
 * concours clos garde ses participations : les en sortir referait le palmarès
 * de gens qui n'ont rien demandé (D117).
 *
 * `--takedown` fait les deux. Tous ferment le signalement, et `--dry-run` est
 * le défaut.
 */

const DAY_MILLIS = 24 * 60 * 60 * 1000;

interface Options {
  readonly projectId: string;
  readonly all: boolean;
  readonly id: string | null;
  readonly close: boolean;
  readonly hide: boolean;
  readonly withdraw: boolean;
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
    hide: argv.includes("--hide") || argv.includes("--takedown"),
    withdraw: argv.includes("--withdraw") || argv.includes("--takedown"),
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
 * L'image se tait partout où elle a été recopiée — la fiche, chaque
 * participation, la place du juré. **Rien n'est effacé** : `hiddenAt` suffit à
 * ne plus la servir, et la photo reste là où elle est, parce que c'est elle qui
 * prouve le signalement.
 */
async function hide(db: Db, report: ReportDoc, commit: boolean): Promise<number> {
  const writer = commit ? db.bulkWriter() : null;
  const hiddenAt = Timestamp.now();
  let touched = 0;

  const mute = (ref: FirebaseFirestore.DocumentReference) => {
    touched++;
    void writer?.update(ref, { hiddenAt });
  };

  if (report.target === "PET") {
    mute(db.collection("pets").doc(report.targetUid));

    const entries = await db
      .collectionGroup("participants")
      .where("petId", "==", report.targetUid)
      .orderBy("createdAt", "desc")
      .get();
    for (const doc of entries.docs) mute(doc.ref);
  } else {
    mute(db.collection("users").doc(report.targetUid));

    const seats = await db
      .collectionGroup("judges")
      .where("userUid", "==", report.targetUid)
      .orderBy("joinedAt", "desc")
      .get();
    for (const doc of seats.docs) mute(doc.ref);
  }

  await writer?.close();
  return touched;
}

/**
 * Sortir des concours **encore ouverts**, et de ceux-là seulement. Le compteur
 * suit, sans quoi le concours annoncerait un participant qu'il n'a plus ; les
 * rangs, eux, se refont d'eux-mêmes au prochain 18 h.
 */
async function withdraw(db: Db, petUid: string, commit: boolean): Promise<string[]> {
  const entries = await db
    .collectionGroup("participants")
    .where("petId", "==", petUid)
    .orderBy("createdAt", "desc")
    .get();

  const pulled: string[] = [];

  for (const doc of entries.docs) {
    const contestRef = doc.ref.parent.parent;
    if (!contestRef) continue;

    const contest = await contestRef.get();
    if (contest.get("status") === "CLOSED") continue;

    pulled.push(`${contest.get("theme")} (${contest.get("status")})`);
    if (!commit) continue;

    await db.runTransaction(async (t) => {
      const fresh = await t.get(contestRef);
      const count = (fresh.get("counts")?.participants ?? 1) - 1;
      t.delete(doc.ref);
      t.update(contestRef, { "counts.participants": Math.max(0, count) });
    });
  }

  return pulled;
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

  if (options.hide) {
    const touched = await hide(db, report, options.commit);
    console.log(`image tue sur ${touched} document(s) — le fichier reste`);
  }

  if (options.withdraw) {
    if (report.target !== "PET") {
      console.log("retrait de concours : sans objet pour un juré");
    } else {
      const pulled = await withdraw(db, report.targetUid, options.commit);
      console.log(
        pulled.length === 0 ?
          "aucun concours ouvert à quitter" :
          `retiré de : ${pulled.join(", ")}`,
      );
    }
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

  if (!options.close && !options.hide && !options.withdraw && options.suspendDays === null) {
    throw new Error(
      "--id demande un geste : --close, --hide, --withdraw, --suspend=<jours> ou --takedown",
    );
  }

  await act(db, options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
