import { firestore } from "firebase-admin";

/**
 * Le grade tenu, et quand chaque cran a été atteint.
 *
 * `reachedAt` est clé par niveau (« 1 », « 2 », …) et ne se réécrit jamais :
 * un cran obtenu garde sa date, même si les statistiques bougent ensuite. Les
 * profils repris du legacy sortent à 0 et sans date — leur histoire n'a jamais
 * été enregistrée, et l'inventer serait mentir sur un dossier.
 */
export interface GradeDoc {
  level: number;
  reachedAt?: Record<string, firestore.Timestamp>;
}
