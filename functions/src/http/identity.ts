import { getAuth } from "firebase-admin/auth";
import { badRequest, forbidden } from "./respond";

/**
 * Qui appelle. Le jeton Firebase fait foi — il est signé, l'app ne peut pas le
 * fabriquer, et il porte l'uid : tant qu'on lisait `userUid` dans la query,
 * n'importe qui pouvait écrire dans n'importe quel profil.
 *
 * Il reste une porte, et une seule : **sur un projet de debug**, un appel sans
 * jeton retombe sur l'uid de la query. C'est ce qui fait vivre le faux compte
 * du `FakeAuthentificationImpl`, qui n'a pas de session Firebase à présenter.
 * En prod, pas de jeton, pas d'appel.
 */
export async function callerUid(
  query: Record<string, unknown>,
  body: unknown,
  header?: string,
): Promise<string> {
  const token = bearer(header);
  if (token) {
    try {
      // `checkRevoked` n'est pas demandé : en production, le jeton d'un compte
      // supprimé ou suspendu reste donc valable jusqu'à son expiration, soit
      // jusqu'à une heure. L'émulateur, lui, le refuse — on ne peut pas trancher
      // ici. À décider délibérément, en pesant l'aller-retour supplémentaire
      // vers Auth à chaque appel authentifié ; `deleteAccountHttp` est le cas
      // où ça compte le plus.
      return (await getAuth().verifyIdToken(token)).uid;
    } catch {
      throw forbidden("jeton d'authentification invalide");
    }
  }

  if (!isDebugProject()) throw forbidden("jeton d'authentification manquant");

  return declared(query, body);
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

function isDebugProject(): boolean {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST) || /debug/i.test(project);
}

/** L'uid tel que l'appelant le déclare — cru sur parole, donc debug seulement. */
function declared(query: Record<string, unknown>, body: unknown): string {
  if (typeof query.userUid === "string" && query.userUid.trim()) {
    return query.userUid.trim();
  }

  if (body && typeof body === "object" && "userUid" in body) {
    const bodyUid = (body as Record<string, unknown>).userUid;
    if (typeof bodyUid === "string" && bodyUid.trim()) return bodyUid.trim();
  }

  throw badRequest("userUid manquant");
}
