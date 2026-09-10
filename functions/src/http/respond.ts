/** Ce qu'on utilise de la réponse Express, et rien de plus. */
export interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

export type Query = Record<string, unknown>;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}

/** L'état du monde interdit l'action : plafond atteint, paire déjà jugée, etc. */
export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export function requiredField(body: unknown, name: string): string {
  const source = (body ?? {}) as Record<string, unknown>;
  const value = source[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${name} manquant`);
  }
  return value.trim();
}

/** Le pendant tolérant de `requiredField` : absent, vide ou non-chaîne → null. */
export function optionalField(body: unknown, name: string): string | null {
  const source = (body ?? {}) as Record<string, unknown>;
  const value = source[name];
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim();
}

export function param(query: Query, name: string): string | undefined {
  const raw = query[name];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

export function requiredParam(query: Query, name: string): string {
  const value = param(query, name);
  if (!value) throw badRequest(`${name} manquant`);
  return value;
}

/** Un seul endroit qui traduit une exception en statut HTTP. */
export async function respond(
  res: JsonResponse,
  produce: () => Promise<unknown>,
): Promise<void> {
  try {
    res.status(200).json(await produce());
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "erreur interne" });
  }
}
