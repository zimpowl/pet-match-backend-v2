import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { ReportDoc } from "../models/report";
import { contestOf } from "../collections";
import { CONTEST_ZONE } from "../core/time";

/**
 * La file des signalements (D129), et les gestes qui la vident (D134).
 *
 *   npm run reports -- --project=X                             la file
 *   npm run reports -- --project=X --id=<id> --close --commit        vu, rien à faire
 *   npm run reports -- --project=X --id=<id> --takedown --commit     tout, d'un coup
 *   npm run reports -- --project=X --id=<id> --hide --commit         l'image signalée se tait
 *   npm run reports -- --project=X --id=<id> --show --commit         et elle reparaît
 *   npm run reports -- --project=X --id=<id> --withdraw --commit     hors des concours ouverts
 *   npm run reports -- --project=X --id=<id> --suspend=14 --commit   et le compte aussi
 *
 * `--hide` **ne supprime rien** : la photo reste en base, c'est la preuve du
 * signalement. Elle n'est simplement plus servie, et l'app affiche « photo
 * supprimée » à sa place — y compris sur les concours clos, qu'on ne réécrit
 * jamais. Seule **l'image signalée** se tait : les autres photos de l'animal,
 * celles des inscriptions qu'il a changées, restent servies.
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
  readonly show: boolean;
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
    show: argv.includes("--show"),
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
    photoUrl:
      report.photoUrl ??
      (report.target === "PET" ? snap.get("photoUrl") : snap.get("avatarUrl")) ??
      null,
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
 * **L'image signalée**, et elle seule, se tait partout où elle a été recopiée.
 * `hiddenAt` à `null` fait le geste inverse, et celui-là rend tout : on défait
 * un masquage trop large sans avoir à deviner ce qu'il avait emporté.
 * Un animal en porte plusieurs — celle de sa fiche, et une par inscription
 * qu'il a pu changer : les taire toutes reviendrait à effacer le profil pour
 * un seul signalement.
 *
 * **Rien n'est effacé** : `hiddenAt` suffit à ne plus la servir, et le fichier
 * reste là où il est, parce que c'est lui qui prouve le signalement.
 */
async function hide(
  db: Db,
  report: ReportDoc,
  hiddenAt: Timestamp | null,
  commit: boolean,
): Promise<number> {
  const isPet = report.target === "PET";
  const page = await db.collection(isPet ? "pets" : "users").doc(report.targetUid).get();
  const field = isPet ? "photoUrl" : "avatarUrl";

  // Les signalements d'avant ne disent pas quelle image : c'est celle de la
  // fiche, la seule que la file savait montrer.
  const image = report.photoUrl ?? page.get(field) ?? null;
  if (hiddenAt !== null && image === null) return 0;

  const writer = commit ? db.bulkWriter() : null;
  let touched = 0;

  // Taire vise une image ; rendre les rend toutes. L'asymétrie est voulue :
  // c'est ce qui permet de défaire un masquage trop large sans le rejouer.
  const mute = (doc: FirebaseFirestore.DocumentSnapshot, shown: unknown) => {
    const isHidden = doc.get("hiddenAt") != null;
    if (hiddenAt === null ? !isHidden : shown !== image) return;
    touched++;
    void writer?.update(doc.ref, { hiddenAt });
  };

  mute(page, page.get(field));

  if (isPet) {
    const entries = await db
      .collectionGroup("participants")
      .where("petId", "==", report.targetUid)
      .orderBy("createdAt", "desc")
      .get();
    for (const doc of entries.docs) {
      if (contestOf(doc.ref)) mute(doc, doc.get("photoUrl"));
    }
  } else {
    const seats = await db
      .collectionGroup("judges")
      .where("userUid", "==", report.targetUid)
      .orderBy("joinedAt", "desc")
      .get();
    for (const doc of seats.docs) {
      if (contestOf(doc.ref)) mute(doc, doc.get("userAvatarUrl"));
    }
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
    const contestRef = contestOf(doc.ref);
    if (!contestRef) continue;

    const contest = await contestRef.get();
    if (contest.get("status") === "CLOSED") continue;

    pulled.push(`${contest.get("theme")} (${contest.get("status")})`);
    if (!commit) continue;

    await db.runTransaction(async (t) => {
      const fresh = await t.get(contestRef);
      const count = fresh.get("counts").participants - 1;
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
    const touched = await hide(db, report, Timestamp.now(), options.commit);
    console.log(`image tue sur ${touched} document(s) — le fichier reste`);
  }

  if (options.show) {
    const touched = await hide(db, report, null, options.commit);
    console.log(`image rendue sur ${touched} document(s)`);
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

  const gestures =
    options.close || options.hide || options.show || options.withdraw;
  if (!gestures && options.suspendDays === null) {
    throw new Error(
      "--id demande un geste : --close, --hide, --show, --withdraw, --suspend=<jours> " +
        "ou --takedown",
    );
  }

  await act(db, options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
