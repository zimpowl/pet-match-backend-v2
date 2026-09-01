# Point de reprise — prochains lots

Document de passation, tenu à jour à chaque lot. Le document de référence reste
`~/AndroidStudioProjects/pet-match/REFONTE.md`, et les **fakes de l'app KMP sont
l'implémentation de référence du contrat** (`ContestApi.kt`, `ProfileApi.kt`).
Quand le doc et les DTO Kotlin diffèrent, **les DTO gagnent**.

## Fait

- **L0 — socle** : `models/` + `core/`. ELO flottant (D16), allocation, plafond,
  score de difficulté, classements. Le plafond a été corrigé : `core/cap.ts`
  portait la formule périmée `min(70, round(C(P,2)/3))` au lieu des deux paliers
  du **D85** (`> 20 participants ? 70/10 : 35/5`, bascule à **21**).
- **L2 — lectures** : `getContestsHttp`, `getContestHttp`, `getVoteSessionHttp`,
  `getJudgeHttp`, `getPetHttp`. Plus `firestore.indexes.json` et
  `src/admin/seed.ts`.
- **L3 — écritures** : `joinContestHttp`, `submitVoteHttp`, `createPetHttp`,
  `updatePetHttp`, `updateProfileHttp`.
- **L1 — migration** : `src/admin/migrate.ts` écrit, transformations pures
  testées dans `src/admin/mapping.ts`. **Dry-run passé sur les vraies données
  de `pet-match---debug` : 8865 documents à écrire.** Rien n'a été posé.
- **108 tests**, lint et build verts. Tout a été exercé contre l'émulateur
  Firestore, refus compris.
- **La notion de grade a été retirée partout** (backend et app) : `users.grade`,
  `pets.grade`, `petGradeAtEntry`, `judgeGradeAtEntry`, `contests.tier`. Plus de
  garde de palier nulle part. Réversible — ce sont des champs et un garde.

Rien n'est commité et rien n'est déployé. Projet par défaut `pet-match---debug`,
**jamais** la prod (`pet-match-30417`).

## L1 — migration : écrite, dry-run fait, en attente de deux décisions

```bash
cd functions && npm run migrate -- --project=pet-match---debug             # compte et signale
cd functions && npm run migrate -- --project=pet-match---debug --commit    # écrit
```

Dry-run sur les vraies données : 18 challenges → 18 concours, 307 participants,
366 jurés, **7547 votes tous remappés**, 294 animaux mis à jour + 1 créé,
331 utilisateurs, `counters/sequences` posé. **8865 documents**, aucune
collision d'identifiant.

### Ce que le §6 ne dit pas, et qui a été relevé dans les données

- **Aucun participant ne porte `petUid`** (0 sur 307). La re-clé passe donc
  entièrement par le nom de l'animal chez son propriétaire : 306 retrouvés,
  1 à créer.
- **Les votes référencent des `userUid`**, pas des `petId` : `leftParticipantId`
  est l'id du doc participant, lequel est clé par `userUid`. Il faut donc
  réécrire les trois références, le `pairKey` **et la clé du doc**.
  Les 7547 se remappent tous.
- **Les `seenPairs` des jurés** sont aussi des paires de `userUid` (≈ 25 par
  juré). 272 entrées sur ~9000 référencent un participant absent du concours —
  probablement des paires vues dont le participant a été supprimé depuis. Elles
  sont **écartées** plutôt que réécrites au hasard : au pire un juré pourrait
  revoir une paire dont un animal n'existe plus, et l'appariement ne la servira
  jamais.
- **`REWARDED`** est un quatrième statut legacy que le nouveau modèle n'a pas.
  Il devient `CLOSED` — c'était un concours clos et payé.
- **`birthDate`** est `null` pour 100 animaux et une date ISO `2019-11-21`
  pour les autres. Jamais un Timestamp. Tout format inattendu devient `null`
  plutôt qu'une date inventée.
- L'animal à créer n'a **aucune espèce** déductible (le participant legacy n'en
  porte pas) : il est rangé en `DOG` et le rapport le dit.

### Ce que la migration ne peut pas reconstituer

- **`expectedPicked`** n'a jamais été stocké → posé à 0, et le `difficultyScore`
  de tout l'historique est définitivement perdu (le §6 le dit déjà).
- **`votesPerDay`** : la répartition quotidienne n'a jamais existé. Posée à
  zéro ; seul le total (`votes`) est vrai. Conséquence à connaître : un juré
  d'un concours encore `ACTIVE` récupère une allocation du jour neuve le jour
  de la migration. Sans effet si la bascule se fait à une frontière de cycle.
- **`rankPrevious`** : il n'y a pas de « veille » reconstituable, donc `null`.
  L'écart de 18 h n'existe pas sur l'historique.
- **Les instantanés** `eloSnapshot` / `votesReceivedSnapshot` / `votesSnapshot`
  reçoivent les valeurs vives : c'est la seule vérité disponible. `snapshotAt`
  vaut `endAt` pour un concours clos, `null` sinon.

### ⚠️ Décision à prendre : les 125 anciens `contests`

La collection `contests` de `pet-match---debug` contient déjà **125 documents
d'une génération antérieure à `challenges`** — schéma `category`, `entryFee`,
`petMax`, `reward`, `winnerUid`, statuts `FINISHED` / `IN_PROGRESS` /
`OPEN_FOR_REGISTRATION`, **sans aucune sous-collection**. C'est exactement le
nom de collection que le §3 vise pour v2.

Aucun de leurs ids ne heurte un id de challenge, donc la migration peut écrire
sans rien écraser — et la migration **refuse de tourner** si une collision
apparaît. Les lectures L2 sont par chance épargnées : `orderBy('number')`
exclut les docs sans ce champ, et `where status == "ACTIVE"` ne matche aucun de
leurs statuts.

Mais la collection reste sale, et un `count()` sur `contests` mentira. Deux
issues, et c'est une décision de données, pas de code :

1. **supprimer les 125** — ce sont des données mortes de la v0, remplacées par
   `challenges` ;
2. **les laisser** et vivre avec, en sachant que tout comptage global de
   `contests` est faux.

Rien n'a été supprimé.

## À faire — L4, cycle de vie

- **Activation** sur `startAt` (dimanche 18 h) : figer `maxVotesPerJudge` et
  `maxVotesPerDay` avec `computeMaxVotesPerJudge` / `computeVotesPerDay` sur le
  nombre de participants réel, passer le `DRAFT` en `ACTIVE`, ouvrir le `DRAFT`
  suivant (un seul, tant que les paliers n'existent pas).
- **Le job de 18 h (D38)** — un seul pour tout le monde, sept exécutions par
  cycle. C'est le **seul écrivain** des instantanés :
  - recopier `rank` → `rankPrevious` sur participants et jurés
  - recalculer `rank` : participants avec `compareParticipants`, jurés avec
    `compareJudges` (voir `core/ranking.ts`)
  - recopier `elo` → `eloSnapshot`, `votesReceived` → `votesReceivedSnapshot`,
    `votes` → `votesSnapshot`
  - poser `contests.snapshotAt`
  - notifier, hors de la boucle du batch
- **`onContestClosed`** : rangs finaux, médailles (top 3), agrégats
  `pets.stats` / `users.stats`. Le 7ᵉ soir n'est pas un instantané, c'est la
  clôture : ELO révélés, slab proposée.
- La **justesse** des jurés se calcule ici et nulle part ailleurs : un vote est
  juste si l'animal choisi finit avec un ELO final strictement supérieur à son
  adversaire. `difficultyScore = Σ (1 − expectedPicked)` sur les votes justes.

## À faire — L7, avant la prod

- **Vérifier un jeton Firebase.** Sans ça n'importe qui peut voter ou modifier un
  profil au nom de n'importe qui. Le correctif tient dans `http/identity.ts` :
  `getAuth().verifyIdToken()` sur `Authorization: Bearer`, plus un intercepteur
  Ktor côté app.
- Nettoyer `firestore.indexes.json` des index du legacy (`challenges`, `votes`,
  `instagram_posts`), gardés uniquement parce que les deux backends visent le
  même projet pendant la transition.

## Côté app : `duelVotes` est branché

Fait, de bout en bout, et vérifié à l'écran sur l'émulateur Android :
`ContestApi.SubmitVoteResponse` → `VoteOutcomeModel` → `VotePresenter` →
`VoteUiState.FeedbackUiState` → `VoteScreen`.

- à `duelVotes == 1` : plus de pourcentage, la carte écartée s'éteint, et la
  pastille centrale dit « Premier verdict »
- sinon : les pourcentages comme avant, et la pastille dit
  « Provisoire · N votes » — la mention **provisoire** du §4.5 bis n'existait
  nulle part dans l'UI jusque-là
- la pastille prend la place du badge « VS » : le VS annonce le duel, le verdict
  occupe la même place une fois tranché
- `FakeContestApi` renvoie « premier verdict » un duel sur trois, la proportion
  réelle mesurée en simulation, pour que l'état reste dessiné

Le texte est fabriqué par le presenter, jamais par `main/design` (§4.10).

## Le changement côté app qui reste à faire


Aucun body POST du contrat Kotlin ne porte de `userUid`, et le client Ktor
n'ajoute aucun header. Les endpoints d'écriture lisent donc `userUid` dans la
query **ou** dans le body. Côté app, une ligne par méthode :

```kotlin
@POST("submitVoteHttp")
suspend fun submitVote(
    @Query("userUid") userUid: String,
    @Body request: SubmitVoteRequest,
): SubmitVoteResponse
```

Le query param est préférable au body : il ne touche pas aux `@Serializable`, et
il colle au style des cinq GET qui prennent déjà `userUid` en query.

## Les pièges déjà payés une fois

- **Dans une transaction Firestore, toutes les lectures précèdent toutes les
  écritures.** `nextSequence` fait une lecture : elle doit être appelée avant le
  premier `set`. C'est ce qui a cassé `submitVote` au premier essai.
- **Firestore trie les `null` en premier** en ordre croissant. Un juré créé en
  cours de concours doit donc être posé **dernier**, pas à `rank: null`, sinon il
  apparaît en tête du classement jusqu'au 18 h suivant.
- **Ne jamais recalculer un rang à la lecture.** Le champ `rank` *est*
  l'instantané. C'est aussi ce qui tue les ~66 lectures par ouverture d'app.
- **Ne jamais écrire un champ `*Snapshot` hors du job de 18 h.**
- **`expectedPicked` doit être écrit à chaque vote**, sinon le score de
  difficulté est définitivement perdu.
- **L'anti-doublon `pairKey` est par juré, pas global** (D53).
- **`.eslintrc.js` a été réaligné** sur le style du socle (100 colonnes,
  accolades espacées, pas de JSDoc obligatoire). Le preset `google` seul laissait
  115 erreurs sur L0, et `lint` est un `predeploy`. Ne pas le remettre en l'état.
