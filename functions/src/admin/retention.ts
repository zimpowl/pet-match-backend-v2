import { initializeApp } from "firebase-admin/app";
import { DOCUMENTS, RETENTION_DAYS, bucketOf } from "../storage";

/**
 * La durée de vie des pièces d'identité, posée sur le bucket lui-même.
 *
 *   npm run retention -- --project=X            ce qui est en place
 *   npm run retention -- --project=X --commit   la règle des cinq ans
 *
 * Une pièce justifie une confirmation : elle doit survivre à la décision, pas
 * au joueur. Cinq ans après son dépôt, Google Cloud Storage l'efface tout seul
 * — c'est la seule façon de ne pas dépendre d'un ménage qu'on oublie de faire.
 *
 * Fermer un compte les efface avant l'échéance (`deleteAccountHttp`) : les deux
 * règles se complètent, aucune ne remplace l'autre.
 */

interface Rule {
  action: { type: "Delete" };
  condition: { age?: number; matchesPrefix?: string[] };
}

const OURS: Rule = {
  action: { type: "Delete" },
  condition: { age: RETENTION_DAYS, matchesPrefix: [`${DOCUMENTS}/`] },
};

function mine(rule: Rule): boolean {
  return rule.condition.matchesPrefix?.includes(`${DOCUMENTS}/`) === true;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const projectId =
    argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length) ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    "";
  if (!projectId) throw new Error("projet manquant : passer --project=<id>");

  const app = initializeApp({ projectId });
  const bucket = await bucketOf(app, projectId);
  const [metadata] = await bucket.getMetadata();
  const rules = (metadata.lifecycle?.rule ?? []) as Rule[];

  console.log(`bucket ${bucket.name}`);
  console.log(`règles en place : ${rules.length}`);
  for (const rule of rules) console.log(`  ${JSON.stringify(rule)}`);

  if (rules.some((rule) => mine(rule) && rule.condition.age === RETENTION_DAYS)) {
    console.log(`\nla règle des ${RETENTION_DAYS} jours est déjà posée.`);
    return;
  }

  console.log(`\nà poser : ${JSON.stringify(OURS)}`);
  if (!argv.includes("--commit")) {
    console.log("--dry-run : rien n'a été écrit. Ajouter --commit.");
    return;
  }

  await bucket.setMetadata({
    lifecycle: { rule: [...rules.filter((rule) => !mine(rule)), OURS] },
  });
  console.log("posée.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
