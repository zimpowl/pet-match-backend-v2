/** Ce que `firestore.Timestamp` fournit, réduit à ce qu'on lui demande. */
export interface Millis {
  toMillis(): number;
}

export function toMillis(value: Millis | null | undefined): number | null {
  return value ? value.toMillis() : null;
}

export function toMillisOrZero(value: Millis | null | undefined): number {
  return toMillis(value) ?? 0;
}

/**
 * Toute l'app est calée sur **une seule heure** : 18 h, heure de Paris. Le
 * reset quotidien, la clôture du dimanche et le départ du suivant tombent
 * ensemble, et c'est le serveur qui le dit — un joueur en Indonésie lit la même
 * bascule qu'un joueur à Lille.
 *
 * Les dix-huit concours repris du legacy démarraient à des heures diverses, et
 * comme chaque concours hérite du `endAt` du précédent, la dérive se
 * propageait indéfiniment. `atContestHour` la coupe à la source.
 */
export const CONTEST_ZONE = "Europe/Paris";
export const CONTEST_HOUR = 18;

const HOUR_MILLIS = 60 * 60 * 1000;
const DAY = 24 * HOUR_MILLIS;

/** Décalage de Paris sur UTC à cet instant précis — l'été et l'hiver diffèrent. */
function zoneOffset(millis: number): number {
  const naive = new Date(millis).toLocaleString("sv-SE", { timeZone: CONTEST_ZONE });
  return Date.parse(`${naive.replace(" ", "T")}Z`) - millis;
}

/**
 * L'instant où la journée bascule, le jour civil parisien de `millis`. On
 * reprend le décalage **à l'instant visé** et non à celui de départ : sans ce
 * second passage, le dimanche du changement d'heure tomberait une heure à côté.
 */
export function atContestHour(millis: number): number {
  const shift = zoneOffset(millis);
  const parisMidnight = Math.floor((millis + shift) / DAY) * DAY;
  const naive = parisMidnight + CONTEST_HOUR * HOUR_MILLIS;

  return naive - zoneOffset(naive - shift);
}

/** Une date en toutes lettres, dans le fuseau du jeu : « 4 octobre 2026 ». */
export function longDateText(value: Millis | null | undefined): string {
  const millis = toMillis(value);
  if (millis === null) return "";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: CONTEST_ZONE,
  }).format(new Date(millis));
}
