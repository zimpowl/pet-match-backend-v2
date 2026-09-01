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
- **108 tests**, lint et build verts. Tout a été exercé contre l'émulateur
  Firestore, refus compris.
- **La notion de grade a été retirée partout** (backend et app) : `users.grade`,
  `pets.grade`, `petGradeAtEntry`, `judgeGradeAtEntry`, `contests.tier`. Plus de
  garde de palier nulle part. Réversible — ce sont des champs et un garde.

Rien n'est commité et rien n'est déployé. Projet par défaut `pet-match---debug`,
**jamais** la prod (`pet-match-30417`).

## À faire — L1, migration

Script `src/admin/migrate.ts` séparé, **idempotent**, `--dry-run` par défaut,
même garde anti-prod que `seed.ts`. La table de correspondance champ par champ
est le **§6 de REFONTE**. Points sensibles :

- **Re-clé des participants** : ils sont clés par `userUid` et `petUid` est le
  plus souvent absent. Pour chacun : si `petName` correspond à un pet existant du
  user, réutiliser son id ; sinon créer `pets/{newId}` depuis les champs
  dénormalisés (`petName`, `imageUrl`, `petBreed`).
- **Ordre** : pets d'abord (les participants les référencent), puis contests,
  participants, judges, votes. Les agrégats `pets.stats` et `users.stats` sont
  recalculés **en dernier**, une fois toutes les participations re-clées.
- `difficultyScore` n'est **pas** recalculable rétroactivement (`E` n'a jamais
  été stocké) → 0 sur tout l'historique.
- Les nouveaux champs à initialiser sur l'historique : `snapshotAt` (mettre
  `endAt` pour un concours clos, null sinon), `eloSnapshot` / `votesReceivedSnapshot`
  (= les valeurs vives pour un concours clos), `votesSnapshot`,
  `registrationIndex` sur les jurés, `pairKey` sur les votes.
- Ne **pas** réintroduire `grade` ni `tier`.

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
