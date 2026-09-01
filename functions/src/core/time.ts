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
