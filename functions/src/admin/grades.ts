import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { StatsDoc } from "../models/user";
import { computeGradeLevel, raiseGradeLevel } from "../core/grade";

/**
 * Relève les grades déjà acquis sur la nouvelle échelle (D123). Les seuils de
 * médailles ont baissé — 1/3/6/10/15 au lieu de 3/8/15/30/60 — et le cycle du
 * soir ne recalcule qu'à la clôture : sans ce passage, un palmarès qui vaut
 * désormais AGUERRI attendrait dimanche pour le dire.
 *
 * On **relève**, on ne recalcule pas (D30) : le durcissement du cran 1, qui
 * demande maintenant quatre concours, ne redescend personne.
 *
 * Même garde que la migration : refus de tout projet dont l'id ne dit pas
 * « debug », et `--dry-run` par défaut.
 *
 *   npm run grades -- --project=pet-match---debug
 *   npm run grades -- --project=pet-match---debug --commit
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

async function raise(
  db: FirebaseFirestore.Firestore,
  collection: string,
  verifiedField: string,
  commit: boolean,
): Promise<number> {
  const snap = await db.collection(collection).get();
  const writer = commit ? db.bulkWriter() : null;
  let raised = 0;

  for (const doc of snap.docs) {
    const held = (doc.get("grade") as { level?: number } | undefined)?.level ?? 0;
    const verified =
      verifiedField === "isVerified" ?
        doc.get(verifiedField) === true :
        doc.get(verifiedField) != null;
    const level = raiseGradeLevel(held, computeGradeLevel(doc.get("stats") as StatsDoc, verified));
    if (level === held) continue;

    raised++;
    console.log(`${collection}/${doc.id} : ${held} → ${level}`);
    void writer?.update(doc.ref, { grade: { level } });
  }

  await writer?.close();
  return raised;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  console.log(`projet : ${options.projectId}`);

  const users = await raise(db, "users", "isVerified", options.commit);
  const pets = await raise(db, "pets", "verifiedAt", options.commit);

  console.log(`\njurés relevés : ${users}, animaux relevés : ${pets}`);
  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
