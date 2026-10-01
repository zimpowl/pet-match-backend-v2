import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Bucket } from "@google-cloud/storage";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { VerificationDoc } from "../models/verification";
import { CONTEST_ZONE } from "../core/time";
import { bucketOf } from "../storage";

/**
 * La file des pièces déposées (D126), et les deux gestes qui la vident. La
 * revue est humaine (D42) : rien ici ne décide, l'outil ne fait qu'appliquer.
 *
 *   npm run verifications -- --project=X                                la file
 *   npm run verifications -- --project=X --id=<id> --download            la pièce, en local
 *   npm run verifications -- --project=X --id=<id> --accept --commit
 *   npm run verifications -- --project=X --id=<id> --refuse="motif" --commit
 *
 * La pièce **reste** dans le bucket après la décision : c'est la trace de ce
 * qui a été confirmé, et elle doit pouvoir être reproduite. `--download` la
 * récupère en local sans rien écrire.
 *
 * Le lien imprimé mène à la **console Firebase**, jamais à un lien de
 * téléchargement : `documents/` est fermé en lecture pour tout le monde
 * (`storage.rules`), et un lien à jeton contournerait précisément cette règle.
 * La console demande d'être membre du projet — c'est la bonne porte.
 *
 * L'annonce au joueur n'est pas faite ici : `--accept` lève `isVerified` ou
 * `verifiedAt` et passe la demande à `VERIFIED`, `--refuse` la passe à
 * `REJECTED`, et les déclencheurs de `triggers/account.ts` s'en chargent.
 */

interface Options {
  readonly projectId: string;
  readonly id: string | null;
  readonly accept: boolean;
  readonly refuse: string | null;
  readonly download: string | null;
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

  const accept = argv.includes("--accept");
  const refuse = flag("refuse");
  if (accept && refuse !== null) throw new Error("--accept et --refuse s'excluent");

  const download = argv.includes("--download") ? flag("download") ?? "pieces" : null;

  return {
    projectId,
    id: flag("id"),
    accept,
    refuse,
    download,
    commit: argv.includes("--commit"),
  };
}

function consoleLink(projectId: string, bucket: string, path: string): string {
  const folder = path.split("/").slice(0, -1).join("/").replace(/\//g, "~2F");
  return `https://console.firebase.google.com/project/${projectId}/storage/${bucket}/files/~2F${folder}`;
}

/** Récupérer la pièce telle quelle, pour l'archiver hors de Firebase. */
async function fetchFiles(
  bucket: Bucket,
  request: VerificationDoc,
  options: Options,
): Promise<void> {
  const dir = `${options.download}/${options.id}`;
  await mkdir(dir, { recursive: true });

  for (const file of request.files) {
    const destination = join(dir, basename(file.path));
    await bucket.file(file.path).download({ destination });
    console.log(`récupéré : ${destination}`);
  }
  if (request.files.length === 0) console.log("aucune pièce à récupérer");
  console.log("");
}

function readable(value: Timestamp | null): string {
  if (!value) return "—";
  return new Date(value.toMillis()).toLocaleString("sv-SE", { timeZone: CONTEST_ZONE });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const app = initializeApp({ projectId: options.projectId });
  const db = getFirestore(app);

  if (!options.id) {
    const snap = await db
      .collection("verifications")
      .where("status", "==", "PENDING")
      .orderBy("createdAt", "asc")
      .get();

    // `reviewedAt` reste le second filet : une demande traitée porte toujours
    // une date, même si son statut n'avait pas suivi — ce fut le cas des
    // demandes acceptées avant que `VERIFIED` ne soit écrit ici.
    const waiting = snap.docs.filter((doc) => doc.get("reviewedAt") == null);

    console.log(`${waiting.length} pièce(s) en attente`);
    if (waiting.length > 0) {
      const bucket = await bucketOf(app, options.projectId);
      for (const doc of waiting) {
        const request = doc.data() as VerificationDoc;
        console.log(
          `\n  ${doc.id}  ${request.target.padEnd(5)} ${request.userUid}` +
            `${request.petUid ? ` animal=${request.petUid}` : ""}` +
            `  déposée ${readable(request.createdAt)}`,
        );
        for (const file of request.files) {
          console.log(`    ${file.path.split("/").pop()}  ${file.contentType ?? "type inconnu"}`);
          console.log(`    ${consoleLink(options.projectId, bucket.name, file.path)}`);
        }
      }
    }
    if (waiting.length > 0) {
      console.log("\n--id=<id> --accept  ou  --id=<id> --refuse=\"motif\"");
    }
    return;
  }

  const ref = db.collection("verifications").doc(options.id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`demande ${options.id} introuvable`);

  const request = snap.data() as VerificationDoc;

  if (options.download !== null) {
    await fetchFiles(await bucketOf(app, options.projectId), request, options);
  }

  if (!options.accept && options.refuse === null) {
    console.log(JSON.stringify({ ...request, createdAt: readable(request.createdAt) }, null, 2));
    console.log("\naucun geste demandé : ajouter --accept ou --refuse=\"motif\"");
    return;
  }

  const target =
    request.target === "PET" && request.petUid ?
      db.collection("pets").doc(request.petUid) :
      db.collection("users").doc(request.userUid);

  const decision = options.accept ? "acceptée" : "refusée";
  console.log(`demande ${options.id} : ${decision}`);
  console.log(`  cible   ${target.path}`);
  const bucket = await bucketOf(app, options.projectId);
  if (request.files.length === 0) {
    console.log("  pièces  aucune");
  }
  for (const file of request.files) {
    console.log(`  pièce   ${file.path}  ${file.contentType ?? "type inconnu"}`);
    console.log(`          ${consoleLink(options.projectId, bucket.name, file.path)}`);
  }

  if (!options.commit) {
    console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit.");
    return;
  }

  if (options.accept) {
    await target.update(
      request.target === "PET" ? { verifiedAt: Timestamp.now() } : { isVerified: true },
    );
  }

  await ref.update({
    status: options.accept ? "VERIFIED" : "REJECTED",
    reviewedAt: Timestamp.now(),
    reason: options.refuse,
  });

  console.log("fait. Le joueur est prévenu par les déclencheurs du dossier.");
  console.log("La pièce reste dans le bucket : --download la récupère.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
