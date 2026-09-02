import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * Suppression des collections mortes de la v0. Sauvegarde **avant** de
 * supprimer, `--dry-run` par défaut, garde anti-prod, et liste blanche : une
 * faute de frappe ne peut pas viser `users`, `pets` ou `challenges`.
 *
 *   npm run cleanup -- --project=pet-match---debug --collection=contests
 *   npm run cleanup -- --project=pet-match---debug --collection=contests --commit
 */

/**
 * Ce qui est supprimable, et pourquoi. Le backend legacy encore déployé ne lit
 * aucune de ces trois collections — il ne touche que `challenges`, `judges`,
 * `participants`, `votes`, `pets`, `users` et `instagram_*`.
 *
 * - `contests`  génération v0, remplacée par `challenges` : `category`,
 *               `entryFee`, `petMax`, `winnerUid`, statuts `FINISHED` /
 *               `IN_PROGRESS` / `OPEN_FOR_REGISTRATION`. C'est aussi le nom que
 *               le §3 vise pour v2, donc la place doit être nette.
 * - `matches`   le système de brackets de la v0, dont les identifiants
 *               référencent les anciens `contests`.
 * - `posts`     le fil social de la v0.
 *
 * Volontairement absentes : `configuration` (le gating de version de l'app),
 * `instagram_config` et `instagram_posts` (l'automatisation tourne encore, elle
 * est hors périmètre de la refonte — D15 — mais pas morte), et bien sûr
 * `challenges`, `pets` et `users`, que la migration reprend.
 */
const DELETABLE = new Set(["contests", "matches", "posts"]);

const BATCH_SIZE = 400;

interface Options {
  readonly projectId: string;
  readonly collections: string[];
  readonly outDir: string;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!emulated && !/debug/i.test(projectId)) {
    throw new Error(
      `refus de supprimer sur « ${projectId} » : le nettoyage ne cible que les projets de debug`,
    );
  }

  const collections = (flag("collection") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (collections.length === 0) {
    throw new Error(
      `--collection manquant. Supprimables : ${[...DELETABLE].join(", ")}`,
    );
  }

  for (const name of collections) {
    if (!DELETABLE.has(name)) {
      throw new Error(
        `« ${name} » n'est pas dans la liste blanche. Supprimables : ${[...DELETABLE].join(", ")}`,
      );
    }
  }

  return {
    projectId,
    collections,
    outDir: flag("out") ?? "backup",
    commit: argv.includes("--commit"),
  };
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

  console.log(`projet : ${options.projectId}`);
  mkdirSync(options.outDir, { recursive: true });

  for (const name of options.collections) {
    const snap = await db.collection(name).get();

    // On refuse de supprimer un document qui porte des sous-collections : ce
    // serait laisser des orphelins injoignables.
    let withChildren = 0;
    for (const doc of snap.docs.slice(0, 50)) {
      const subs = await doc.ref.listCollections();
      if (subs.length > 0) withChildren++;
    }
    if (withChildren > 0) {
      throw new Error(
        `${name} : ${withChildren} document(s) portent des sous-collections, suppression refusée`,
      );
    }

    const backupPath = join(options.outDir, `${name}.json`);
    writeFileSync(
      backupPath,
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

    const size = String(snap.size).padStart(5);
    console.log(`  ${name.padEnd(12)} ${size} docs -> sauvegardés dans ${backupPath}`);

    if (!options.commit) continue;

    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + BATCH_SIZE)) batch.delete(doc.ref);
      await batch.commit();
      const done = Math.min(i + BATCH_SIZE, snap.docs.length);
      console.log(`    supprimés ${done} / ${snap.docs.length}`);
    }
  }

  if (!options.commit) {
    console.log();
    console.log("--dry-run : la sauvegarde est écrite, rien n'a été supprimé.");
    console.log("Ajouter --commit pour supprimer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
