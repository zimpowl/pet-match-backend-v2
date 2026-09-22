import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { computeGradeLevel, gradeName, raiseGrade } from "../core/grade";
import {
  composeGrade,
  composeHidden,
  composeSuspension,
  composeVerification,
  resolveLocale,
} from "../core/notifications";
import { longDateText } from "../core/time";
import { GradeDoc } from "../models/grade";
import { PetDoc } from "../models/pet";
import { UserDoc } from "../models/user";
import { PersonalNews, announcePersonal } from "../data/notify";
import { PETS, USERS, VERIFICATIONS } from "../firebase";
import { VerificationDoc } from "../models/verification";
import { db } from "../firebase";

/**
 * Ce qui arrive au dossier d'un joueur, et dont aucun écran ne l'avertit.
 *
 * Un seul déclencheur par collection plutôt qu'un par événement : ils
 * regardent le même document, et deux fonctions concurrentes sur la même
 * écriture s'ordonnent au hasard.
 *
 * L'élévation du grade **réécrit** le document, ce qui rappelle ce
 * déclencheur : au second passage la vérification n'a plus changé, seul le
 * niveau — donc la nouvelle du niveau part, et une seule fois.
 */
export const onUserChanged = onDocumentUpdated(`${USERS}/{userUid}`, async (event) => {
  const before = event.data?.before.data() as UserDoc | undefined;
  const after = event.data?.after.data() as UserDoc | undefined;
  if (!after) return;

  const userUid = event.params.userUid;
  const news: PersonalNews[] = [];
  const locale = resolveLocale(after.locale);

  if (before?.isVerified !== true && after.isVerified === true) {
    news.push({
      userUid,
      kind: "VERIFICATION",
      notification: composeVerification({ accepted: true, reason: null, petName: null }, locale),
    });

    const grade = raiseGrade(after.grade, computeGradeLevel(after.stats, true), Timestamp.now());
    if (grade.level > (after.grade?.level ?? 0)) {
      await event.data!.after.ref.update({ grade });
    }
  }

  const raised = gradeRaised(before?.grade, after.grade);
  if (raised !== null) {
    news.push({
      userUid,
      kind: "GRADE",
      notification: composeGrade({ level: raised, name: gradeName(raised), petName: null }, locale),
    });
  }

  if (before?.suspendedUntil == null && after.suspendedUntil != null) {
    news.push({
      userUid,
      kind: "SUSPENSION",
      notification: composeSuspension({ untilText: longDateText(after.suspendedUntil) }, locale),
    });
  }

  if (before?.hiddenAt == null && after.hiddenAt != null) {
    news.push({
      userUid,
      kind: "MODERATION",
      notification: composeHidden({ petName: null }, locale),
    });
  }

  await announcePersonal(news);
});

export const onPetChanged = onDocumentUpdated(`${PETS}/{petUid}`, async (event) => {
  const before = event.data?.before.data() as PetDoc | undefined;
  const after = event.data?.after.data() as PetDoc | undefined;
  if (!after) return;

  const userUid = after.userUid;
  const petName = after.name;
  const news: PersonalNews[] = [];
  const locale = resolveLocale(null);

  if (before?.verifiedAt == null && after.verifiedAt != null) {
    news.push({
      userUid,
      kind: "VERIFICATION",
      notification: composeVerification({ accepted: true, reason: null, petName }, locale),
    });

    const grade = raiseGrade(after.grade, computeGradeLevel(after.stats, true), Timestamp.now());
    if (grade.level > (after.grade?.level ?? 0)) {
      await event.data!.after.ref.update({ grade });
    }
  }

  const raised = gradeRaised(before?.grade, after.grade);
  if (raised !== null) {
    news.push({
      userUid,
      kind: "GRADE",
      notification: composeGrade({ level: raised, name: gradeName(raised), petName }, locale),
    });
  }

  if (before?.hiddenAt == null && after.hiddenAt != null) {
    news.push({
      userUid,
      kind: "MODERATION",
      notification: composeHidden({ petName }, locale),
    });
  }

  await announcePersonal(news);
});

/**
 * Le refus, lui, ne touche ni l'utilisateur ni l'animal : il ne vit que dans la
 * demande. Sans ce déclencheur, déposer une pièce refusée n'a aucun écho.
 */
export const onVerificationReviewed = onDocumentUpdated(
  `${VERIFICATIONS}/{requestUid}`,
  async (event) => {
    const before = event.data?.before.data() as VerificationDoc | undefined;
    const after = event.data?.after.data() as VerificationDoc | undefined;
    if (!after || before?.status === "REJECTED" || after.status !== "REJECTED") return;

    const petName = after.petUid ? await petNameOf(after.petUid) : null;

    await announcePersonal([
      {
        userUid: after.userUid,
        kind: "VERIFICATION",
        notification: composeVerification(
          { accepted: false, reason: after.reason, petName },
          resolveLocale(null),
        ),
      },
    ]);
  },
);

function gradeRaised(before: GradeDoc | undefined, after: GradeDoc | undefined): number | null {
  const held = before?.level ?? 0;
  const now = after?.level ?? 0;
  return now > held ? now : null;
}

async function petNameOf(petUid: string): Promise<string | null> {
  const snap = await db.collection(PETS).doc(petUid).get();
  return (snap.data() as PetDoc | undefined)?.name ?? null;
}
