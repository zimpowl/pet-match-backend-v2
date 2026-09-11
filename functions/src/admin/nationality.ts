import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Donne la nationalité française aux jurés et aux animaux qui n'en ont pas. Le
 * legacy ne la demandait pas et l'app s'est jouée en France : la supposer vaut
 * mieux qu'un drapeau absent sur toutes les slabs reprises, et qui vient
 * d'ailleurs la corrigera sur sa fiche.
 *
 * La migration écrit déjà « FR » pour les nouvelles reprises (§6) ; cet outil
 * ne sert qu'aux jeux de données déjà migrés.
 *
 * Même garde que la migration et la purge : refus de tout projet dont l'id ne
 * dit pas « debug ». Et `--dry-run` par défaut.
 *
 *   npm run nationality -- --project=pet-match---debug
 *   npm run nationality -- --project=pet-match---debug --commit
 */

const FRANCE = "FR";

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

  // On ne touche qu'aux documents sans pays : une nationalité choisie par son
  // propriétaire ne se remplace pas par une supposition.
  for (const collection of ["users", "pets"] as const) {
    const snap = await db.collection(collection).where("countryCode", "==", null).select().get();

    if (options.commit) {
      const writer = db.bulkWriter();
      for (const doc of snap.docs) void writer.update(doc.ref, { countryCode: FRANCE });
      await writer.close();
    }

    console.log(`${collection} ${options.commit ? "passés" : "à passer"} en FR : ${snap.size}`);
  }

  if (!options.commit) {
    console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
