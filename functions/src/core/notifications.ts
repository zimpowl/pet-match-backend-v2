/**
 * La copie des notifications. Pure : aucune I/O, tout est testable au mot près.
 *
 * Registre, et il n'est pas négociable : **aucun emoji, aucun point
 * d'exclamation, aucune félicitation**. Le luxe ne complimente pas, il
 * constate. On vouvoie, comme un concours vouvoie ses concurrents.
 *
 * **Une notification invite, elle n'informe pas.** Trois raisons de revenir,
 * pas une de plus : venir voter, ne pas perdre ses votes, venir voir où l'on
 * en est. Jamais un rang ni un sens de variation — la tension est dans
 * l'inconnu (§4.2 bis), et le fait est dans l'app. Le classement du soir se
 * recalcule chaque jour et se lit dans l'app ; il ne se notifie plus : le
 * résultat, c'est le dimanche.
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

export interface ClosingNews {
  readonly theme: string;
  readonly petName: string | null;
  readonly wasJudge: boolean;
}

export interface OpeningNews {
  readonly theme: string;
}

export interface ReminderNews {
  readonly theme: string;
  /** Ce qui peut encore être posé aujourd'hui : l'allocation, bornée par le plafond. */
  readonly remaining: number;
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
 * Le dimanche, à qui avait un rôle dans le concours qui se termine. On dit
 * seulement que c'est tombé : le dénouement est dans l'app, sur le concours
 * et ses cartes. Le même message pour l'animal et pour le juré — les deux
 * résultats sont au même endroit.
 */
export function composeClosing(news: ClosingNews, locale: Locale): Notification | null {
  void locale;
  if (!news.petName && !news.wasJudge) return null;

  return {
    title: `Les résultats de ${quoted(news.theme)} sont tombés`,
    body: "Venez découvrir le classement final.",
  };
}

/**
 * Le dimanche, à tous les autres : un concours commence, on peut voter, et
 * le suivant prend déjà les inscriptions. Qui reçoit la clôture ne reçoit pas
 * celle-ci — une notification par personne et par soir.
 */
export function composeOpening(news: OpeningNews, locale: Locale): Notification {
  void locale;
  return {
    title: `Le concours ${quoted(news.theme)} commence`,
    body: "Venez voter. Les inscriptions du suivant sont ouvertes.",
  };
}

/**
 * Le rappel de l'après-midi, au seul juré qui n'a rien posé aujourd'hui :
 * l'allocation ne se cumule pas, ce qui n'est pas posé avant 18 h est perdu
 * (D37). C'est le seul chiffre donné — son budget, pas un classement.
 */
export function composeReminder(news: ReminderNews, locale: Locale): Notification | null {
  void locale;
  if (news.remaining <= 0) return null;

  return {
    title: "Vos votes vous attendent",
    body:
      `Il vous en reste ${spell(news.remaining)} pour ${quoted(news.theme)} avant 18 h.` +
      " Après, ils sont perdus.",
  };
}

function quoted(theme: string): string {
  return `« ${theme.trim()} »`;
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

/** Ce qu'un juré peut encore poser aujourd'hui : l'allocation, sans dépasser le plafond. */
export function remainingToday(input: {
  readonly votesCast: number;
  readonly maxVotesPerJudge: number;
  readonly dailyCapacity: number;
}): number {
  return Math.max(0, Math.min(input.dailyCapacity, input.maxVotesPerJudge - input.votesCast));
}

/**
 * Les nouvelles **personnelles** : ce qui arrive au dossier d'un joueur, et
 * qu'aucun écran ne lui apprendra s'il n'ouvre pas l'app. Elles ne parlent
 * jamais d'un concours, donc elles ne relèvent pas du rendez-vous de 18 h et
 * ne se taisent pas quand on coupe les résultats.
 *
 * Même registre que le reste : on constate, on ne félicite pas. Un grade se
 * dit comme un fait, pas comme un trophée.
 */
export interface GradeNews {
  readonly level: number;
  readonly name: string;
  readonly petName: string | null;
}

export interface ModerationNews {
  readonly petName: string | null;
}

export interface SuspensionNews {
  readonly untilText: string;
}

export interface VerificationNews {
  readonly accepted: boolean;
  readonly petName: string | null;
}

export function composeGrade(news: GradeNews, locale: Locale): Notification {
  void locale;
  if (news.petName) {
    return { title: `${news.petName} devient ${news.name}`, body: "Venez voir sa progression." };
  }
  return { title: `Vous devenez ${news.name}`, body: "Venez voir votre progression." };
}

/**
 * La photo reste, elle n'est plus servie (D134). On dit ce qui est fait et
 * pourquoi c'est possible — la charte —, sans accuser ni s'excuser.
 */
export function composeHidden(news: ModerationNews, locale: Locale): Notification {
  void locale;
  const subject = news.petName ? `La photo de ${news.petName}` : "Votre photo de profil";

  return {
    title: "Une photo a été retirée",
    body: `${subject} ne s'affiche plus. Elle ne respectait pas la charte de publication.`,
  };
}

/**
 * Le compte garde tout et ne peut plus agir jusqu'à la date (D133). La date
 * est le seul chiffre utile : sans elle, la suspension paraît définitive.
 */
export function composeSuspension(news: SuspensionNews, locale: Locale): Notification {
  void locale;
  return {
    title: "Votre compte est suspendu",
    body:
      `Vous pouvez tout consulter jusqu'au ${news.untilText}.` +
      " Voter, vous inscrire et publier attendront.",
  };
}

/**
 * Le dépôt d'une pièce n'a aucun écho aujourd'hui : on la dépose et on attend
 * sans jamais rien savoir. C'est la nouvelle la plus attendue des quatre.
 *
 * Le refus ne recopie **jamais** le motif : il est tapé à la main pendant la
 * revue, pour l'écran d'identité, et lu dans un volet de notification il
 * sonnait comme une note interne. L'app le montre, à sa place.
 */
export function composeVerification(news: VerificationNews, locale: Locale): Notification {
  void locale;
  if (news.accepted) {
    return {
      title: "Identité confirmée",
      body: news.petName ?
        `L'identité de ${news.petName} est validée. Venez voir sa progression.` :
        "Votre identité est validée. Venez voir votre progression.",
    };
  }

  return {
    title: "Pièce non validée",
    body: news.petName ?
      `La pièce déposée pour ${news.petName} n'a pas pu être validée.` +
        " Ouvrez l'app pour voir pourquoi." :
      "Votre pièce n'a pas pu être validée. Ouvrez l'app pour voir pourquoi.",
  };
}
