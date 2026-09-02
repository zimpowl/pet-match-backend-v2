/**
 * La copie des notifications. Pure : aucune I/O, tout est testable au mot près.
 *
 * Registre, et il n'est pas négociable : **aucun emoji, aucun point
 * d'exclamation, aucune félicitation**. Le luxe ne complimente pas, il
 * constate. On vouvoie, comme un concours vouvoie ses concurrents.
 *
 * **La notification constate le changement, jamais le rang.** C'est le §4.2 bis :
 * « c'est le compte à rebours qui fait revenir, pas un aperçu — la tension est
 * dans l'inconnu ». Donner le rang rendrait l'ouverture de l'app inutile et
 * tuerait le rendez-vous de 18 h. Le fait est dans l'app ; la notification n'est
 * qu'une invitation à l'ouvrir.
 *
 * Le thème est toujours **cité**, jamais accolé nu à un verbe : les thèmes
 * réels sont « Pleine lune », « Cadrage serré », et « Pleine lune est clos »
 * serait fautif. On garde une espace ordinaire dans les guillemets plutôt que
 * l'espace fine insécable de la typographie française : une espace fine mal
 * rendue dans un volet de notification serait pire que son absence.
 *
 * Et **on ne genre jamais l'animal** : le doc participant ne porte pas son sexe,
 * et se tromper est pire que tout. Toute formule gendrée est un bug.
 */

export type Locale = "fr";

export interface Notification {
  readonly title: string;
  readonly body: string;
}

export interface Standing {
  readonly rank: number | null;
  readonly rankPrevious: number | null;
}

export interface EveningNews {
  readonly theme: string;
  readonly pet: (Standing & { readonly name: string }) | null;
  readonly judge: Standing | null;
}

export interface ClosingNews {
  readonly theme: string;
  readonly petName: string | null;
  readonly wasJudge: boolean;
}

export interface ReminderNews {
  readonly theme: string;
  readonly dailyCapacity: number;
}

type Direction = "UP" | "DOWN" | "HELD_PODIUM" | "NOTHING";

/**
 * Un rang immobile **hors du podium** n'est pas une nouvelle : rien n'a bougé à
 * l'écran, donc « venez découvrir votre rang » mentirait. Sur le podium, si —
 * « tient-il encore sa place » est une vraie tension.
 */
function direction(standing: Standing | null): Direction {
  if (!standing || standing.rank === null) return "NOTHING";
  const previous = standing.rankPrevious;
  if (previous === null || previous === standing.rank) {
    return standing.rank <= 3 ? "HELD_PODIUM" : "NOTHING";
  }
  // Le rang baisse quand on progresse.
  return previous > standing.rank ? "UP" : "DOWN";
}

/**
 * Range une étiquette BCP 47 venue de l'appareil (« fr-FR », « en-GB ») en une
 * langue qu'on sait servir. On garde la valeur normalisée même si on ne la sert
 * pas encore : c'est la mesure qui dira quand une deuxième langue vaut le coup.
 */
export function normalizeLocale(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/_/g, "-");
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(tag) ? tag : null;
}

export function resolveLocale(raw: string | null | undefined): Locale {
  void raw;
  // Une seule langue servie pour l'instant. Le jour où il y en a deux, le choix
  // se fait ici et nulle part ailleurs.
  return "fr";
}

/**
 * Le résultat du soir. Un joueur ne reçoit qu'**une** notification, même s'il
 * est à la fois participant et juré : son animal prend le titre — c'est
 * l'accroche la plus forte — et son jury tient dans le corps. Un assidu en
 * reçoit environ six par semaine ; séparer les rôles en ferait onze, et le
 * §8 point 6 signale déjà neuf comme un risque.
 */
export function composeEvening(news: EveningNews, locale: Locale): Notification | null {
  void locale;
  const pet = direction(news.pet);
  const judge = direction(news.judge);
  if (pet === "NOTHING" && judge === "NOTHING") return null;

  if (pet !== "NOTHING" && news.pet) {
    const also = judge === "NOTHING" ? null : judgeClause(judge);
    const invitation = also ? "Venez découvrir vos rangs." : "Venez découvrir son rang.";
    return {
      title: petTitle(news.pet.name, pet),
      body: [`${contestName(news.theme)}.`, also, invitation]
        .filter((part): part is string => part !== null)
        .join(" "),
    };
  }

  return {
    title: judgeTitle(judge),
    body: `${contestName(news.theme)}. Venez découvrir votre rang.`,
  };
}

/**
 * La clôture. On dit **seulement** que le concours est clos : c'est le
 * dénouement, et en révéler quoi que ce soit — sens, rang, médaille — l'évente.
 * Le juré a une slab à chaque clôture, médaille ou pas (D64), donc le message
 * est le même pour tout le monde.
 */
export function composeClosing(news: ClosingNews, locale: Locale): Notification | null {
  void locale;
  if (!news.petName && !news.wasJudge) return null;

  const waiting =
    news.petName && news.wasJudge ?
      `Le résultat de ${news.petName} et le vôtre vous attendent.` :
      news.petName ?
        `Le résultat de ${news.petName} vous attend.` :
        "Votre résultat de juré vous attend.";

  return { title: `Le concours ${quoted(news.theme)} est clos`, body: waiting };
}

/**
 * Le rappel de l'après-midi, quelques heures avant la bascule. Envoyé **au seul
 * juré qui n'a rien posé aujourd'hui** : l'allocation ne se cumule pas, ce qui
 * n'est pas posé avant 18 h est perdu (D37). C'est le seul endroit où un
 * chiffre est donné, et c'est légitime — c'est son budget, pas un classement.
 */
export function composeReminder(news: ReminderNews, locale: Locale): Notification | null {
  void locale;
  if (news.dailyCapacity <= 0) return null;

  return {
    title: `Vos ${spell(news.dailyCapacity)} votes du jour expirent à 18 h`,
    body: `${contestName(news.theme)}. Ce qui n'est pas posé est perdu.`,
  };
}

function quoted(theme: string): string {
  return `« ${theme.trim()} »`;
}

/** Le thème cité, pour qu'aucun verbe ne s'y accole directement. */
function contestName(theme: string): string {
  return `Concours ${quoted(theme)}`;
}

/** Accordé avec « place » ou « classement », donc jamais avec l'animal. */
function petTitle(name: string, moved: Direction): string {
  switch (moved) {
  case "UP":
    return `${name} est monté au classement`;
  case "DOWN":
    return `${name} est descendu au classement`;
  default:
    return `${name} garde sa place sur le podium`;
  }
}

function judgeTitle(moved: Direction): string {
  switch (moved) {
  case "UP":
    return "Vous êtes monté au classement du jury";
  case "DOWN":
    return "Vous êtes descendu au classement du jury";
  default:
    return "Vous gardez votre place sur le podium du jury";
  }
}

function judgeClause(moved: Direction): string {
  switch (moved) {
  case "UP":
    return "Vous êtes également monté au jury.";
  case "DOWN":
    return "Vous avez reculé au jury.";
  default:
    return "Vous gardez votre place sur le podium du jury.";
  }
}

/** Les petits nombres s'écrivent en lettres. */
function spell(value: number): string {
  const words = [
    "zéro", "un", "deux", "trois", "quatre", "cinq",
    "six", "sept", "huit", "neuf", "dix",
  ];
  return words[value] ?? String(value);
}

/**
 * Faut-il rappeler ce juré ? Seulement s'il n'a **rien** posé aujourd'hui et
 * qu'il lui reste de la place sous le plafond du concours : dire « venez voter »
 * à quelqu'un qui est « Complet » serait le pire des messages.
 */
export function shouldRemind(input: {
  readonly votesToday: number;
  readonly votesCast: number;
  readonly maxVotesPerJudge: number;
  readonly dailyCapacity: number;
}): boolean {
  if (input.votesToday > 0) return false;
  if (input.dailyCapacity <= 0) return false;
  return input.votesCast < input.maxVotesPerJudge;
}
