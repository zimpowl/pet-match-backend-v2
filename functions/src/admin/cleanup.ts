import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * Suppression des collections mortes, sous-collections comprises. Sauvegarde
 * **avant** de supprimer, `--dry-run` par défaut, garde anti-prod et cibles
 * nommées.
 *
 *   npm run cleanup -- --project=pet-match---debug --targets=legacy
 *   npm run cleanup -- --project=pet-match---debug --targets=legacy --commit
 *
 * Attention : `--dry-run` ne supprime rien dans Firestore, mais **écrit quand
 * même** la sauvegarde, et donc écrase le fichier du même nom déjà présent.
 * Pour inspecter sans toucher à une sauvegarde existante, passer `--out`.
 *
 * Les cibles sont nommées et jamais devinées : une ligne de runbook tient en un
 * mot, là où une liste de collections est autant d'occasions de se tromper.
 *
 * **La production est faite** (2026-09-29, 12 464 documents supprimés) et l'outil
 * de migration a été retiré avec elle. Il reste à cet outil un seul travail :
 * le projet de debug, qui porte encore le jeu legacy et ne s'en débarrassera pas
 * tout seul — une republication de la prod n'efface pas les collections absentes
 * de sa source.
 *
 *   npm run cleanup -- --project=pet-match---debug \
 *     --targets=contests-v0,legacy,instagram,mail --commit
 *
 * Une fois debug purgé, les quatre cibles n'auront plus de contenu nulle part.
 * Le geste juste sera alors de supprimer ce fichier : un outil de suppression
 * dont aucune cible n'existe ne peut plus que se tromper, et le jour où une
 * autre collection devra partir, écrire sa cible vaudra mieux que réactiver
 * quatre noms morts.
 */

type Selector = (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean;

interface Target {
  readonly collection: string;
  /** Absent : toute la collection. Présent : seulement ce qu'il retient. */
  readonly select?: Selector;
}

/**
 * Ce qui est supprimable, groupé par intention.
 *
 * - `contests-v0` **les seuls vestiges v0** — ceux qui n'ont pas de `number`.
 *                 La collection porte aussi les concours v2 : le sélecteur
 *                 existe pour qu'aucune ligne de commande ne puisse les viser.
 * - `legacy`      la source de la migration et les collections de la v0. Le
 *                 backend legacy lit encore `challenges` : la supprimer, c'est
 *                 éteindre l'ancienne app.
 * - `instagram`   l'automation hors périmètre (D15), qui vivait dans l'ancien
 *                 backend et n'a jamais eu de code en v2.
 * - `mail`        la file de courrier, écrite pendant des mois par un canal que
 *                 l'extension d'envoi, jamais installée, n'a jamais vidée.
 */
const TARGETS: Record<string, readonly Target[]> = {
  "contests-v0": [
    { collection: "contests", select: (doc) => typeof doc.get("number") !== "number" },
  ],
  "legacy": [{ collection: "challenges" }, { collection: "matches" }, { collection: "posts" }],
  "instagram": [{ collection: "instagram_posts" }, { collection: "instagram_config" }],
  "mail": [{ collection: "mail" }],
};

/**
 * Ce qu'on ne supprime jamais **en entier**, quoi qu'on demande. `contests` y
 * figure tout en restant atteignable par `contests-v0` : une cible sélective
 * sait ce qu'elle prend, une suppression de collection non.
 */
const PROTECTED = new Set([
  "users",
  "pets",
  "contests",
  "counters",
  "configuration",
  "verifications",
  "reports",
]);

interface Options {
  readonly projectId: string;
  readonly targets: readonly string[];
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

  const known = Object.keys(TARGETS).join(", ");
  const targets = (flag("targets") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (targets.length === 0) throw new Error(`--targets manquant. Cibles : ${known}`);

  for (const name of targets) {
    if (!(name in TARGETS)) throw new Error(`cible inconnue « ${name} ». Cibles : ${known}`);
    for (const target of TARGETS[name]) {
      if (!target.select && PROTECTED.has(target.collection)) {
        throw new Error(`collection protégée : ${target.collection}`);
      }
    }
  }

  return {
    projectId,
    targets,
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

async function sweep(
  db: FirebaseFirestore.Firestore,
  target: Target,
  options: Options,
): Promise<void> {
  const snap = await db.collection(target.collection).get();
  const doomed = target.select ? snap.docs.filter(target.select) : snap.docs;
  const kept = snap.size - doomed.length;

  const documents: Record<string, Dumped> = {};
  for (const doc of doomed) documents[doc.id] = await dump(doc.ref, serialize(doc.data()));

  const backupPath = join(options.outDir, `${target.collection}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      { project: options.projectId, collection: target.collection, documents },
      null,
      2,
    ),
  );

  console.log(
    `  ${target.collection.padEnd(16)} ${String(doomed.length).padStart(5)} docs` +
      ` (${count(documents)} avec les sous-collections)` +
      `${kept > 0 ? `, ${kept} conservés` : ""} -> ${backupPath}`,
  );

  if (!options.commit) return;

  let done = 0;
  for (const doc of doomed) {
    await db.recursiveDelete(doc.ref);
    done++;
    if (done % 25 === 0 || done === doomed.length) {
      console.log(`    supprimés ${done} / ${doomed.length}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);
  console.log(`cibles : ${options.targets.join(", ")}`);
  mkdirSync(options.outDir, { recursive: true });

  for (const name of options.targets) {
    for (const target of TARGETS[name]) await sweep(db, target, options);
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
