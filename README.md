# pet-match-backend-v2

Backend PetMatch v2. Firebase, projet par défaut **`pet-match---debug`** — jamais la prod.
L'ancien backend (`~/WebstormProjects/pet-match-backend`) reste déployé et intact
pendant toute la transition.

## Où sont les règles

Le document de référence est **`~/AndroidStudioProjects/pet-match/REFONTE.md`** :

| Section | Contenu |
|---|---|
| §3 | Modèle de données cible — les six collections, champ par champ |
| §4 | Règles de jeu — allocation, plafond, classements, feedback de vote |
| §4.10 | Contrat d'affichage des slabs — ce que l'app attend, au mot près |
| §5 / §5.1 | Contrat d'API — les endpoints et leurs payloads |
| §6 | Migration des données depuis `challenges` |
| §7 | Découpage en lots L0 → L7 |
| §10 | **Où on en est** : ce qui est fait, la migration, les pièges déjà payés |
| tableau initial | Toutes les décisions D1 → D91, avec ce qui est annulé |

L'app KMP consomme déjà ce contrat. Ses **fakes sont l'implémentation de référence** :
`shared/src/commonMain/kotlin/com/zimpo/petmatch/contest/data/FakeContestApi.kt`
et `profile/data/FakeProfileApi.kt` renvoient exactement les formes attendues.
Quand un endpoint réel répond pareil, on passe `useFakeBackendV2` à `false` et l'app
se branche sans une ligne de changement.

## État

- **L0 — socle** ✅ `models/` et `core/` : ELO (flottant, D16), allocation quotidienne,
  plafond, score de difficulté, classements.
- **L2 — lectures** ✅ les cinq endpoints HTTP, déployables **à côté** des anciennes :
  `getContestsHttp`, `getContestHttp`, `getVoteSessionHttp`, `getJudgeHttp`, `getPetHttp`.
  Plus `firestore.indexes.json` et un script de seed, vérifiés contre l'émulateur
  Firestore : pagination, ordres de listes, instantanés, 404/400.
- **L3 — écritures** ✅ les cinq endpoints POST : `joinContestHttp`, `submitVoteHttp`,
  `createPetHttp`, `updatePetHttp`, `updateProfileHttp`. Gardes isolés en fonctions pures
  (`core/voteRules.ts`, `core/joinRules.ts`, `core/petInput.ts`), séquences du D83 en
  transaction. **175 tests unitaires**, plus **16 tests d'intégration** joués contre
  les émulateurs — dont le point d'authentification, qui n'en avait aucun.
- **L1 — migration** ✅ **terminée**. Trois passes sur la production le
  2026-09-29, la dernière rendant 11 813 documents et 0 compte non migré sur 344.
  `challenges` a ensuite été supprimée et l'outil retiré du dépôt : il vit
  désormais dans l'historique git, avec ses sauvegardes dans `functions/backup/`.
- **L4 — cycle de vie** ✅ `triggers/lifecycle.ts` : un job à 18 h, seule horloge du jeu.
  Activation du dimanche avec figeage du plafond, instantané du soir, clôture avec calcul
  de la justesse, médailles et agrégats, ouverture du brouillon suivant (D88). Vérifié
  contre l'émulateur, notification comprise.

### Ce que L2 a ajouté au modèle du §3

L'instantané de 18 h (D54) demande des champs que le §3 n'avait pas : les valeurs
vives servent l'appariement, les instantanés servent l'écran.

| Doc | Champ | Écrit par |
|---|---|---|
| `contests` | `snapshotAt` | le job de 18 h (L4). null = aucun 18 h passé, donc listes en ordre d'inscription inversé (D87) |
| `.../participants` | `eloSnapshot`, `votesReceivedSnapshot` | le job de 18 h. 1200 et 0 à l'inscription |
| `.../judges` | `votesSnapshot` | le job de 18 h. 0 à l'inscription |
| `.../judges` | `registrationIndex` | l'inscription (L3). `JudgeRow` le porte, comme les participants |

### Où vit chaque règle

| Fichier | Règle |
|---|---|
| `core/notifications.ts` | la copie des notifications, testée au mot près |
| `core/results.ts` | §2.1 — la justesse d'un vote, et elle ne se décide qu'à la clôture |
| `core/voteRules.ts` | tous les gardes du vote, un type de rejet par raison |
| `core/joinRules.ts` | D39 — participant en `DRAFT` seulement ; D89 — pas de limite par joueur |
| `core/petInput.ts` | validation du `PetRequest` ; les champs serveur ne passent jamais |
| `core/share.ts` | §4.5 bis — le partage des voix, seul retour d'un vote |
| `core/microchip.ts` | D68 — quinze chiffres, unicité globale, aucun appel externe |
| `core/cap.ts` | D85 — deux paliers d'allocation, pas une formule |
| `core/ordering.ts` | D87 — inscription inversée avant le premier classement, classement ensuite |
| `core/pagination.ts` | D84 — les curseurs des étiquettes, par numéro de concours |
| `core/pairing.ts` | §4.7 — duels de voisins d'ELO, un animal par session, anti-doublon par juré |
| `api/mappers.ts` | D54 — tout ce qui classe sort gelé au dernier 18 h ; §4.9 — la justesse n'existe qu'à la clôture |
| `api/contract.ts` | le contrat de transport, recopié sur les DTO Kotlin |
| `data/contests.ts` | le budget de lectures du §5 — un `getAll` unique pour tous les blocs `me` |

## Commandes

```bash
cd functions
npm test       # logique pure, sans émulateur          (192 tests)
npm run test:emul  # authentification et porte de version (16 tests)
                   # lance lui-même auth, firestore et functions
npm run build
npm run lint
```

### Les outils d'administration

Tous se lancent **depuis `functions/`** — c'est là qu'est le `package.json` —
et tous sont en simulation par défaut : rien ne s'écrit sans `--commit`.

| Commande | Ce qu'elle fait |
|---|---|
| `npm run backup` | Sauvegarde des collections vers `backup/` |
| `npm run gate` | Lit et écrit la porte de version |
| `npm run links` | Les liens courts : tableau de bord, création, QR code |
| `npm run retention` | Pose la règle d'expiration des pièces d'identité |
| `npm run grades` | Recalcule les grades |
| `npm run tokens` | Nettoie les jetons de notification morts |
| `npm run reports` | Lit et traite les signalements |
| `npm run verifications` | Lit et traite les demandes de confirmation d'identité |
| `npm run seed` | Remplit un projet de debug de données de test |

Sauf `gate`, `reports`, `verifications`, `backup` et `retention`, **tous refusent
un projet dont l'identifiant ne contient pas « debug »**. C'est délibéré : ils
écrasent des données. Le jour d'une bascule, on élargit le garde au projet de
production **nommément**, et on le révoque juste après.

`gate` et `links` n'ont volontairement pas ce garde : ils existent pour tourner
en production. `gate`, parce que c'est là qu'on ferme la porte après une
publication et surtout là qu'on la rouvre en urgence. `links`, parce qu'un lien
créé sur un projet de debug ne mène nulle part et qu'un flyer s'imprime une
fois.

### Les purges

**Il n'y a plus d'outil de purge**, et c'est délibéré. `legacy`, `instagram`,
`mail` et les 125 vestiges v0 de `contests` ont été supprimés de la production le
2026-09-29 — 12 464 documents — puis `admin/cleanup.ts` a été retiré avec
`admin/migrate.ts`. Un outil de suppression dont plus aucune cible n'existe ne
peut que se tromper.

Le jour où une collection devra disparaître, le geste juste sera d'écrire un
script pour **celle-là**, sur le modèle de celui qui vit dans l'historique git :
sauvegarde avant suppression, `--dry-run` par défaut, `recursiveDelete` pour les
sous-collections, garde refusant tout projet qui ne dit pas « debug », et
suppression du script une fois passé.

`npm run backup` reste, en lecture seule, pour prendre une copie avant.

**Les fichiers de `functions/backup/` ne sont pas des restes.** Ce sont les
copies écrites *avant* les suppressions du 2026-09-29 — `instagram_posts.json`,
`challenges.json` et les autres. Firestore est bien vide ; ces fichiers sont la
seule marche arrière, et le dossier est ignoré par git, donc rien n'en part sur
GitHub. Ils ne contiennent aucun secret, seulement des données métier.
Conserve-les ailleurs que sur le portable, ou supprime-les en connaissance de
cause.

### Les liens courts

`pet-match.fr/go/<code>` compte un clic et redirige vers le bon magasin selon le
téléphone : App Store pour un iPhone ou un iPad, Play Store pour un Android, le
site pour tout le reste. Un code par source — une clinique, un post, une
campagne — et c'est ce qui permet de répondre à « est-ce que ça vaut le coup d'y
retourner ? ».

```bash
cd functions

npm run links -- --project=<projet>                                  # le tableau de bord
npm run links -- --project=<projet> --create=<code> --label="…" --commit
npm run links -- --project=<projet> --qr=<code>                      # le QR, en SVG
npm run links -- --project=<projet> --delete=<code> --commit
```

Le tableau de bord donne, par lien, le total, les sept derniers jours et la
répartition iOS / Android / web.

**Ce qui est enregistré, et rien d'autre** : un total, un compteur par jour, un
compteur par plateforme. Pas d'adresse IP, pas d'identifiant, pas de cookie.
C'est un choix d'ingénierie autant qu'un choix de principe — une mesure sans
donnée personnelle n'a besoin ni de bandeau de consentement, ni de registre, ni
d'une ligne dans la politique de confidentialité.

**Un code inconnu ne renvoie jamais d'erreur.** QR mal imprimé, faute de frappe,
lien supprimé : la personne part sur le site. C'est pour ça qu'on peut supprimer
un lien sans se soucier des flyers déjà distribués — ils continueront de mener
quelque part d'utile, simplement sans être comptés. Les compteurs, eux,
disparaissent avec le lien : l'outil les affiche avant d'effacer.

Le QR sort en SVG, en correction d'erreur haute — un flyer se froisse, se tache
et se lit de travers. C'est du vectoriel : il reste net à n'importe quelle taille
d'impression. Les fichiers atterrissent dans `functions/qr/`, ignoré par git
puisqu'ils se régénèrent.

**Un code par clinique, jamais un code pour tous les vétérinaires.** C'est toute
la valeur du dispositif : savoir chez qui réimprimer.

#### Ce qui vit dans le dépôt du site

La fonction `goHttp` ne serait pas joignable sur `pet-match.fr` sans une
réécriture déclarée dans le `firebase.json` de **`pet-match-web`** :

```json
"rewrites": [
  { "source": "/go/**", "function": "goHttp", "region": "us-central1" },
  { "source": "**", "destination": "/index.html" }
]
```

**L'ordre est le sujet.** Si la règle attrape-tout passe devant, le SPA avale le
chemin et la fonction n'est jamais appelée — les liens « marchent » en affichant
la page d'accueil, sans rien compter. C'est la seule façon de casser ce
dispositif, et elle est silencieuse.

### La porte de version

```bash
cd functions

npm run gate -- --project=<projet>                                    # lire
npm run gate -- --project=<projet> --android-latest=200 --ios-latest=5 --commit
npm run gate -- --project=<projet> --android-min=200 --ios-min=5 --commit   # fermer
npm run gate -- --project=<projet> --android-min=0 --ios-min=0 --commit     # rouvrir
```

`--latest` déclare ce qui est **publié sur les magasins** ; `--min` le plus
ancien build encore accepté. L'outil refuse un minimum au-dessus du dernier
publié — c'est ce qui empêche de bloquer tout le monde sur une version que
personne ne peut installer.

Rouvrir est l'issue de secours : une écriture d'un document, effective en moins
d'une minute, sans déploiement.

### Où trouver le reste

- **`OPERATIONS.md`** — ce que le joueur reçoit, les gestes de modération, le
  récit de la bascule en production du 2026-09-29, et les **trois** pièges Cloud
  Run rencontrés ce jour-là. Ses §5 et §6 décrivent une migration qui n'existe
  plus : on les garde parce qu'ils expliquent la forme actuelle des données.
- **`TESTING.md`** et **`DEPLOY.md`**, dans le dépôt de l'app — tester sur un
  appareil réel, et la liste de mise en production côté magasins.

### Les grades, et pourquoi tout le monde est à zéro

L'échelle des sept crans est **en service et automatique**. `computeGradeLevel` et
`raiseGrade` (`core/grade.ts`) sont appelés à chaque clôture de concours
(`triggers/lifecycle.ts`) et à chaque demande de vérification traitée
(`triggers/account.ts`). `users.grade`, `pets.grade`, `gradeAtEntry` et `tier` existent
tous.

| 0 | Novice   | dès l'inscription                   |
| 1 | Confirmé | 4 concours **et** identité vérifiée |
| 2 | Amateur  | 1 médaille                          |
| 3 | Aguerri  | 3 médailles                         |
| 4 | Expert   | 6 médailles dont 1 or               |
| 5 | Maître   | 10 médailles dont 2 or              |
| 6 | Légende  | 15 médailles dont 5 or              |

**C'est une échelle, pas un cumul de points** : le niveau est le plus grand cran dont
*toutes* les conditions jusqu'à lui sont remplies. Donc un profil non vérifié plafonne à
0, même couvert de médailles.

C'est pour ça que **tout le parc est à 0 aujourd'hui**, en production comme en debug : la
vérification d'identité est gratuite mais **manuelle** (D42, D91), et personne n'a encore
été traité. La migration sort d'ailleurs tout le monde à 0 délibérément. Ce n'est pas une
panne, c'est le premier cran qui attend qu'on ouvre le guichet — `npm run verifications`.

### Vérifier les endpoints en local

```bash
npx firebase emulators:start --only firestore,functions --project pet-match---debug
```

Puis, dans un autre terminal, seeder l'émulateur et appeler :

```bash
cd functions && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node lib/admin/seed.js --project=pet-match---debug --commit
```

```bash
curl -s "http://127.0.0.1:5001/pet-match---debug/us-central1/getContestsHttp?userUid=zimpo"
```

### Le seed

`functions/src/admin/seed.ts` pose 816 documents calqués sur `FakeContest.kt` : 14 concours
(le 14 en `DRAFT`, le 13 en cours, le reste clos), 31 participants et 24 jurés par concours,
`zimpo` en 8ᵉ position avec `heureux` et `mia`. Une fois seedé, passer `useFakeBackendV2`
à `false` doit montrer le même écran.

Il est **idempotent** — identifiants fixes, chaque passe réécrit les mêmes documents — et
**`--dry-run` par défaut** : sans `--commit` il ne fait que compter. Un garde refuse tout
projet dont l'id ne contient pas « debug ». La prod n'est jamais une cible.

```bash
npm run seed -- --project=pet-match---debug             # compte à blanc
npm run seed -- --project=pet-match---debug --commit     # écrit
```

### Le rendez-vous de 18 h tient-il sept soirs ? (simulé)

Vérifié par simulation sur le vrai code — même ELO, même K, même appariement — 3000 tirages,
20 participants, 23 jurés, 5 votes/jour :

| Soir | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| le n°1 du soir finit vainqueur | 15 % | 20 % | 25 % | 29 % | 39 % | **51 %** | 100 % |
| le top 3 a bougé depuis hier | — | 93 % | 86 % | 80 % | 75 % | 72 % | 72 % |
| part des animaux dont le rang bouge | — | 88 % | 85 % | 83 % | 81 % | 79 % | 79 % |

Le soir 1 ne tranche rien : 11,5 duels par animal sur 81, le meneur du soir 1 ne gagne
qu'une fois sur sept, et le podium exact est déjà figé dans **0,2 %** des cas. Même au soir 6
le meneur n'est le vainqueur qu'une fois sur deux. Et il se passe quelque chose **chaque**
soir : 4 animaux sur 5 changent de rang, le top 3 change de composition trois fois sur quatre.
C'est exactement ce que dit le §4.2 bis — « on voit les prétendants, pas l'ordre ».

## Points à ne pas perdre de vue

- **Tri des listes (D87)** : avant le premier classement du lundi 18 h, participants
  et jurés sortent dans l'**ordre d'inscription inversé** — dernier inscrit en tête.
  Ensuite, et seulement ensuite, c'est le classement. Le tri est fait côté serveur.
- **Allocation (D85)** : 5 votes/jour et 35 au total ; 10 et 70 dès que le concours
  dépasse **20** participants — donc à 20 pile c'est 5, le palier bascule à 21. Les deux
  valeurs sont **stockées sur le concours** et figées à l'activation (D41), donc réglables
  à la main sans redéploiement : une slab sait sous quelles règles elle a été jouée.
  *L0 avait implémenté la formule périmée* `min(70, round(C(P,2)/3))` — à 20 participants
  elle donnait 63/9 au lieu de 35/5. Corrigé, `core/cap.ts` porte les deux paliers.
- **Inscription (D89)** : tous les animaux d'un joueur peuvent s'inscrire au même
  concours. La clé `participants/{petUid}` suffit à empêcher le doublon.
- **Les votes du jour** sont renvoyés dans **chaque** réponse, lecture comme écriture.
- **Numérotation (D83)** : trois séquences globales — chiens, chats, jurés — plus une
  pour les concours. Incrémentées en transaction, jamais réutilisées.
- Les **skills Firebase** sont dans `.claude/skills/`. Le skill `firebase-firestore`
  demande d'identifier l'édition de l'instance avant toute chose.
- **Tout ce qui classe est un instantané de 18 h (D54)** — l'ELO compris. Ce n'est pas
  « caché avant la clôture », c'est « gelé jusqu'au prochain 18 h ». Concrètement, pour un
  concours qui démarre dimanche 18 h :
  - dimanche 18 h → lundi 18 h : tout le monde à **1200 / 0 vote reçu**, aucun rang. C'est
    la vérité de ce moment, pas une censure.
  - lundi 18 h → mardi 18 h : l'ELO, les votes reçus et le rang **de lundi 18 h**.
  - et ainsi de suite, six instantanés puis la clôture. Un concours clos ne bouge plus :
    on lit ses valeurs vives, elles *sont* définitives.

  Deux lecteurs, un seul est humain : **l'appariement lit `elo` en direct**, l'écran lit
  `eloSnapshot`. Même règle sur l'écran Concours et sur les profils, sans exception.
- **Les deux seules choses en direct** : mes votes restants aujourd'hui (`dailyVotes` et
  `me.votes.cast` — c'est mon budget, pas le classement des autres) et le **pourcentage du
  duel** que je viens de juger, renvoyé par `submitVote` (§4.5 bis). C'est le seul endroit
  fun, et ça rend inutile d'aller regarder le concours : le pourcentage y est en temps réel.
  Jamais d'ELO dans ce retour.
- **La justesse d'un juré n'est pas gelée, elle est inconnue** avant la clôture (§4.9) :
  un vote est juste si l'animal choisi finit devant. `correctVotes` reste donc à 0 d'ici là,
  et le classement s'appelle « jurés les plus actifs » (D11), sur les votes posés — gelés
  eux aussi.
- **`firestore.indexes.json` ne porte plus que les index v2** — dix, plus une exception de
  champ. Les index du legacy en ont été retirés au commit `85cc0e6`. Comme les deux
  backends visent le **même** projet, le risque est donc désormais **inversé** : un
  `firebase deploy --only firestore:indexes` depuis ici **proposera de supprimer** les
  index de l'ancien, encore déployé. Répondre non tant que le legacy sert ; ne les laisser
  partir qu'après la purge, avec `--force`.
- **`.eslintrc.js` a été réaligné sur le style du socle** : 100 colonnes, accolades
  espacées, pas de JSDoc obligatoire. Le preset `google` seul laissait 115 erreurs sur L0,
  et `lint` est un `predeploy` — le déploiement échouait avant même de commencer.
- **Le partage des voix repose souvent sur une poignée de votes.** Mesuré par simulation :
  la médiane est de **4 votes par duel**, et **une fois sur cinq le juré est le premier** à
  voir ce duel. `submitVote` renvoie donc `duelVotes` — le compte brut, le vote de
  l'appelant compris. À 1, l'app doit dire « premier verdict » et non `100 %`, qui se lirait
  « tout le monde est d'accord avec moi » au lieu de « personne d'autre n'a voté ».
  Le pourcentage inclut délibérément mon propre vote : l'exclure donnerait `50 % / 50 %` au
  premier votant, soit « la foule est partagée » alors qu'il n'y a pas de foule.
  L'affichage est branché côté app (voir §10.7 de REFONTE.md) : à `duelVotes == 1` la page Vote
  retire les pourcentages, éteint la carte écartée et affiche « Premier verdict » ; sinon
  « Provisoire · N votes », qui apporte au passage la mention *provisoire* du §4.5 bis.
- **Un vote est juste si l'animal choisi finit avec un ELO final strictement supérieur à son
  adversaire de ce duel** — l'ELO **final**, à la clôture, pas celui du moment du vote, et
  comparé au seul adversaire du duel. Égalité = neutre. Si c'était l'ELO du moment,
  « je clique toujours sur le plus haut » serait une stratégie parfaite ; comme l'appariement
  oppose des voisins, copier plafonne à ~55 % contre 87 % pour qui regarde vraiment.
  Ne pas confondre trois chiffres : `expectedPicked` est la **prédiction** des ELO vifs à
  l'instant du vote (elle sert au `difficultyScore`), `aSharePercent` est l'**observation**
  des votes sur cette paire, la justesse est le **verdict** des ELO finaux.
- **On devient juré au premier vote**, zéro friction : `submitVote` crée
  `contests/{id}/judges/{uid}` s'il n'existe pas et tire son `judgeNumber` de la séquence
  globale (D83). Il n'y a pas de `joinAsJudge`. Corollaire du D39 : les participants
  s'inscrivent en `DRAFT` seulement, les jurés arrivent sur un `ACTIVE` quand ils veulent.
- **Un juré arrivé en cours de concours est posé dernier**, pas à `rank: null` : Firestore
  trie les `null` **en premier** en ordre croissant, donc un nouveau juré apparaîtrait en
  tête du classement jusqu'au 18 h suivant. Avant le premier instantané il reste bien à
  null, puisque la liste sort alors dans l'ordre d'inscription inversé (D87).
- **Le registre des notifications n'est pas négociable** : aucun emoji, aucun point
  d'exclamation, aucune félicitation, **vouvoiement**. Le luxe ne complimente pas, il
  constate. Des tests vérifient l'absence d'emoji, de `!`, de « bravo » et de tutoiement.
- **La notification constate le changement, jamais le rang** (§4.2 bis) : donner le rang
  rendrait l'ouverture de l'app inutile et tuerait le rendez-vous de 18 h. Le fait est
  dans l'app, la notification n'est qu'une invitation. Un test vérifie qu'aucun chiffre
  ne fuite. La clôture, elle, ne dit **que** la clôture — en révéler le sens l'éventerait.
- **On ne genre jamais l'animal** : le doc participant ne porte pas son sexe, et se
  tromper est pire que tout. « Heureux tient la première place » accorde l'adjectif avec
  « place », jamais avec l'animal. Toute formule gendrée est un bug.
- **Une notification par joueur et par soir**, même s'il est à la fois participant et
  juré : la nouvelle de son animal prend le titre, sa position de juré tient dans le
  corps. Et un rang immobile hors du podium ne notifie **rien** — une notification vide
  tue l'effet des autres (§8 point 6).
- **Une requête de groupe de collections matche par nom de sous-collection**, sans
  regarder le parent : `collectionGroup("judges")` ramasse n'importe quel
  `…/{id}/judges`. Tant que `challenges/` a coexisté avec `contests/`, la même
  requête rendait deux fois le même uid. La protection est `contestOf()` de
  `collections.ts`, qui vérifie que le grand-parent est bien `contests` — et non
  un `orderBy` choisi pour son absence côté legacy, qui aurait été fragile.
  `challenges` a disparu le 2026-09-29 ; le garde reste, parce qu'il est vrai
  sans elle.
- **`set(..., { merge: true })` n'interprète pas les chemins pointés**, contrairement à
  `update()`. Écrire `{ "stats.gold": 1 }` dans un `set` crée un champ littéralement nommé
  `stats.gold` à côté de `stats`. Il faut un objet imbriqué : `{ stats: { gold: 1 } }`, qui
  se fusionne correctement. C'est le piège qui a silencieusement pollué les documents au
  premier essai du job de 18 h — aucune erreur, juste des agrégats qui ne bougeaient pas.
- **`bestRank` est un minimum, et aucun `FieldValue` ne sait faire un minimum.** La clôture
  relit donc les documents `pets` et `users` au lieu d'incrémenter à l'aveugle.
- **Dans une transaction Firestore, toutes les lectures précèdent toutes les écritures.**
  `nextSequence` fait une lecture : elle doit être appelée **avant** le premier `set`.
  C'est le piège qui a cassé `submitVote` au premier essai.
- **Le jeton Firebase fait foi** (commit `6743384`). Le client Ktor pose un en-tête
  `Authorization: Bearer` sur chaque appel, et `http/identity.ts` le vérifie par
  `getAuth().verifyIdToken()` : l'identité vient du jeton, jamais du `userUid` déclaré.
  Une requête qui présente un jeton valide pour un compte et réclame un autre `userUid`
  agit sous le compte du jeton.
- **Le repli sur le `userUid` déclaré n'existe que sur un projet de debug**, pour le compte
  d'essai qui n'a pas de session Firebase. Hors debug, pas de jeton, pas d'appel — 403.
- **Firestore `pet-match---debug`** : édition **STANDARD**, type `FIRESTORE_NATIVE`.
