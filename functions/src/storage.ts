import { App } from "firebase-admin/app";
import { Bucket } from "@google-cloud/storage";
import { getStorage } from "firebase-admin/storage";

/** Le préfixe des pièces déposées pour la confirmation (D126). */
export const DOCUMENTS = "documents";

/** Cinq ans, la durée de conservation d'un justificatif d'identité. */
export const RETENTION_DAYS = 5 * 365;

/**
 * Le bucket par défaut n'est pas déductible du seul projet : les projets
 * récents sont nommés `.firebasestorage.app`, les anciens `.appspot.com`.
 *
 * Module sans effet de bord : les outils d'administration initialisent leur
 * propre app et ne peuvent pas importer `firebase.ts`.
 */
export async function bucketOf(app: App, projectId: string): Promise<Bucket> {
  const storage = getStorage(app);
  for (const name of [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`]) {
    const bucket = storage.bucket(name);
    const [exists] = await bucket.exists();
    if (exists) return bucket;
  }
  throw new Error(`bucket introuvable pour ${projectId}`);
}
