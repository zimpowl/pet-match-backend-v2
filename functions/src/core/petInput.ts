import { Species } from "../models/contest";
import { isValidMicrochipId, normalizeMicrochipId } from "./microchip";

/**
 * Lecture et validation du `PetRequest` de l'app. Pure : elle ne touche pas
 * Firestore, et elle refuse tout ce que l'appelant n'a pas le droit de poser —
 * `number`, `stats` et `verifiedAt` sont des champs serveur.
 */
export type PetRejection =
  | "NAME_REQUIRED"
  | "SPECIES_INVALID"
  | "SEX_INVALID"
  | "COUNTRY_REQUIRED"
  /** D68 : ISO 11784/11785, quinze chiffres. */
  | "MICROCHIP_INVALID";

export interface PetInput {
  readonly name: string;
  readonly species: Species;
  readonly sex: "MALE" | "FEMALE";
  readonly breed: string | null;
  readonly birthDate: number | null;
  readonly countryCode: string;
  readonly photoUrl: string | null;
  readonly microchipId: string | null;
}

export type PetInputResult =
  | { readonly ok: true; readonly input: PetInput }
  | { readonly ok: false; readonly rejection: PetRejection };

export function readPetInput(raw: unknown): PetInputResult {
  const source = (raw ?? {}) as Record<string, unknown>;

  const name = text(source.name);
  if (!name) return reject("NAME_REQUIRED");

  const species = source.species;
  if (species !== "DOG" && species !== "CAT") return reject("SPECIES_INVALID");

  const sex = source.sex;
  if (sex !== "MALE" && sex !== "FEMALE") return reject("SEX_INVALID");

  const countryCode = text(source.countryCode);
  if (!countryCode) return reject("COUNTRY_REQUIRED");

  const microchipId = normalizeMicrochipId(text(source.microchipId));
  if (microchipId !== null && !isValidMicrochipId(microchipId)) {
    return reject("MICROCHIP_INVALID");
  }

  return {
    ok: true,
    input: {
      name,
      species,
      sex,
      breed: text(source.breed),
      birthDate: typeof source.birthDate === "number" ? source.birthDate : null,
      countryCode,
      photoUrl: text(source.photoUrl),
      microchipId,
    },
  };
}

function reject(rejection: PetRejection): PetInputResult {
  return { ok: false, rejection };
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
