import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { USERS, db } from "../firebase";
import { UserDoc } from "../models/user";
import { JsonResponse, Query, respond } from "../http/respond";
import { callerUid } from "../http/identity";
import { isSuspended } from "../core/suspension";

/**
 * Le premier appel après l'authentification Firebase : il crée le joueur s'il
 * n'existe pas et renvoie de quoi ouvrir l'app. C'est le seul endpoint que la
 * v2 n'avait pas — le §5 ne liste que les concours, les animaux et le profil,
 * mais sans celui-ci rien ne démarre.
 *
 * Il ne renvoie que ce dont la session a besoin : l'identifiant, l'avatar, et
 * le jeton de notification déjà connu — que l'app compare au sien pour éviter
 * un `registerDevice` inutile. Les monnaies du legacy (`coins`, `diamonds`,
 * `notifCount`) ont disparu du produit (§6) et ne sont donc pas renvoyées.
 */
export const getOrCreateHttp = onRequest({ cors: true }, (req, res) =>
  respond(res as unknown as JsonResponse, async () => {
    const userUid = await callerUid(
      req.query as Query,
      req.body as unknown,
      req.headers.authorization,
    );
    const ref = db.collection(USERS).doc(userUid);
    const snap = await ref.get();

    if (snap.exists) {
      const user = snap.data() as UserDoc;
      return {
        uid: userUid,
        avatarUrl: user.avatarUrl ?? null,
        fcmToken: user.fcmToken ?? null,
        needsRules: !user.rulesSignedAt,
        rulesSignedAt: user.rulesSignedAt?.toMillis() ?? null,
        suspendedUntil: isSuspended(user) ? user.suspendedUntil?.toMillis() ?? null : null,
        needsProfile: needsProfile(user),
        notifications: {
          results: user.notifications?.results ?? true,
          reminders: user.notifications?.reminders ?? true,
          email: user.notifications?.email ?? true,
        },
      };
    }

    // Un joueur sans animal a un profil de juré parfaitement normal (§4.8) :
    // on ne lui demande rien de plus que d'exister. Le nom et l'avatar
    // arriveront de l'écran d'accueil du profil.
    const bornAt = Timestamp.now();
    const created: UserDoc = {
      name: "",
      nickname: null,
      deletedAt: null,
      avatarUrl: null,
      description: null,
      countryCode: null,
      createdAt: bornAt,
      fcmToken: null,
      isVerified: false,
      locale: null,
      grade: { level: 0, reachedAt: { "0": bornAt } },
      notifications: { results: true, reminders: true, email: true },
      rulesSignedAt: null,
      suspendedUntil: null,
      hiddenAt: null,
      judgeNumber: null,
      judgeSince: null,
      stats: { contests: 0, bestRank: null, gold: 0, silver: 0, bronze: 0 },
      totals: { votes: 0, correctVotes: 0 },
    };
    await ref.set(created);

    return {
      uid: userUid,
      avatarUrl: null,
      fcmToken: null,
      needsRules: true,
      rulesSignedAt: null,
      suspendedUntil: null,
      hiddenAt: null,
      needsProfile: true,
      notifications: { results: true, reminders: true, email: true },
    };
  }),
);

/**
 * Le profil n'est pas prêt à jouer. Deux manques, une seule porte : sans pseudo
 * le classement s'écrit en « Anonyme », et sans avatar la slab n'a pas de
 * visage. La règle vit ici et nulle part ailleurs — l'app la lit, elle ne la
 * recalcule pas.
 */
function needsProfile(user: UserDoc): boolean {
  return !user.nickname?.trim() || !user.avatarUrl;
}
