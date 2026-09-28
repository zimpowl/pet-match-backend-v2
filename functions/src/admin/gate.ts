import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { PLATFORMS, Platform, VersionGate, readGate } from "../core/gate";

/**
 * Lire et écrire la porte de version.
 *
 *   npm run gate -- --project=pet-match-30417                                 (lit)
 *   npm run gate -- --project=pet-match-30417 --android-latest=199 --commit
 *   npm run gate -- --project=pet-match-30417 --android-min=199 --commit      (ferme)
 *   npm run gate -- --project=pet-match-30417 --android-min=0 --ios-min=0 --commit (rouvre)
 *
 * **Cet outil n'a volontairement pas le garde `/debug/i` des autres.** Il existe
 * pour tourner en production : c'est là qu'on ferme la porte après une
 * publication, et surtout c'est là qu'on la rouvre en urgence si on s'est
 * trompé. Ne pas « corriger » cette absence — elle est le sujet.
 *
 * Rouvrir est l'issue de secours : une écriture d'un document, effective en
 * moins d'une minute, sans déploiement. C'est cette propriété qui justifie que
 * la porte vive dans Firestore plutôt que dans le code.
 *
 * Il n'écrit qu'un seul chemin : `configuration/version`.
 */

const CONFIGURATION = "configuration";
const VERSION = "version";

interface Change {
  readonly platform: Platform;
  readonly minimumCode?: number;
  readonly latestCode?: number;
}

interface Options {
  readonly projectId: string;
  readonly changes: readonly Change[];
  readonly commit: boolean;
  readonly force: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  // Pas de repli sur l'environnement : cet outil écrit en production, le projet
  // se dit à voix haute.
  const projectId = flag("project");
  if (!projectId) throw new Error("projet manquant : passer --project=<id>");

  const number = (name: string): number | undefined => {
    const raw = flag(name);
    if (raw === undefined) return undefined;
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`--${name} doit être un entier positif ou nul, reçu « ${raw} »`);
    }
    return value;
  };

  const changes = PLATFORMS.map((platform) => ({
    platform,
    minimumCode: number(`${platform}-min`),
    latestCode: number(`${platform}-latest`),
  })).filter((change) => change.minimumCode !== undefined || change.latestCode !== undefined);

  return {
    projectId,
    changes,
    commit: argv.includes("--commit"),
    force: argv.includes("--force"),
  };
}

function print(label: string, gate: VersionGate): void {
  console.log(`  ${label}`);
  for (const platform of PLATFORMS) {
    const { minimumCode, latestCode } = gate[platform];
    const state = minimumCode === 0 ? "ouverte" : `ferme en dessous de ${minimumCode}`;
    console.log(`    ${platform.padEnd(8)} min ${minimumCode}, publié ${latestCode} — ${state}`);
  }
}

function apply(current: VersionGate, changes: readonly Change[]): VersionGate {
  const next = { android: { ...current.android }, ios: { ...current.ios } };
  for (const change of changes) {
    if (change.minimumCode !== undefined) next[change.platform].minimumCode = change.minimumCode;
    if (change.latestCode !== undefined) next[change.platform].latestCode = change.latestCode;
  }
  return next;
}

/**
 * Deux refus, parce qu'ils décrivent des portes qui ne s'ouvrent plus :
 * exiger un build qui n'est pas publié, et reculer le dernier publié — ce
 * second cas est presque toujours une faute de frappe.
 */
function check(current: VersionGate, next: VersionGate, force: boolean): void {
  for (const platform of PLATFORMS) {
    const { minimumCode, latestCode } = next[platform];
    if (minimumCode > latestCode && !force) {
      throw new Error(
        `${platform} : minimum ${minimumCode} au-dessus du dernier publié ${latestCode}` +
          " — personne ne pourrait se mettre à jour. --force pour passer outre.",
      );
    }
    if (latestCode < current[platform].latestCode && !force) {
      throw new Error(
        `${platform} : dernier publié en recul, ${current[platform].latestCode} -> ${latestCode}` +
          " — probablement une faute de frappe. --force pour passer outre.",
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = getFirestore(initializeApp({ projectId: options.projectId }));
  const ref = db.collection(CONFIGURATION).doc(VERSION);

  console.log(`projet : ${options.projectId}`);

  const snap = await ref.get();
  const current = readGate(snap.data());
  if (!snap.exists) console.log("  (le document n'existe pas encore : porte ouverte)");
  print("actuel", current);

  if (options.changes.length === 0) return;

  const next = apply(current, options.changes);
  check(current, next, options.force);
  print("après", next);

  if (!options.commit) {
    console.log();
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit pour poser.");
    return;
  }

  await ref.set({ ...next, updatedAt: Timestamp.now() }, { merge: true });
  console.log();
  console.log("écrit. L'app le verra dans la minute — le cache de l'endpoint dure 60 s.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
