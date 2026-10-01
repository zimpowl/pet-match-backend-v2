import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { LINKS, db } from "../firebase";
import { LinkPlatform, codeFrom, dayKey, platformOf } from "../core/links";

/**
 * `pet-match.fr/go/<code>` — le lien court, et le seul endroit où l'on mesure
 * d'où viennent les gens.
 *
 * Non authentifié, comme la porte de version : il est destiné à être imprimé
 * sur un flyer et collé dans une bio Instagram.
 *
 * **Un lien inconnu ne renvoie jamais d'erreur.** Un QR code mal imprimé, une
 * faute de frappe, un code retiré — la personne est devant son vétérinaire avec
 * son téléphone à la main, et une page d'erreur serait la pire réponse
 * possible. Elle part sur le site, qui sait accueillir n'importe qui.
 *
 * Le comptage est attendu avant la redirection. C'est quelques dizaines de
 * millisecondes, et l'inverse — répondre d'abord, écrire ensuite — perdrait des
 * clics : rien ne garantit que la fonction survit à sa réponse.
 */

const SITE = "https://www.pet-match.fr";
const STORES: Record<LinkPlatform, string> = {
  ios: "https://apps.apple.com/fr/app/petmatch/id6772214932",
  android: "https://play.google.com/store/apps/details?id=com.zimpo.petmatch",
  web: SITE,
};

interface LinkDoc {
  readonly label?: string;
  readonly targets?: Partial<Record<LinkPlatform, string>>;
}

export const goHttp = onRequest(async (req, res) => {
  const code = codeFrom(req.path, typeof req.query.c === "string" ? req.query.c : undefined);
  const platform = platformOf(req.headers["user-agent"]);

  // Jamais de cache : un lien mis en cache ne se compte qu'une fois, et une
  // destination changée ne prendrait effet nulle part.
  res.set("Cache-Control", "no-store");

  if (!code) {
    res.redirect(302, SITE);
    return;
  }

  const ref = db.collection(LINKS).doc(code);

  try {
    const snap = await ref.get();
    if (!snap.exists) {
      res.redirect(302, SITE);
      return;
    }

    await ref.update({
      total: FieldValue.increment(1),
      [`jours.${dayKey(Date.now())}`]: FieldValue.increment(1),
      [`par.${platform}`]: FieldValue.increment(1),
    });

    const doc = snap.data() as LinkDoc;
    res.redirect(302, doc.targets?.[platform] ?? STORES[platform]);
  } catch (error) {
    // Le comptage n'est pas la raison d'être du lien : si Firestore flanche,
    // la personne doit quand même arriver quelque part.
    console.error(error);
    res.redirect(302, STORES[platform]);
  }
});
