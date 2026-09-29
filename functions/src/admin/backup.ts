import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * Sauvegarde JSON d'une ou plusieurs collections. **Lecture seule** : c'est
 * pour ça qu'il n'y a pas de liste blanche ici, contrairement à l'outil de
 * purge qui l'accompagnait. Une liste blanche protège la suppression, pas la
 * lecture, et refuser de sauvegarder une collection n'aurait protégé personne.
 *
 *   npm run backup -- --project=pet-match---debug --collection=pets,users
 */

interface Options {
  readonly projectId: string;
  readonly collections: string[];
  readonly outDir: string;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  const collections = (flag("collection") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (collections.length === 0) throw new Error("--collection manquant");

  return { projectId, collections, outDir: flag("out") ?? "backup" };
}

/** Les Timestamp ne survivent pas à JSON : on les rend restaurables. */
function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return { __timestamp__: value.toMillis() };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));
  mkdirSync(options.outDir, { recursive: true });

  console.log(`projet : ${options.projectId}`);
  for (const name of options.collections) {
    const snap = await db.collection(name).get();
    const path = join(options.outDir, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        {
          project: options.projectId,
          collection: name,
          count: snap.size,
          documents: Object.fromEntries(
            snap.docs.map((doc) => [doc.id, serialize(doc.data())]),
          ),
        },
        null,
        2,
      ),
    );
    console.log(`  ${name.padEnd(12)} ${String(snap.size).padStart(5)} docs -> ${path}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
