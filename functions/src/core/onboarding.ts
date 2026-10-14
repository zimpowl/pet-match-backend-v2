/**
 * La présentation du premier lancement, telle qu'elle vit dans
 * `configuration/onboarding` : une liste de pages, posée à la main — un titre,
 * un texte, une photo. L'app la construit telle quelle.
 *
 * Sans effet de bord : la route et l'outil d'admin la partagent.
 */
export const ONBOARDING = "onboarding";

export interface OnboardingPage {
  readonly title: string;
  readonly body: string;
  /** Une URL, ou rien : l'app montre alors le fond de la page. */
  readonly photo: string | null;
}

export interface Onboarding {
  readonly pages: readonly OnboardingPage[];
}

export const NO_ONBOARDING: Onboarding = { pages: [] };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Ce qu'on garde du document : les pages qui ont un titre et un texte. Un
 * document absent ou malformé donne une liste vide — l'app retombe alors sur
 * sa présentation intégrée.
 */
export function readOnboarding(raw: unknown): Onboarding {
  if (typeof raw !== "object" || raw === null) return NO_ONBOARDING;
  const pages = (raw as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return NO_ONBOARDING;

  return {
    pages: pages.flatMap((page): OnboardingPage[] => {
      if (typeof page !== "object" || page === null) return [];
      const { title, body, photo } = page as Record<string, unknown>;
      const t = text(title);
      const b = text(body);
      return t && b ? [{ title: t, body: b, photo: text(photo) }] : [];
    }),
  };
}
