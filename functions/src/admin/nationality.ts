import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { contestOf } from "../collections";

/**
 * Donne la nationalité française aux jurés et aux animaux qui n'en ont pas. Le
 * legacy ne la demandait pas et l'app s'est jouée en France : la supposer vaut
 * mieux qu'un drapeau absent sur toutes les slabs reprises, et qui vient
 * d'ailleurs la corrigera sur sa fiche.
 *
 * Les lignes de concours suivent : elles dénormalisent le pays comme le nom,
 * et celles écrites avant que le champ existe n'en ont aucun. On y recopie
 * celui de la fiche — l'étiquette d'un concours d'il y a trois mois n'a pas de
 * pays reconstituable, celui d'aujourd'hui est la meilleure approximation.
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

  await stampContestRows(db, options);

  if (!options.commit) {
    console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
  }
}

/**
 * Un champ absent ne répond pas à `where("countryCode", "==", null)` : seul un
 * null explicite le fait. Les lignes écrites avant le champ se trient donc à la
 * lecture, pas à la requête.
 */
async function stampContestRows(
  db: FirebaseFirestore.Firestore,
  options: Options,
): Promise<void> {
  const sources: ReadonlyArray<{ group: string; owner: string; key: string }> = [
    { group: "participants", owner: "pets", key: "petId" },
    { group: "judges", owner: "users", key: "userUid" },
  ];

  for (const source of sources) {
    const snap = await db.collectionGroup(source.group).get();
    const stale = snap.docs.filter(
      (doc) => contestOf(doc.ref) !== null && doc.get("countryCode") == null,
    );

    if (options.commit) {
      const writer = db.bulkWriter();
      for (const doc of stale) {
        const ownerId = doc.get(source.key) as string | undefined;
        const owner = ownerId ?
          await db.collection(source.owner).doc(ownerId).get() :
          null;
        const countryCode = (owner?.get("countryCode") as string | null) ?? FRANCE;
        void writer.update(doc.ref, { countryCode });
      }
      await writer.close();
    }

    const verb = options.commit ? "datées" : "à dater";
    console.log(`lignes ${source.group} ${verb} : ${stale.length} / ${snap.size}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
