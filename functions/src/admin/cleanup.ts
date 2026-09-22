import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * Suppression des collections mortes, sous-collections comprises. Sauvegarde
 * **avant** de supprimer, `--dry-run` par défaut, garde anti-prod et liste
 * blanche.
 *
 *   npm run cleanup -- --project=pet-match---debug --collection=challenges
 *   npm run cleanup -- --project=pet-match---debug --collection=challenges --commit
 *
 * Ordre de la bascule finale, et il compte : la migration **lit** `challenges`,
 * donc elle ne peut pas les supprimer elle-même sans se priver de sa source.
 *
 *   1. npm run migrate -- --project=… --commit     (rejouable tant qu'on teste)
 *   2. vérifier l'app de bout en bout
 *   3. npm run cleanup -- --project=… --collection=challenges,contests,matches,posts --commit
 *
 * Après l'étape 3 il ne reste plus une ligne de legacy, et le garde `contestOf`
 * de `collections.ts` n'a plus rien à écarter.
 */

type Selector = (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean;

/**
 * Ce qui est supprimable, et ce qu'on en prend.
 *
 * - `challenges` la source de la migration : concours, participants, jurés et
 *                votes de la génération précédente. Le backend legacy la lit
 *                encore : la supprimer, c'est éteindre l'ancienne app.
 * - `contests`   **les seuls vestiges v0** — ceux qui n'ont pas de `number`.
 *                La collection porte aussi les concours v2 : le sélecteur
 *                existe pour qu'une ligne de commande ne puisse pas les viser.
 * - `matches`    le système de brackets de la v0.
 * - `posts`      le fil social de la v0.
 *
 * Volontairement absentes : `configuration` (gating de version), `instagram_*`
 * (l'automatisation tourne encore, D15), `pets` et `users` que la migration
 * reprend en place.
 */
const DELETABLE: Record<string, Selector> = {
  challenges: () => true,
  contests: (doc) => typeof doc.get("number") !== "number",
  matches: () => true,
  posts: () => true,
};

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

  const known = Object.keys(DELETABLE).join(", ");
  const collections = (flag("collection") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (collections.length === 0) throw new Error(`--collection manquant. Supprimables : ${known}`);

  for (const name of collections) {
    if (!(name in DELETABLE)) {
      throw new Error(`« ${name} » n'est pas dans la liste blanche. Supprimables : ${known}`);
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

interface Dumped {
  readonly data: unknown;
  readonly children: Record<string, Record<string, Dumped>>;
}

/**
 * La sauvegarde descend dans les sous-collections : un `challenges/{id}` sans
 * ses votes ne se restaure pas, et c'est précisément ce qu'on efface.
 */
async function dump(ref: FirebaseFirestore.DocumentReference, data: unknown): Promise<Dumped> {
  const children: Record<string, Record<string, Dumped>> = {};

  for (const child of await ref.listCollections()) {
    const snap = await child.get();
    const rows: Record<string, Dumped> = {};
    for (const doc of snap.docs) rows[doc.id] = await dump(doc.ref, serialize(doc.data()));
    children[child.id] = rows;
  }

  return { data, children };
}

function count(rows: Record<string, Dumped>): number {
  return Object.values(rows).reduce(
    (total, row) =>
      total + 1 + Object.values(row.children).reduce((sub, kids) => sub + count(kids), 0),
    0,
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);
  mkdirSync(options.outDir, { recursive: true });

  for (const name of options.collections) {
    const snap = await db.collection(name).get();
    const targets = snap.docs.filter(DELETABLE[name]);
    const kept = snap.size - targets.length;

    const documents: Record<string, Dumped> = {};
    for (const doc of targets) documents[doc.id] = await dump(doc.ref, serialize(doc.data()));

    const backupPath = join(options.outDir, `${name}.json`);
    writeFileSync(
      backupPath,
      JSON.stringify({ project: options.projectId, collection: name, documents }, null, 2),
    );

    const total = count(documents);
    console.log(
      `  ${name.padEnd(12)} ${String(targets.length).padStart(5)} docs` +
        ` (${total} avec les sous-collections)` +
        `${kept > 0 ? `, ${kept} conservés` : ""} -> ${backupPath}`,
    );

    if (!options.commit) continue;

    let done = 0;
    for (const doc of targets) {
      await db.recursiveDelete(doc.ref);
      done++;
      if (done % 25 === 0 || done === targets.length) {
        console.log(`    supprimés ${done} / ${targets.length}`);
      }
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
