import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { toString as qrToString } from "qrcode";
import { LinkPlatform, dayKey } from "../core/links";

/**
 * Les liens courts et leur tableau de bord.
 *
 *   npm run links -- --project=X                                    (le tableau)
 *   npm run links -- --project=X --create=clinique-durand --label="Clinique Durand" --commit
 *   npm run links -- --project=X --qr=clinique-durand               (le QR, en SVG)
 *
 * **Cet outil n'a pas le garde `/debug/i` des autres**, et c'est volontaire :
 * comme `gate`, il existe pour tourner en production. Un lien créé sur un projet
 * de debug ne mène nulle part, et un flyer s'imprime une fois.
 *
 * Il ne détruit rien : il lit, il crée, il écrit un fichier SVG. La seule
 * écriture possible est la création d'un document, derrière `--commit`.
 */

const LINKS = "links";
const BASE = "https://www.pet-match.fr/go";
const PLATFORMS: readonly LinkPlatform[] = ["ios", "android", "web"];

interface Options {
  readonly projectId: string;
  readonly create?: string;
  readonly label?: string;
  readonly qr?: string;
  readonly outDir: string;
  readonly commit: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    throw new Error("projet manquant : passer --project=<id> ou GOOGLE_CLOUD_PROJECT");
  }

  const create = flag("create");
  if (create !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(create)) {
    throw new Error(
      `code « ${create} » invalide : minuscules, chiffres et tirets, 64 caractères au plus`,
    );
  }

  return {
    projectId,
    create,
    label: flag("label"),
    qr: flag("qr"),
    outDir: flag("out") ?? "qr",
    commit: argv.includes("--commit"),
  };
}

/** Les sept derniers jours, Paris, du plus ancien au plus récent. */
function lastSevenDays(now: number): string[] {
  const days: string[] = [];
  for (let back = 6; back >= 0; back--) days.push(dayKey(now - back * 86_400_000));
  return days;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));

  if (options.create) {
    const ref = db.collection(LINKS).doc(options.create);
    if ((await ref.get()).exists) throw new Error(`le lien « ${options.create} » existe déjà`);

    console.log(`création   ${options.create}`);
    console.log(`libellé    ${options.label ?? "(aucun)"}`);
    console.log(`adresse    ${BASE}/${options.create}`);

    if (!options.commit) {
      console.log("\n--dry-run : rien n'a été écrit. Ajouter --commit pour créer.");
      return;
    }

    await ref.set({
      label: options.label ?? options.create,
      createdAt: Timestamp.now(),
      total: 0,
      jours: {},
      par: {},
    });
    console.log("\nfait.");
    return;
  }

  if (options.qr) {
    const url = `${BASE}/${options.qr}`;
    // Correction d'erreur au niveau haut : un flyer se froisse, se tache, et se
    // lit de travers. C'est 30 % de redondance pour un carré à peine plus dense.
    const svg = await qrToString(url, { type: "svg", errorCorrectionLevel: "H", margin: 1 });
    mkdirSync(options.outDir, { recursive: true });
    const path = join(options.outDir, `${options.qr}.svg`);
    writeFileSync(path, svg);
    console.log(`${url}\n-> ${path}`);
    return;
  }

  const snap = await db.collection(LINKS).orderBy("total", "desc").get();
  if (snap.empty) {
    console.log("aucun lien. En créer un : --create=<code> --label=\"…\" --commit");
    return;
  }

  const days = lastSevenDays(Date.now());
  const head =
    "code".padEnd(22) + "libellé".padEnd(32) + "total".padStart(6) +
    "7 j".padStart(6) + "iOS".padStart(6) + "Android".padStart(8) + "web".padStart(6);
  console.log(head);
  console.log("-".repeat(head.length));

  let total = 0;
  for (const doc of snap.docs) {
    const jours = (doc.get("jours") ?? {}) as Record<string, number>;
    const par = (doc.get("par") ?? {}) as Record<string, number>;
    const semaine = days.reduce((sum, day) => sum + (jours[day] ?? 0), 0);
    const clics = (doc.get("total") as number) ?? 0;
    total += clics;
    console.log(
      doc.id.slice(0, 21).padEnd(22) +
        String(doc.get("label") ?? "").slice(0, 31).padEnd(32) +
        String(clics).padStart(6) +
        String(semaine).padStart(6) +
        PLATFORMS.map((p, i) => String(par[p] ?? 0).padStart(i === 1 ? 8 : 6)).join(""),
    );
  }
  console.log("-".repeat(head.length));
  console.log(`${snap.size} lien(s), ${total} clic(s) au total.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
