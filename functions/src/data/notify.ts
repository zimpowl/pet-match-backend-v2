import { getMessaging } from "firebase-admin/messaging";
import { USERS, db } from "../firebase";
import { UserDoc } from "../models/user";
import { Notification } from "../core/notifications";

/**
 * L'envoi des notifications. Hors de la boucle du batch (§7) : le cycle écrit
 * d'abord, notifie ensuite, et un échec d'envoi ne défait jamais un classement.
 */

const CHUNK = 500;

export interface Recipient {
  readonly userUid: string;
  readonly fcmToken: string | null;
  readonly locale: string | null;
  readonly results: boolean;
  readonly reminders: boolean;
}

export async function loadRecipients(
  userUids: readonly string[],
): Promise<Map<string, Recipient>> {
  const result = new Map<string, Recipient>();
  if (userUids.length === 0) return result;

  const unique = [...new Set(userUids)];
  const snaps = await db.getAll(...unique.map((uid) => db.collection(USERS).doc(uid)));
  for (const snap of snaps) {
    const user = snap.data() as UserDoc | undefined;
    result.set(snap.id, {
      userUid: snap.id,
      fcmToken: user?.fcmToken ?? null,
      locale: user?.locale ?? null,
      results: user?.notifications?.results ?? true,
      reminders: user?.notifications?.reminders ?? true,
    });
  }
  return result;
}

export interface Delivery {
  readonly recipient: Recipient;
  readonly notification: Notification;
  readonly data: Record<string, string>;
}

export interface DeliveryReport {
  sent: number;
  failed: number;
  withoutToken: number;
  tokensCleared: number;
}

/**
 * Ce que le joueur a demandé à recevoir. Un refus n'est pas un échec : il ne
 * compte ni dans `failed` ni dans `withoutToken`, il ne part simplement pas.
 */
function wanted(delivery: Delivery): boolean {
  return delivery.data.kind === "REMINDER" ?
    delivery.recipient.reminders :
    delivery.recipient.results;
}

/**
 * Un jeton refusé par FCM ne le sera jamais plus : on l'efface au passage,
 * sinon on repaye l'échec à chaque cycle et pour toujours.
 */
export async function deliver(deliveries: readonly Delivery[]): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, withoutToken: 0, tokensCleared: 0 };
  const sendable = deliveries.filter((delivery) => {
    if (!wanted(delivery)) return false;
    if (delivery.recipient.fcmToken) return true;
    report.withoutToken++;
    return false;
  });
  if (sendable.length === 0) return report;

  const stale: string[] = [];

  for (let i = 0; i < sendable.length; i += CHUNK) {
    const slice = sendable.slice(i, i + CHUNK);
    const responses = await getMessaging().sendEach(
      slice.map((delivery) => ({
        token: delivery.recipient.fcmToken as string,
        notification: {
          title: delivery.notification.title,
          body: delivery.notification.body,
        },
        data: delivery.data,
        android: {
          priority: "high" as const,
          notification: {
            sound: "default",
            // Deux canaux : le joueur doit pouvoir couper le rappel de
            // l'après-midi sans perdre le résultat de 18 h.
            channelId: delivery.data.kind === "REMINDER" ?
              "petmatch_reminders" :
              "petmatch_results",
          },
        },
        apns: { payload: { aps: { sound: "default" } } },
      })),
    );

    responses.responses.forEach((response, index) => {
      if (response.success) {
        report.sent++;
        return;
      }
      report.failed++;
      const code = response.error?.code ?? "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        const userUid = slice[index]?.recipient.userUid;
        if (userUid) stale.push(userUid);
      }
    });
  }

  for (let i = 0; i < stale.length; i += CHUNK) {
    const batch = db.batch();
    for (const userUid of stale.slice(i, i + CHUNK)) {
      batch.set(db.collection(USERS).doc(userUid), { fcmToken: null }, { merge: true });
    }
    await batch.commit();
    report.tokensCleared += Math.min(CHUNK, stale.length - i);
  }

  return report;
}
