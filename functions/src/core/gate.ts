/**
 * La porte de version : le plus ancien build encore accepté, par plateforme.
 *
 * Des entiers, comparés par `>=`. `versionCode` sur Android et `CFBundleVersion`
 * sur iOS sont tous deux monotones, et l'app expose déjà les deux sous la même
 * forme. Pas d'analyse de numéro sémantique — c'est là que ces fonctionnalités
 * gagnent leur première panne.
 *
 * **Tout défaut ouvre la porte.** Document absent, champ manquant, champ d'un
 * autre type, valeur négative : la réponse est « personne n'est bloqué ». Le
 * mode de défaillance est total et distant — un utilisateur bloqué à tort ne
 * peut plus rien faire, et n'a aucun moyen de nous le dire.
 */

export const PLATFORMS = ["android", "ios"] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface PlatformGate {
  /** Le plus ancien build encore accepté. 0 = personne n'est bloqué. */
  readonly minimumCode: number;
  /** Le dernier build publié sur le magasin. Plafond du minimum. */
  readonly latestCode: number;
}

export interface VersionGate {
  readonly android: PlatformGate;
  readonly ios: PlatformGate;
}

const OPEN: PlatformGate = { minimumCode: 0, latestCode: 0 };

export const OPEN_GATE: VersionGate = { android: OPEN, ios: OPEN };

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

/** Un entier positif, ou zéro. `"42"` n'est pas 42 : une chaîne n'ouvre pas de porte. */
function code(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

function platformGate(raw: unknown): PlatformGate {
  if (!raw || typeof raw !== "object") return OPEN;
  const source = raw as Record<string, unknown>;

  return { minimumCode: code(source.minimumCode), latestCode: code(source.latestCode) };
}

/** Lit le document de configuration. N'échoue jamais : au pire, tout est ouvert. */
export function readGate(raw: unknown): VersionGate {
  if (!raw || typeof raw !== "object") return OPEN_GATE;
  const source = raw as Record<string, unknown>;

  return { android: platformGate(source.android), ios: platformGate(source.ios) };
}

/**
 * Un build est trop vieux s'il est **strictement** en dessous du minimum. Le
 * minimum lui-même passe : c'est le plus ancien build encore accepté, pas le
 * premier refusé.
 */
export function updateRequired(gate: VersionGate, platform: Platform, build: number): boolean {
  return build < gate[platform].minimumCode;
}
