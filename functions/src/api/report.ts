import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PETS, REPORTS, USERS, db } from "../firebase";
import { ReportDoc, ReportTarget } from "../models/report";
import {
  JsonResponse,
  Query,
  badRequest,
  conflict,
  forbidden,
  notFound,
  respond,
} from "../http/respond";
import { callerUid } from "../http/identity";

/**
 * Signaler une publication (D129). La charte le promet à chaque page : sans cet
 * appel, elle promettait une porte qui n'existait pas.
 *
 * Le signalement **n'agit sur rien** : il ouvre une ligne dans une file, et
 * c'est une personne qui décide. Retirer automatiquement ferait du bouton une
 * arme — il suffirait de deux comptes pour effacer le concurrent du soir.
 */
export const submitReportHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const query = req.query as Query;
    const body = req.body as unknown;
    const reporterUid = await callerUid(query, body, req.headers.authorization);

    const target = readTarget(body);
    const targetUid = readTargetUid(body);

    await assertReportable(target, targetUid, reporterUid);

    // Re-signaler la même chose n'ajoute rien à la file : la première ligne
    // attend déjà qu'on la lise.
    const open = await db
      .collection(REPORTS)
      .where("reporterUid", "==", reporterUid)
      .where("target", "==", target)
      .where("targetUid", "==", targetUid)
      .where("status", "==", "OPEN")
      .limit(1)
      .get();
    if (!open.empty) throw conflict("vous avez déjà signalé cette publication");

    const doc: ReportDoc = {
      reporterUid,
      target,
      targetUid,
      status: "OPEN",
      createdAt: Timestamp.now(),
      reviewedAt: null,
    };
    const ref = await db.collection(REPORTS).add(doc);

    return { uid: ref.id };
  }),
);

/** On ne se signale pas soi-même, et on ne signale pas ce qui n'existe pas. */
async function assertReportable(
  target: ReportTarget,
  targetUid: string,
  reporterUid: string,
): Promise<void> {
  if (target === "JUDGE") {
    if (targetUid === reporterUid) throw forbidden("on ne se signale pas soi-même");
    const snap = await db.collection(USERS).doc(targetUid).get();
    if (!snap.exists) throw notFound(`juré ${targetUid} introuvable`);
    return;
  }

  const snap = await db.collection(PETS).doc(targetUid).get();
  if (!snap.exists) throw notFound(`animal ${targetUid} introuvable`);
  if (snap.get("userUid") === reporterUid) throw forbidden("on ne signale pas son propre animal");
}

function readTarget(body: unknown): ReportTarget {
  const raw = (body as Record<string, unknown>)?.target;
  if (raw === "PET" || raw === "JUDGE") return raw;
  throw badRequest("target doit valoir PET ou JUDGE");
}

function readTargetUid(body: unknown): string {
  const raw = (body as Record<string, unknown>)?.targetUid;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  throw badRequest("targetUid manquant");
}
