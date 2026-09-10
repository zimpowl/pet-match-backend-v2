/**
 * Le contrat de transport, recopié champ pour champ sur les DTO Kotlin de
 * `ContestApi` et `ProfileApi`. Ce sont eux la référence — le §5.1 du REFONTE
 * écrit `id` / `petId` là où l'app sérialise `uid` / `petUid`.
 *
 * Le backend ne renvoie que du brut : pas de `J-4`, pas de `1er`,
 * pas de `n° 000 012`. Tout le formatage est dans le presenter (§4.10).
 */

export type ContestStatusWire = "DRAFT" | "ACTIVE" | "CLOSED";
export type MeRole = "PARTICIPANT" | "JUDGE" | "NONE";
export type SpeciesWire = "DOG" | "CAT";

/** Dans CHAQUE réponse, lecture comme écriture (§5). */
export interface DailyVotesWire {
  remaining: number;
  capacity: number;
  secondsToReset: number;
}

export interface ContestWinnerWire {
  petUid: string;
  name: string;
  photoUrl: string | null;
}

export interface ContestCountsWire {
  judges: number;
  participants: number;
}

export interface ContestMePetWire {
  petUid: string;
  name: string;
  photoUrl: string | null;
}

export interface ContestMeVotesWire {
  cast: number;
  limit: number;
  judged: number;
  correct: number;
  wrong: number;
}

export interface ContestMeWire {
  role: MeRole;
  rank: number | null;
  registrationIndex: number | null;
  pet: ContestMePetWire | null;
  votes: ContestMeVotesWire | null;
  /**
   * L'ELO de **mon** animal sur ce concours, gelé au dernier 18 h comme partout
   * ailleurs (D54). 0 quand je n'ai pas d'animal en course : le juré n'a pas
   * d'ELO (D17).
   */
  elo: number;
  /**
   * Le compagnon obligatoire de l'ELO : « un ELO a besoin d'un compagnon, pas
   * d'un dénominateur » (§4.9, D62). Nombre de fois **choisi**, pas nombre
   * d'apparitions. Gelé comme l'ELO.
   */
  votesReceived: number;
  /**
   * Ce que j'étais **le jour de l'inscription**, figé pour toujours (D30). La
   * slab est un objet de collection : celle d'il y a trois mois doit dire
   * « niveau 1, aucune médaille », pas ce que je suis devenu depuis.
   */
  level: number;
  career: StatsWire;
  /**
   * Le vainqueur du concours, l'image de la slab d'un juré. null avant la
   * clôture — il n'y a pas encore de vainqueur — et null pour un participant,
   * dont la slab porte sa propre photo.
   */
  winner: ContestWinnerWire | null;
}

/** La brique commune : feed, profil, carousel, mini slab. */
export interface ContestCardWire {
  uid: string;
  number: number;
  theme: string;
  status: ContestStatusWire;
  startAt: number;
  endAt: number;
  counts: ContestCountsWire;
  me: ContestMeWire;
}

/**
 * Une ligne de concours porte de quoi imprimer **les deux étiquettes** de la
 * slab : l'identité du porteur en haut, le concours en pied. `level` et
 * `career` sont donc ceux du jour de l'inscription (D30), pas ceux
 * d'aujourd'hui — sinon la slab d'il y a trois mois mentirait.
 */
export interface ParticipantRowWire {
  petUid: string;
  ownerUid: string;
  number: number;
  name: string;
  breed: string | null;
  species: SpeciesWire;
  sex: string | null;
  photoUrl: string | null;
  elo: number;
  votesReceived: number;
  rank: number | null;
  registrationIndex: number;
  level: number;
  career: StatsWire;
}

export interface JudgeRowWire {
  userUid: string;
  number: number;
  name: string;
  avatarUrl: string | null;
  judgeSince: number;
  /** Les votes **jugés** : ceux du dernier 18 h, ou tous une fois clos. */
  votes: number;
  /** Les votes **posés**, y compris ceux d'aujourd'hui, pas encore tranchés. */
  castVotes: number;
  correctVotes: number;
  limit: number;
  rank: number | null;
  registrationIndex: number;
  level: number;
  career: StatsWire;
}

export interface StatsWire {
  contests: number;
  bestRank: number | null;
  gold: number;
  silver: number;
  bronze: number;
}

export interface JudgeWire {
  userUid: string;
  number: number;
  name: string;
  avatarUrl: string | null;
  judgeSince: number;
  countryCode: string | null;
  level: number;
  stats: StatsWire;
}

export interface PetWire {
  petUid: string;
  number: number;
  name: string;
  photoUrl: string | null;
  species: SpeciesWire;
  breed: string | null;
  sex: string | null;
  birthDate: number | null;
  countryCode: string | null;
  level: number;
  stats: StatsWire;
}

export interface DuelPetWire {
  petUid: string;
  name: string;
  photoUrl: string | null;
  /**
   * L'ELO **vivant**, pas l'instantané de 18 h (D97). C'est la seule lecture du
   * jeu qui échappe au gel du §4.2 bis, et il lui faut cette exception : le duel
   * est servi avec de quoi calculer les chances des deux animaux, pour que l'app
   * puisse afficher le verdict à l'instant du clic sans attendre le réseau.
   *
   * Il n'est jamais montré tel quel — l'app n'en publie que le pourcentage.
   */
  elo: number;
}

export interface DuelWire {
  a: DuelPetWire;
  b: DuelPetWire;
}

export interface ContestsResponse {
  dailyVotes: DailyVotesWire;
  contests: ContestCardWire[];
  olderCursor: string | null;
  newerCursor: string | null;
}

export interface ContestDetailResponse {
  dailyVotes: DailyVotesWire;
  contest: ContestCardWire;
  participants: ParticipantRowWire[];
  judges: JudgeRowWire[];
}

export interface VoteSessionResponse {
  dailyVotes: DailyVotesWire;
  theme: string;
  duels: DuelWire[];
  votesCast: number;
  votesLimit: number;
}

export interface JudgeProfileResponse {
  dailyVotes: DailyVotesWire;
  judge: JudgeWire;
  pets: PetWire[];
  contests: ContestCardWire[];
  /**
   * De quoi demander la suite de l'étagère (D100), null quand on en tient le
   * bout. L'en-tête et les animaux repartent avec chaque page : c'est quelques
   * champs pour une requête de moins, et l'app n'en garde que les concours.
   */
  olderCursor: string | null;
}

export interface PetProfileResponse {
  dailyVotes: DailyVotesWire;
  pet: PetWire;
  owner: JudgeWire;
  contests: ContestCardWire[];
  /** Voir `JudgeProfileResponse.olderCursor` (D100). */
  olderCursor: string | null;
}

/**
 * Le vote ne renvoie que ce que l'app ne peut pas savoir : son allocation. Le
 * verdict, lui, est déjà affiché — il se calcule sur les ELO reçus avec le duel
 * (D97), au moment du clic. Renvoyer les ELO **après** le vote serait pire
 * qu'inutile : l'animal choisi vient forcément de gagner des points, donc il
 * mènerait presque toujours, et le verdict serait vert quoi qu'on choisisse.
 */
export interface VoteSubmissionResponse {
  dailyVotes: DailyVotesWire;
  votesCast: number;
}

export interface JoinContestResponse {
  dailyVotes: DailyVotesWire;
  contest: ContestCardWire;
}
