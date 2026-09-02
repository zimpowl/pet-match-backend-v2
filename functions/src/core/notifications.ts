/**
 * La copie des notifications. Pure : aucune I/O, tout est testable au mot près.
 *
 * Registre, et il n'est pas négociable : **aucun emoji, aucun point
 * d'exclamation, aucune félicitation**. Le luxe ne complimente pas, il
 * constate. On écrit comme le bulletin de résultats d'un vrai concours —
 * factuel, court, précis — et c'est le fait lui-même qui touche l'ego :
 * le nom de l'animal, le mouvement, le rang.
 *
 * Deux règles de rédaction qui viennent du domaine, pas du goût :
 *
 * - **On ne genre jamais l'animal.** Le doc participant ne porte pas son sexe,
 *   et se tromper est pire que tout. « Heureux tient la première place » fait
 *   accorder l'adjectif avec « place », jamais avec l'animal.
 * - **On tutoie**, comme le reste de l'app (« Tu as posé tes 70 votes »).
 */

export type Locale = "fr";

export interface Notification {
  readonly title: string;
  readonly body: string;
}

export interface Standing {
  readonly rank: number | null;
  readonly rankPrevious: number | null;
  readonly total: number;
}

export interface EveningNews {
  /** Journées pleines jouées au dernier 18 h : 1 à 6. */
  readonly day: number;
  readonly pet: (Standing & { readonly name: string }) | null;
  readonly judge: (Standing & { readonly dailyCapacity: number }) | null;
}

export interface ClosingPet {
  readonly name: string;
  readonly rank: number | null;
  readonly total: number;
  readonly elo: number;
}

export interface ClosingNews {
  readonly pet: ClosingPet | null;
  readonly judge: {
    readonly rank: number | null;
    readonly total: number;
    readonly votes: number;
    readonly correctVotes: number;
  } | null;
}

/** Le podium est une nouvelle chaque soir, même immobile. Le reste, non. */
function isNews(standing: Standing | null): boolean {
  if (!standing || standing.rank === null) return false;
  if (standing.rank <= 3) return true;
  return standing.rankPrevious !== null && standing.rankPrevious !== standing.rank;
}

export function resolveLocale(raw: string | null | undefined): Locale {
  void raw;
  // Une seule langue pour l'instant. Le jour où il y en a deux, c'est ici que
  // le choix se fait, et nulle part ailleurs.
  return "fr";
}

/**
 * Le résultat du soir. Un joueur qui est à la fois participant et juré reçoit
 * **une seule** notification : la nouvelle de son animal porte le titre, sa
 * position de juré et la relance de ses votes tiennent dans le corps. Sept
 * notifications par semaine suffisent déjà (§8 point 6).
 *
 * Renvoie null quand il n'y a rien à dire — un rang immobile hors du podium
 * n'est pas une nouvelle, et une notification vide tue l'effet des autres.
 */
export function composeEvening(news: EveningNews, locale: Locale): Notification | null {
  void locale;
  const pet = isNews(news.pet) ? news.pet : null;
  const judge = isNews(news.judge) ? news.judge : null;
  if (!pet && !judge) return null;

  const evening = `au soir du jour ${news.day}`;

  if (pet) {
    const body = [
      `${position(pet.rank)} sur ${pet.total}, ${evening}.`,
      judge ? judgeSentence(judge) : null,
      news.judge ? allocationSentence(news.judge.dailyCapacity) : null,
    ]
      .filter((line): line is string => line !== null)
      .join(" ");

    return { title: petTitle(pet.name, pet), body };
  }

  const standing = judge as Standing & { dailyCapacity: number };
  const place = `${position(standing.rank)} sur ${standing.total}, ${evening}.`;
  return {
    title: judgeTitle(standing),
    body: `${place} ${allocationSentence(standing.dailyCapacity)}`,
  };
}

/**
 * La clôture. Elle notifie toujours, podium ou pas : c'est le dénouement, l'ELO
 * y est révélé — il devient le chiffre de la slab (D44) — et le juré a sa slab
 * à chaque clôture, médaille ou non (D64).
 */
export function composeClosing(news: ClosingNews, locale: Locale): Notification | null {
  void locale;

  if (news.pet) {
    const { name, rank, total, elo } = news.pet;
    const lines = [`${position(rank)} sur ${total}, ELO ${Math.round(elo)}.`];
    if (news.judge) lines.push(judgeClosingSentence(news.judge));
    lines.push("Ta slab est disponible.");

    return {
      title: `${name} termine à la ${ordinalFeminine(rank)} place`,
      body: lines.join(" "),
    };
  }

  if (news.judge) {
    return {
      title: `Tu termines à la ${ordinalFeminine(news.judge.rank)} place du jury`,
      body: `${judgeClosingSentence(news.judge)} Ta slab est disponible.`,
    };
  }

  return null;
}

function petTitle(name: string, standing: Standing): string {
  const moved = movement(standing);
  if (moved > 0) return `${name} gagne ${places(moved)}`;
  if (moved < 0) return `${name} perd ${places(-moved)}`;
  return `${name} tient la ${ordinalFeminine(standing.rank)} place`;
}

function judgeTitle(standing: Standing): string {
  const moved = movement(standing);
  if (moved > 0) return `Tu gagnes ${places(moved)} au jury`;
  if (moved < 0) return `Tu perds ${places(-moved)} au jury`;
  return `Tu tiens la ${ordinalFeminine(standing.rank)} place du jury`;
}

function judgeSentence(standing: Standing): string {
  const moved = movement(standing);
  if (moved > 0) return `Au jury, tu gagnes ${places(moved)} et tu es ${position(standing.rank)}.`;
  if (moved < 0) return `Au jury, tu perds ${places(-moved)} et tu es ${position(standing.rank)}.`;
  return `Au jury, tu tiens la ${ordinalFeminine(standing.rank)} place.`;
}

function judgeClosingSentence(judge: {
  votes: number;
  correctVotes: number;
  rank: number | null;
  total: number;
}): string {
  const accuracy = judge.votes > 0 ? Math.round((judge.correctVotes / judge.votes) * 100) : 0;
  return `${judge.correctVotes} votes justes sur ${judge.votes}, précision ${accuracy} %.`;
}

function allocationSentence(capacity: number): string {
  return `Tes ${spell(capacity)} votes du jour sont ouverts.`;
}

/** Positif = on remonte. Le rang baisse quand on progresse. */
function movement(standing: Standing): number {
  if (standing.rank === null || standing.rankPrevious === null) return 0;
  return standing.rankPrevious - standing.rank;
}

function places(count: number): string {
  return count === 1 ? "une place" : `${spell(count)} places`;
}

/** Les petits nombres s'écrivent en lettres ; les rangs restent en chiffres. */
function spell(value: number): string {
  const words = [
    "zéro", "une", "deux", "trois", "quatre", "cinq",
    "six", "sept", "huit", "neuf", "dix",
  ];
  return words[value] ?? String(value);
}

/** `1er`, `2e`, `3e`… tel que l'app les formate déjà (§4.10). */
function position(rank: number | null): string {
  if (rank === null) return "non classé";
  return rank === 1 ? "1er" : `${rank}e`;
}

/** Accordé avec « place », donc féminin, donc jamais avec l'animal. */
function ordinalFeminine(rank: number | null): string {
  if (rank === null) return "dernière";
  switch (rank) {
  case 1:
    return "première";
  case 2:
    return "deuxième";
  case 3:
    return "troisième";
  default:
    return `${rank}e`;
  }
}
