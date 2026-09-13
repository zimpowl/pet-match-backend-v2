import { UserDoc } from "../models/user";
import { USERS, db } from "../firebase";
import { forbidden } from "../http/respond";

/**
 * Un compte suspendu (D133) garde tout : son étagère, ses concours, ses
 * médailles. Ce qu'il perd, c'est **le droit d'agir** — voter, s'inscrire,
 * publier, signaler. La suspension a une fin : c'est ce qui la distingue d'un
 * compte fermé, qui lui ne revient pas.
 *
 * On ne l'efface pas à l'expiration : la date suffit à dire si elle court, et
 * la garder dit qu'il y a eu une sanction.
 */
export function isSuspended(
  user: Pick<UserDoc, "suspendedUntil"> | undefined,
  now: number = Date.now(),
): boolean {
  const until = user?.suspendedUntil?.toMillis();
  return until !== undefined && until > now;
}

export function assertNotSuspended(
  user: Pick<UserDoc, "suspendedUntil"> | undefined,
  now: number = Date.now(),
): void {
  if (!isSuspended(user, now)) return;

  throw forbidden("votre compte est suspendu : vous ne pouvez pas agir pour le moment");
}

/** Le garde des écritures : une lecture, et la porte reste fermée tant qu'elle court. */
export async function assertActive(userUid: string): Promise<void> {
  const snap = await db.collection(USERS).doc(userUid).get();
  assertNotSuspended(snap.data() as UserDoc | undefined);
}
