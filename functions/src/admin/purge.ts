import { initializeApp } from "firebase-admin/app";
import { getFirestore, Firestore, CollectionReference } from "firebase-admin/firestore";

/**
 * Purge des collections mortes (§10.3). Idempotente, `--dry-run` par défaut, et
 * la même garde que la migration : elle refuse tout projet dont l'id ne dit pas
 * « debug ».
 *
 *   npm run purge -- --project=pet-match---debug --targets=contests-v0
 *   npm run purge -- --project=pet-match---debug --targets=contests-v0 --commit
 *
 * Les cibles sont nommées, jamais devinées. `contests-v0` est **sélective** :
 * elle ne supprime que les documents dépourvus de `number`, c'est-à-dire ceux
 * de la génération v0. Un concours migré en porte un, donc la purge ne peut pas
 * l'emporter — même lancée par erreur après la migration.
 *
 * L'ordre compte et il est dans le §10.3 : `contests-v0` avant la migration,
 * `legacy` seulement après vérification. Supprimer `challenges` détruit la
 * source de la migration, qui n'est alors plus rejouable.
 */

interface Options {
  readonly projectId: string;
  readonly commit: boolean;
  readonly targets: readonly string[];
}

/** Les collections racine mortes, et ce qui les tue. */
const TARGETS: Record<string, readonly string[]> = {
  /** La génération v0 de `contests` : sélective, cf. plus haut. */
  "contests-v0": ["contests"],
  /** La source de la migration et les collections de la v0. */
  "legacy": ["challenges", "matches", "posts"],
  /** L'automation hors périmètre (D15). */
  "instagram": ["instagram_posts", "instagram_config"],
};

/** Ce qu'on ne supprime jamais, quoi qu'on demande. */
const PROTECTED = new Set(["users", "pets", "configuration", "counters"]);

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
      `refus de supprimer sur « ${projectId} » : la purge ne cible que les projets de debug`,
    );
  }

  const targets = (flag("targets") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (targets.length === 0) {
    throw new Error(`cibles manquantes : --targets=${Object.keys(TARGETS).join("|")}`);
  }
  for (const target of targets) {
    if (!(target in TARGETS)) {
      throw new Error(`cible inconnue « ${target} » : ${Object.keys(TARGETS).join(", ")}`);
    }
  }

  return { projectId, commit: argv.includes("--commit"), targets };
}

async function purgeSelective(
  db: Firestore,
  ref: CollectionReference,
  commit: boolean,
): Promise<number> {
  const snap = await ref.get();
  const doomed = snap.docs.filter((doc) => doc.get("number") === undefined);
  if (!commit) return doomed.length;

  const writer = db.bulkWriter();
  for (const doc of doomed) void writer.delete(doc.ref);
  await writer.close();
  return doomed.length;
}

async function purgeWhole(
  db: Firestore,
  ref: CollectionReference,
  commit: boolean,
): Promise<number> {
  const snap = await ref.count().get();
  const total = snap.data().count;
  // `recursiveDelete` emporte les sous-collections, que `challenges` porte par
  // milliers. Le compte rendu ne parle que des documents racine : compter les
  // descendants coûterait une lecture par sous-collection pour un chiffre qui
  // ne change aucune décision.
  if (commit) await db.recursiveDelete(ref);
  return total;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet    : ${options.projectId}`);
  console.log(`cibles    : ${options.targets.join(", ")}`);
  console.log("");

  let total = 0;
  for (const target of options.targets) {
    for (const name of TARGETS[target]) {
      if (PROTECTED.has(name)) throw new Error(`collection protégée : ${name}`);

      const ref = db.collection(name);
      const selective = target === "contests-v0";
      const count = selective ?
        await purgeSelective(db, ref, options.commit) :
        await purgeWhole(db, ref, options.commit);

      total += count;
      const suffix = selective ? " (sans `number`, donc v0)" : " (et leurs sous-collections)";
      console.log(`  ${name.padEnd(20)} ${String(count).padStart(5)}${suffix}`);
    }
  }

  console.log("");
  console.log(`documents racine ${options.commit ? "supprimés" : "à supprimer"} : ${total}`);
  if (!options.commit) {
    console.log("\n--dry-run : rien n'a été supprimé. Ajouter --commit pour purger.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
