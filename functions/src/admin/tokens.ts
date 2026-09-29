import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Efface les jetons FCM (§10.4). À lancer **après chaque republication de la
 * prod sur debug** : les jetons qui arrivent alors sont ceux des appareils de
 * prod, et un `dailyCycle` ou un `dailyReminder` de debug les servirait pour de
 * vrai. Des vrais téléphones recevraient les notifications d'un bac à sable.
 *
 * Même garde que le nettoyage : refus de tout projet dont l'id ne
 * dit pas « debug ». Et `--dry-run` par défaut.
 *
 *   npm run tokens -- --project=pet-match---debug
 *   npm run tokens -- --project=pet-match---debug --commit
 *
 * Ce n'est pas une perte : un appareil de debug repose son jeton au prochain
 * lancement, par `registerDeviceHttp`. Le job de 18 h fait d'ailleurs le même
 * ménage tout seul, mais un jeton à la fois — seulement ceux que FCM refuse, et
 * seulement quand il essaie de les servir. C'est trop tard.
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

  // `!=` exclut les documents dépourvus du champ, ce qui est exactement la
  // bonne lecture : un utilisateur sans jeton n'a rien à effacer, et il ne
  // coûte donc rien.
  // Le nom est en clair, comme dans le nettoyage : importer la
  // constante tirerait `../firebase`, dont le `initializeApp()` de haut niveau
  // se battrait avec celui d'ici — et c'est celui d'ici qui porte `--project`.
  const snap = await db.collection("users").where("fcmToken", "!=", null).select().get();

  if (options.commit) {
    const writer = db.bulkWriter();
    for (const doc of snap.docs) void writer.update(doc.ref, { fcmToken: null });
    await writer.close();
  }

  console.log(`jetons ${options.commit ? "effacés" : "à effacer"} : ${snap.size}`);
  if (!options.commit) {
    console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit pour effacer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
