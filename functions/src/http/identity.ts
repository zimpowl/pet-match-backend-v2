import { badRequest } from "./respond";

/**
 * Résout l'identité de l'appelant à partir de la query ou du body.
 *
 * Point central d'extraction de userUid — permet de passer à un jeton
 * Firebase Auth (L7) en ne modifiant qu'un fichier.
 *
 * @param query Paramètres de query de la requête HTTP
 * @param body Corps parsé de la requête POST (any ou Record)
 * @returns userUid de l'appelant
 * @throws HttpError 400 si userUid est absent ou vide
 */
export function callerUid(
  query: Record<string, unknown>,
  body: unknown,
): string {
  // Cherche d'abord dans la query
  if (query.userUid && typeof query.userUid === "string" && query.userUid.trim()) {
    return query.userUid.trim();
  }

  // Puis dans le body
  if (body && typeof body === "object" && "userUid" in body) {
    const bodyUid = (body as Record<string, unknown>).userUid;
    if (typeof bodyUid === "string" && bodyUid.trim()) {
      return bodyUid.trim();
    }
  }

  throw badRequest("userUid manquant");
}
