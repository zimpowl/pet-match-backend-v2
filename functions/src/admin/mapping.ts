import { ContestStatus, Species } from "../models/contest";
import { StatsDoc } from "../models/user";
import { pairKey } from "../core/elo";
import { LegacyParticipant, LegacyPet } from "./legacy";

/**
 * Les transformations de la migration, isolées et pures : aucune ne touche
 * Firestore, toutes sont testées. `migrate.ts` ne fait que lire, appeler
 * ces fonctions, et écrire.
 */

/** `REWARDED` n'existe plus : c'était un concours clos et payé (§6). */
export function mapStatus(legacy: string | undefined): ContestStatus | null {
  switch (legacy) {
  case "DRAFT":
    return "DRAFT";
  case "ACTIVE":
    return "ACTIVE";
  case "CLOSED":
  case "REWARDED":
    return "CLOSED";
  default:
    return null;
  }
}

export function mapSpecies(legacy: string | undefined): Species | null {
  return legacy === "DOG" || legacy === "CAT" ? legacy : null;
}

export function mapSex(legacy: string | undefined): "MALE" | "FEMALE" | null {
  return legacy === "MALE" || legacy === "FEMALE" ? legacy : null;
}

/**
 * `birthDate` est soit absent, soit `null`, soit une date ISO « 2019-11-21 ».
 * Tout le reste renvoie null plutôt qu'une date inventée.
 */
export function parseBirthDate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const maybe = value as { toMillis?: unknown };
  if (typeof value === "object" && typeof maybe.toMillis === "function") {
    return (value as { toMillis(): number }).toMillis();
  }
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const millis = Date.parse(`${value.trim()}T00:00:00.000Z`);
  return Number.isFinite(millis) ? millis : null;
}

/** Comparaison de noms d'animaux tolérante à la casse et aux espaces. */
export function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface OwnedPet {
  readonly petId: string;
  readonly name: string | undefined;
}

export type PetResolution =
  /** Le participant portait déjà son `petUid`. */
  | { readonly kind: "DECLARED"; readonly petId: string }
  /** Retrouvé chez le propriétaire par le nom dénormalisé. */
  | { readonly kind: "MATCHED"; readonly petId: string }
  /** Aucun animal ne correspond : il faut le créer depuis les champs du participant. */
  | { readonly kind: "CREATE" };

/**
 * La re-clé du §6. Les participants sont clés par `userUid` et `petUid` est
 * absent partout dans les données réelles : on retrouve l'animal par son nom
 * chez son propriétaire, et on le crée en dernier recours.
 */
export function resolvePet(
  participant: LegacyParticipant,
  ownedPets: readonly OwnedPet[],
): PetResolution {
  if (participant.petUid) return { kind: "DECLARED", petId: participant.petUid };

  const wanted = normalizeName(participant.petName);
  if (wanted.length > 0) {
    const match = ownedPets.find((pet) => normalizeName(pet.name) === wanted);
    if (match) return { kind: "MATCHED", petId: match.petId };
  }

  return { kind: "CREATE" };
}

/**
 * Une clé de paire legacy est faite de deux `userUid` ; après re-clé elle doit
 * être faite de deux `petId`. Renvoie null quand un des deux côtés est
 * inconnu — l'appelant le compte comme anomalie au lieu d'écrire une clé morte.
 */
export function remapPairKey(
  legacyKey: string,
  petIdByUserUid: ReadonlyMap<string, string>,
): string | null {
  const parts = legacyKey.split("_");
  if (parts.length !== 2) return null;

  const left = petIdByUserUid.get(parts[0] ?? "");
  const right = petIdByUserUid.get(parts[1] ?? "");
  return left && right ? pairKey(left, right) : null;
}

/**
 * Les agrégats du §6, recalculés depuis l'historique des participations. Une
 * médaille est un podium (D55) ; le rang null est un concours non classé.
 */
export function statsFromRanks(ranks: readonly (number | null)[]): StatsDoc {
  const ranked = ranks.filter((rank): rank is number => rank !== null && rank > 0);

  return {
    contests: ranks.length,
    bestRank: ranked.length > 0 ? Math.min(...ranked) : null,
    gold: ranked.filter((rank) => rank === 1).length,
    silver: ranked.filter((rank) => rank === 2).length,
    bronze: ranked.filter((rank) => rank === 3).length,
  };
}

/**
 * Les séquences du D83 : un numéro par élément, attribué dans l'ordre
 * d'ancienneté pour que la numérotation raconte la même histoire que les dates.
 * Jamais réutilisé, donc jamais recalculé à partir d'autre chose que cet ordre.
 */
export function assignNumbers<T extends { readonly id: string; readonly createdAtMillis: number }>(
  items: readonly T[],
): Map<string, number> {
  const ordered = [...items].sort(
    (a, b) => a.createdAtMillis - b.createdAtMillis || a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((item, index) => [item.id, index + 1]));
}

/** Le rang du premier tour, dans l'ordre d'inscription (D87). */
export function assignRegistrationIndexes(
  items: readonly { readonly id: string; readonly createdAtMillis: number }[],
): Map<string, number> {
  return assignNumbers(items);
}

export function petCreationFields(participant: LegacyParticipant): {
  name: string;
  photoUrl: string | null;
  breed: string | null;
} {
  return {
    name: participant.petName?.trim() || "Sans nom",
    photoUrl: participant.imageUrl?.trim() || null,
    breed: participant.petBreed?.trim() || null,
  };
}

export function legacyPetName(pet: LegacyPet): string | undefined {
  return pet.name;
}
