/**
 * Le tableau de bord du matin : ce qui s'est passé jour par jour, de la pub au
 * vote, lu dans la base. Lecture seule — rien n'est écrit.
 *
 *   npm run stats -- --project=pet-match-30417              (14 derniers jours)
 *   npm run stats -- --project=pet-match-30417 --days=30
 *
 * Colonnes, par jour (Paris) :
 *   clics     les clics des liens courts, tous codes confondus (robots compris)
 *   comptes   les comptes créés
 *   licences  les comptes qui ont signé la licence de juré
 *   animaux   les animaux créés
 *   inscr.    les inscriptions à un concours
 *   votes     les votes posés
 *   jurés     les jurés distincts qui ont voté ce jour-là
 *   nouveaux  ceux dont c'était le tout premier vote
 *
 * Les installations et ouvertures, elles, sont dans Google Analytics et les
 * consoles des stores : la base ne les voit pas.
 */
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { dayKey } from "../core/links";

interface Row {
  clicks: number;
  accounts: number;
  licences: number;
  pets: number;
  entries: number;
  votes: number;
  judges: Set<string>;
  firstVotes: number;
}

function parseOptions(argv: readonly string[]): { projectId: string; days: number } {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const projectId =
    flag("project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) throw new Error("projet manquant : passer --project=<id>");
  const days = Number.parseInt(flag("days") ?? "14", 10);
  return { projectId, days: Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 14 };
}

function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

async function main(): Promise<void> {
  const { projectId, days } = parseOptions(process.argv.slice(2));
  initializeApp({ projectId });
  const db = getFirestore();

  const now = Date.now();
  const since = now - days * 86_400_000;
  const keys: string[] = [];
  for (let back = days - 1; back >= 0; back--) keys.push(dayKey(now - back * 86_400_000));
  const rows = new Map<string, Row>(
    keys.map((key) => [
      key,
      { clicks: 0, accounts: 0, licences: 0, pets: 0, entries: 0, votes: 0, judges: new Set(), firstVotes: 0 },
    ]),
  );
  const add = (at: number | null, update: (row: Row) => void) => {
    if (at === null || at < since) return;
    const row = rows.get(dayKey(at));
    if (row) update(row);
  };

  // Par concours plutôt qu'en groupe de collections : la recherche par date dans
  // un sous-ensemble ne demande aucun index composite.
  const sinceTs = Timestamp.fromMillis(since);
  const [links, users, pets, contests, judges] = await Promise.all([
    db.collection("links").get(),
    db.collection("users").select("createdAt", "rulesSignedAt").get(),
    db.collection("pets").where("createdAt", ">=", sinceTs).select("createdAt").get(),
    db.collection("contests").select("endAt").get(),
    db.collectionGroup("judges").select("userUid", "joinedAt").get(),
  ]);
  const recent = contests.docs.filter((contest) => (millis(contest.get("endAt")) ?? now) >= since);
  const perContest = await Promise.all(
    recent.map((contest) =>
      Promise.all([
        contest.ref.collection("participants").where("createdAt", ">=", sinceTs).select("createdAt").get(),
        contest.ref.collection("votes").where("createdAt", ">=", sinceTs).select("createdAt", "judgeUserUid").get(),
      ]),
    ),
  );

  for (const link of links.docs) {
    const perDay = (link.data().jours ?? {}) as Record<string, number | { total?: number }>;
    for (const [key, value] of Object.entries(perDay)) {
      const row = rows.get(key);
      if (row) row.clicks += typeof value === "number" ? value : value.total ?? 0;
    }
  }
  for (const user of users.docs) {
    add(millis(user.get("createdAt")), (row) => row.accounts++);
    add(millis(user.get("rulesSignedAt")), (row) => row.licences++);
  }
  for (const pet of pets.docs) add(millis(pet.get("createdAt")), (row) => row.pets++);
  for (const [entries, votes] of perContest) {
    for (const entry of entries.docs) add(millis(entry.get("createdAt")), (row) => row.entries++);
    for (const vote of votes.docs) {
      add(millis(vote.get("createdAt")), (row) => {
        row.votes++;
        row.judges.add(String(vote.get("judgeUserUid") ?? ""));
      });
    }
  }

  // Un nouveau juré : sa toute première fiche de juré, tous concours confondus.
  const firstJoin = new Map<string, number>();
  for (const judge of judges.docs) {
    const at = millis(judge.get("joinedAt"));
    const uid = String(judge.get("userUid") ?? "");
    if (at === null || !uid) continue;
    firstJoin.set(uid, Math.min(at, firstJoin.get(uid) ?? at));
  }
  for (const at of firstJoin.values()) add(at, (row) => row.firstVotes++);

  const header = ["jour", "clics", "comptes", "licences", "animaux", "inscr.", "votes", "jurés", "nouveaux"];
  const line = (cells: (string | number)[]) =>
    cells.map((cell, i) => (i === 0 ? String(cell).padEnd(10) : String(cell).padStart(8))).join(" ");
  console.log(line(header));
  console.log("-".repeat(10 + 9 * (header.length - 1)));
  const total: Row = { clicks: 0, accounts: 0, licences: 0, pets: 0, entries: 0, votes: 0, judges: new Set(), firstVotes: 0 };
  for (const key of keys) {
    const row = rows.get(key)!;
    console.log(line([key, row.clicks, row.accounts, row.licences, row.pets, row.entries, row.votes, row.judges.size, row.firstVotes]));
    total.clicks += row.clicks;
    total.accounts += row.accounts;
    total.licences += row.licences;
    total.pets += row.pets;
    total.entries += row.entries;
    total.votes += row.votes;
    row.judges.forEach((uid) => total.judges.add(uid));
    total.firstVotes += row.firstVotes;
  }
  console.log("-".repeat(10 + 9 * (header.length - 1)));
  console.log(line(["total", total.clicks, total.accounts, total.licences, total.pets, total.entries, total.votes, total.judges.size, total.firstVotes]));

  const rate = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "—");
  console.log(
    `\nclic → compte ${rate(total.accounts, total.clicks)} · compte → licence ${rate(total.licences, total.accounts)}` +
      ` · compte → animal ${rate(total.pets, total.accounts)} · nouveaux jurés ${total.firstVotes}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
