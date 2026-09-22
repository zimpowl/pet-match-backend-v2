import { getAuth } from "firebase-admin/auth";
import { Notification } from "../core/notifications";
import { db } from "../firebase";

/**
 * L'envoi de courrier passe par une **file** : on écrit un document, un
 * expéditeur le prend et l'envoie. C'est le contrat de l'extension Firebase
 * « Trigger Email from Firestore », branchée sur cette collection.
 *
 * Deux raisons de ne pas envoyer nous-mêmes : aucun identifiant SMTP n'a sa
 * place dans le dépôt, et un envoi synchrone ferait dépendre l'écriture d'un
 * classement de la disponibilité d'un serveur de courrier. La file découple :
 * si l'expéditeur est absent, les messages attendent au lieu d'être perdus.
 *
 * Tant que l'extension n'est pas installée, ces documents s'empilent sans
 * partir — et rien d'autre ne casse.
 */
export const MAIL = "mail";

/** L'adresse vit dans Firebase Auth, jamais recopiée : une copie se périme. */
export async function addressOf(userUid: string): Promise<string | null> {
  try {
    return (await getAuth().getUser(userUid)).email ?? null;
  } catch {
    return null;
  }
}

export interface Letter {
  readonly userUid: string;
  readonly to: string;
  readonly notification: Notification;
}

/**
 * Le corps reprend mot pour mot celui de la notification. Une seule copie pour
 * les deux canaux : deux textes finiraient par se contredire, et celui de la
 * notification est déjà écrit au mot près.
 */
export async function post(letters: readonly Letter[]): Promise<number> {
  if (letters.length === 0) return 0;

  const batch = db.batch();
  for (const letter of letters) {
    batch.set(db.collection(MAIL).doc(), {
      to: [letter.to],
      message: {
        subject: letter.notification.title,
        text: letter.notification.body,
      },
    });
  }
  await batch.commit();

  return letters.length;
}
