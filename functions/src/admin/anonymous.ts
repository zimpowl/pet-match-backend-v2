import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { USERS } from "../collections";
import { isAnonymous } from "../core/provider";

/**
 * Vide le nom « Anonyme » des comptes créés avant que le serveur ne l'écarte.
 *
 * Depuis `f66f535`, `getOrCreate` ne garde plus le nom d'une identité Apple
 * masquée. Les comptes plus anciens le portent encore, et le formulaire de
 * juré le reprend comme pseudo par défaut : « Anonyme » s'y lit comme un nom
 * déjà choisi. Vide, le champ oblige à en choisir un.
 *
 * Une donnée n'a qu'une seule forme : on reprend les documents plutôt que
 * d'ajouter un repli dans le code. Script ponctuel, à supprimer une fois passé.
 *
 * Même garde que les autres outils : refus de tout projet dont l'id ne dit pas
 * « debug », et `--dry-run` par défaut.
 *
 *   npm run anonymous -- --project=pet-match---debug
 *   npm run anonymous -- --project=pet-match---debug --commit
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);

  const snap = await db.collection(USERS).get();
  const writer = options.commit ? db.bulkWriter() : null;
  let cleared = 0;

  for (const doc of snap.docs) {
    const name = doc.get("name");
    if (typeof name !== "string" || !isAnonymous(name)) continue;

    cleared++;
    console.log(`${doc.ref.path} : « ${name} »`);
    void writer?.update(doc.ref, { name: "" });
  }

  await writer?.close();

  console.log(`\nnoms vidés : ${cleared}`);
  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
