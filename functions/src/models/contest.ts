import { firestore } from "firebase-admin";
import { StatsDoc } from "./user";

export type ContestStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type Species = "DOG" | "CAT";
export type Sex = "MALE" | "FEMALE";

export interface ContestDoc {
  theme: string;
  number: number;
  status: ContestStatus;
  createdAt: firestore.Timestamp;
  startAt: firestore.Timestamp;
  endAt: firestore.Timestamp;
  maxVotesPerJudge: number;
  maxVotesPerDay: number;
  eloKFactor: number;
  /**
   * Trois compteurs, et ils ne disent pas la même chose.
   *
   * `participants` est l'effectif **en course** : il descend quand une
   * inscription est retirée, et l'activation le recompte sur la collection
   * réelle (§4.3). C'est lui qu'on affiche.
   *
   * `registrations` est le nombre d'inscriptions jamais posées ici. Il ne
   * descend pas : c'est la source de `registrationIndex` (D87), et un rang de
   * passage ne se recycle pas — le réattribuer donnerait deux fois le même
   * numéro d'ordre, donc deux slabs qui se disputent une place.
   *
   * `judges` fait les deux à la fois, et le peut : un juré n'est jamais retiré
   * d'un concours — la modération le masque, elle ne l'efface pas (D134) —,
   * donc son effectif est déjà monotone.
   */
  counts: { participants: number; judges: number; registrations: number };
  /**
   * Horodatage du dernier instantané de 18 h (D54, §4.2 bis). Null jusqu'au
   * premier — le lundi 18 h : d'ici là les listes sortent dans l'ordre
   * d'inscription inversé (D87) et tout le monde est à 1200 / 0 vote reçu.
   * Posé par le job de 18 h du lot L4, qui est son seul écrivain.
   */
  snapshotAt: firestore.Timestamp | null;
}

/** Clé = petId. */
export interface ContestParticipantDoc {
  petId: string;
  ownerUid: string;
  petNumber: number;
  petName: string;
  petBreed: string | null;
  species: Species;
  /**
   * Le sexe est dénormalisé comme le nom et la race : l'étiquette d'identité
   * est une empreinte de l'animal, et une empreinte ne va pas rechercher ses
   * pièces ailleurs. Null sur les participants venus du legacy, qui n'en
   * portaient pas — l'icône se tait alors, elle ne devine pas.
   */
  sex: Sex | null;
  /**
   * Le pays est dénormalisé comme le nom et le sexe : l'étiquette d'identité
   * est une empreinte du jour de l'inscription. Null tant que la migration
   * n'est pas passée ; personne d'autre n'écrit null.
   */
  countryCode: string | null;
  photoUrl: string;
  /**
   * Retiré par la modération (D134). La photo **reste** — c'est la preuve du
   * signalement — mais plus rien ne la sert : l'app affiche « photo
   * supprimée » à sa place. Null tant que personne n'est intervenu.
   */
  hiddenAt: firestore.Timestamp | null;
  registrationIndex: number;
  /**
   * L'état de l'animal **à ce concours-ci**, ce concours compris (D90). Posé à
   * l'inscription avec `contests + 1` — le 4e concours affiche « 4 » —, puis
   * regelé à la clôture pour y replier la médaille et le `bestRank` de ce
   * concours. On peut être premier le mardi soir : la médaille n'entre dans
   * l'étiquette qu'une fois le concours terminé.
   *
   * Après la clôture, plus personne n'y touche. Une slab est un objet de
   * collection : celle d'il y a trois mois doit dire ce que l'animal était
   * alors, pas ce qu'il est devenu depuis (D30).
   */
  gradeAtEntry: number;
  statsAtContest: StatsDoc;
  /** En direct, à chaque vote. Lu par l'appariement, jamais par l'utilisateur. */
  elo: number;
  wins: number;
  losses: number;
  duels: number;
  /** En direct aussi : c'est le compteur, pas ce qu'on affiche. */
  votesReceived: number;
  /**
   * Ce que l'utilisateur voit : l'ELO et les votes reçus **au dernier 18 h**
   * (D54). Deux lecteurs, un seul est humain — l'appariement lit le direct,
   * l'écran lit l'instantané. Recopiés depuis les champs vifs par le job de
   * 18 h, et valant 1200 / 0 avant le premier.
   */
  eloSnapshot: number;
  votesReceivedSnapshot: number;
  rank: number | null;
  rankPrevious: number | null;
  createdAt: firestore.Timestamp;
}

/** Clé = userUid. */
export interface ContestJudgeDoc {
  userUid: string;
  judgeNumber: number;
  userName: string;
  userAvatarUrl: string | null;
  /** Dénormalisé comme le nom, même raison que chez le participant. */
  countryCode: string | null;
  /** Avatar retiré par la modération (D134) : conservé, plus servi. */
  hiddenAt: firestore.Timestamp | null;
  /** Rang du premier tour, comme pour les participants (D87). */
  registrationIndex: number;
  /** Le juré à ce concours-ci, ce concours compris (D90). Cf. le participant. */
  gradeAtEntry: number;
  statsAtContest: StatsDoc;
  /**
   * Le vainqueur du concours, gelé à la clôture. C'est l'image de la slab d'un
   * juré : « j'étais là quand celui-là a gagné ». Un juré n'a pas d'image
   * propre — un participant a sa photo, son seul levier (§4.2 bis) — donc la
   * sienne est empruntée au concours qu'il a jugé. null avant la clôture : il
   * n'y a pas encore de vainqueur, et la slab garde sa jauge de votes.
   */
  winner: { petId: string; name: string; photoUrl: string | null } | null;
  votesPerDay: number[];
  /** En direct : c'est mon budget et mon objectif, pas un classement (§4.9). */
  votes: number;
  /** Les votes posés au dernier 18 h — le classement « jurés les plus actifs ». */
  votesSnapshot: number;
  correctVotes: number;
  difficultyScore: number;
  rank: number | null;
  rankPrevious: number | null;
  seenPairs: string[];
  joinedAt: firestore.Timestamp;
}

/** Clé = `${pairKey}_${userUid}`. */
export interface ContestVoteDoc {
  judgeUserUid: string;
  aPetId: string;
  bPetId: string;
  pickedPetId: string;
  /**
   * Clé de paire pour compter le partage des voix (§3.1). Nécessaire car
   * aPetId/bPetId ne sont pas triés (orientation tirée au sort).
   */
  pairKey: string;
  expectedPicked: number;
  createdAt: firestore.Timestamp;
}
