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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ref = db.collection(USERS).doc(userUid);
    const snap = await ref.get();

    if (snap.exists) {
      const user = snap.data() as UserDoc;

      // Un compte créé avant que l'app ne transmette l'identité du fournisseur
      // n'a ni nom ni photo : on **comble ce qui manque**, jamais ce qui est
      // déjà là. Sans ça, la reprise ne profiterait qu'aux comptes neufs, et
      // tous ceux qui existent déjà garderaient un formulaire vide.
      const patch: Partial<UserDoc> = {};
      if (!user.name) {
        const name = fromProvider(body.name);
        if (name) patch.name = name;
      }
      if (!user.avatarUrl) {
        const avatarUrl = fromProvider(body.avatarUrl);
        if (avatarUrl) patch.avatarUrl = avatarUrl;
      }
      if (Object.keys(patch).length > 0) {
        await ref.update(patch);
        Object.assign(user, patch);
      }

      return {
        uid: userUid,
        avatarUrl: user.avatarUrl ?? null,
        fcmToken: user.fcmToken ?? null,
        suspendedUntil: isSuspended(user) ? user.suspendedUntil?.toMillis() ?? null : null,
        needsProfile: needsProfile(user),
        judgeNumber: user.judgeNumber ?? null,
        notifications: {
          results: user.notifications?.results ?? true,
          reminders: user.notifications?.reminders ?? true,
        },
      };
    }

    // Un joueur sans animal a un profil de juré parfaitement normal (§4.8) :
    // on ne lui demande rien de plus que d'exister.
    //
    // Le nom et la photo du fournisseur sont posés **ici et une seule fois**,
    // pour que le formulaire de juré arrive pré-rempli : redemander ce que
    // Google ou Apple viennent d'accorder se vit comme une formalité de plus.
    // Ils vont dans `name` et `avatarUrl`, jamais dans `nickname` — le pseudo
    // reste un choix, et c'est lui que `needsProfile` attend.
    const bornAt = Timestamp.now();
    const created: UserDoc = {
      name: fromProvider(body.name) ?? "",
      nickname: null,
      deletedAt: null,
      avatarUrl: fromProvider(body.avatarUrl),
      description: null,
      countryCode: null,
      createdAt: bornAt,
      fcmToken: null,
      isVerified: false,
      locale: null,
      grade: { level: 0, reachedAt: { "0": bornAt } },
      notifications: { results: true, reminders: true },
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
      avatarUrl: created.avatarUrl,
      fcmToken: null,
      suspendedUntil: null,
      hiddenAt: null,
      needsProfile: needsProfile(created),
      judgeNumber: null,
      notifications: { results: true, reminders: true },
    };
  }),
);

/**
 * Ce que le fournisseur a donné, quand ça vaut la peine d'être gardé.
 *
 * Une identité Apple masquée arrive sous le nom **« Anonyme »** : le poser dans
 * le formulaire reviendrait à proposer ce pseudo-là par défaut, et un
 * classement d'Anonymes ne dit rien. Les chaînes vides tombent pour la même
 * raison — mieux vaut un champ vide qu'un champ à effacer.
 */
const ANONYMOUS = ["anonyme", "anonymous", "unknown"];

function fromProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return ANONYMOUS.includes(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Le profil n'est pas prêt à jouer. Deux manques, une seule porte : sans pseudo
 * le classement s'écrit en « Anonyme », et sans avatar la slab n'a pas de
 * visage. La règle vit ici et nulle part ailleurs — l'app la lit, elle ne la
 * recalcule pas.
 */
function needsProfile(user: UserDoc): boolean {
  return !user.nickname?.trim() || !user.avatarUrl;
}
