import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CONFIGURATION, CONTESTS, PARTICIPANTS } from "../collections";
import { ONBOARDING, readOnboarding } from "../core/onboarding";

/**
 * Lire et poser la présentation du premier lancement.
 *
 *   npm run onboarding -- --project=pet-match---debug              (lit)
 *   npm run onboarding -- --project=pet-match---debug --seed --commit
 *
 * `--seed` pose les trois pages d'aujourd'hui, chacune avec la photo d'un
 * premier tirée au hasard parmi les concours clos. Le document se réécrit
 * ensuite à la main dans la console — titres, textes, photos, nombre de
 * pages : c'est fait pour.
 *
 * Il n'écrit qu'un seul chemin : `configuration/onboarding`.
 */

/** Les textes de l'app au jour du premier tirage : un point de départ. */
const SEED = [
  {
    title: "Un thème, une photo",
    body: "Mettez à l'honneur votre animal avec sa plus belle photo et participez au concours.",
  },
  {
    title: "Arbitrez les duels",
    body: "Soutenez votre favori et bousculez le classement à chaque vote.",
  },
  {
    title: "Collectionnez les trophées",
    body: "Étoffez son palmarès. De Novice à Légende, bâtissez la carrière de votre compagnon.",
  },
] as const;

interface Options {
  readonly projectId: string;
  readonly seed: boolean;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId = flag("project");
  if (!projectId) throw new Error("projet manquant : passer --project=<id>");

  return { projectId, seed: argv.includes("--seed"), commit: argv.includes("--commit") };
}

/** Les photos des premiers de chaque concours clos, mélangées. */
async function winners(db: FirebaseFirestore.Firestore): Promise<string[]> {
  const contests = await db.collection(CONTESTS).where("status", "==", "CLOSED").get();
  const photos: string[] = [];

  for (const contest of contests.docs) {
    const first = await contest.ref.collection(PARTICIPANTS).where("rank", "==", 1).limit(1).get();
    const url = first.docs[0]?.get("photoUrl");
    if (typeof url === "string" && url.length > 0) photos.push(url);
  }

  for (let i = photos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [photos[i], photos[j]] = [photos[j], photos[i]];
  }
  return photos;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));
  const ref = db.collection(CONFIGURATION).doc(ONBOARDING);

  console.log(`projet : ${options.projectId}`);
  console.log("actuel :", readOnboarding((await ref.get()).data()).pages);

  if (!options.seed) return;

  const photos = await winners(db);
  const pages = SEED.map((page, index) => ({ ...page, photo: photos[index] ?? null }));
  console.log("tirage :", pages);

  if (!options.commit) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour appliquer.");
    return;
  }
  await ref.set({ pages });
  console.log(`écrit : ${CONFIGURATION}/${ONBOARDING}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
