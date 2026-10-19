# pet-match-backend-v2

Le backend PetMatch. Firebase, deux projets : **`pet-match---debug`** (défaut de
la CLI, dans `.firebaserc`) et **`pet-match-30417`** (production, qui ne se vise
jamais que `--project` à la main). Les deux tournent en v2 depuis la bascule du
2026-09-29 ; il n'y a plus aucun backend legacy en service.

| Fichier | Pour |
|---|---|
| **`OPERATIONS.md`** | les commandes du quotidien — signalements, pièces d'identité, grades, porte de version, liens courts, déploiement |
| **`MIGRATION.md`** | la seule migration qui reste à faire, et dans quel ordre |

## Où sont les règles

Le document de référence est **`~/AndroidStudioProjects/pet-match/REFONTE.md`** :

| Section | Contenu |
|---|---|
| §3 | Modèle de données — les collections, champ par champ |
| §4 | Règles de jeu — allocation, plafond, classements, feedback de vote |
| §4.10 | Contrat d'affichage des slabs, au mot près |
| §5 / §5.1 | Contrat d'API — les endpoints et leurs payloads |
| §10 | Où on en est, et les pièges déjà payés |
| tableau initial | Toutes les décisions D1 → D140, avec ce qui est annulé |

### Où vit chaque règle, ici

| Fichier | Règle |
|---|---|
| `core/career.ts` | D138 — le palmarès n'a qu'une source : le document du porteur |
| `core/grade.ts` | D123 — les sept crans, et les seuils vivent dans `LADDER` seul |
| `core/notifications.ts` | la copie des notifications, testée au mot près |
| `core/results.ts` | §2.1 — la justesse d'un vote, et elle ne se décide qu'à la clôture |
| `core/voteRules.ts` | tous les gardes du vote, un type de rejet par raison |
| `core/joinRules.ts` | D39 — participant en `DRAFT` seulement ; D89 — pas de limite par joueur |
| `core/petInput.ts` | validation du `PetRequest` ; les champs serveur ne passent jamais |
| `core/share.ts` | §4.5 bis — le partage des voix, seul retour d'un vote |
| `core/microchip.ts` | D68 — quinze chiffres, unicité globale, aucun appel externe |
| `core/cap.ts` | D85 — deux paliers d'allocation, pas une formule |
| `core/ordering.ts` | D87 — inscription inversée avant le premier classement |
| `core/pagination.ts` | D84 — les curseurs des étiquettes, par numéro de concours |
| `core/pairing.ts` | §4.7 — duels de voisins d'ELO, anti-doublon par juré |
| `api/mappers.ts` | D54 — tout ce qui classe sort gelé au dernier 18 h |
| `api/contract.ts` | le contrat de transport, recopié sur les DTO Kotlin |
| `data/contests.ts` | le budget de lectures du §5 — un `getAll` unique pour tous les blocs `me` |
| `data/careers.ts` | les palmarès du jour, groupés en un aller-retour |
| `triggers/lifecycle.ts` | L4 — un job à 18 h, seule horloge du jeu |

## Travailler ici

```bash
cd functions
npm test           # logique pure, sans émulateur            (185 tests)
npm run test:emul  # authentification et porte de version     (16 tests)
npm run build
npm run lint
```

Le reste — émulateur, seed, outils d'administration, déploiement — est dans
`OPERATIONS.md`.

## Instagram : le Reel du podium

Le script vit à côté des modèles Instagram, dans l'app :
`~/AndroidStudioProjects/pet-match/store-assets/instagram/modeles/reel_podium.py`.
Il lit l'API publique de **prod** (lecture seule, rien n'est écrit en base) et
fabrique le Reel du podium d'un concours terminé.

```bash
cd ~/AndroidStudioProjects/pet-match/store-assets/instagram/modeles
python3 reel_podium.py                 # le dernier concours terminé
python3 reel_podium.py Automne Sieste  # les concours nommés
python3 reel_podium.py --tous          # tous les concours terminés
```

| Image | Durée | Contenu |
|---|---|---|
| Titre | 2,8 s | « Résultats », le thème, puis la ligne de l'app : « Terminé le JJ/MM · patte N · maillet N » |
| 3e, 2e | 3,2 s chacune | la carte, centrée, avec un léger zoom |
| 1er | 4,2 s | la carte du vainqueur |
| Fin | 3,2 s | le concours qui prend les inscriptions : « Commence le JJ/MM · patte N · maillet N », la clôture des inscriptions, « Lien en bio » |

- **Sortie** : `sortie/<date>/reel-podium-<thème>.mp4` (1080 × 1920, H.264), et
  les images dans `sortie/<date>/reel-podium-<thème>/`.
- **Il faut** Google Chrome (rendu des modèles) et `ffmpeg` (`brew install ffmpeg`).
- **Sans musique** : ajouter un son tendance dans Instagram au moment de publier.
- La fin est sautée s'il n'y a aucun concours en `DRAFT`. Un concours sans
  podium (aucun rang 1 à 3 avec photo) est ignoré, avec un message.
- Les durées se règlent en haut du script (`TITLE`, `CARD`, `WINNER`, `END`) ;
  le dessin des images est dans `modeles.html` (modèles `titre` et `carte`).

Les autres visuels Instagram (stories, autres Reels) passent par `publier.py`,
dans le même dossier ; le calendrier est dans `store-assets/instagram/STRATEGIE.md`.

---

## Points à ne pas perdre de vue

- **Le palmarès n'a qu'une source (D138)** : `pets.stats` et `users.stats`. Une
  participation n'en garde aucune copie. Si le coût de lecture devient un
  problème, la réponse est un cache, jamais une seconde vérité.
- **Tout ce qui classe est un instantané de 18 h (D54)** — l'ELO compris. Ce
  n'est pas « caché avant la clôture », c'est « gelé jusqu'au prochain 18 h ».
  Du dimanche 18 h au lundi 18 h, tout le monde est à **1200 / 0 vote reçu** et
  sans rang : c'est la vérité de ce moment, pas une censure. Deux lecteurs, un
  seul est humain — **l'appariement lit `elo` en direct**, l'écran lit
  `eloSnapshot`. Un concours clos ne bouge plus : ses valeurs vives *sont*
  définitives.
- **Les deux seules choses en direct** : mes votes restants aujourd'hui (c'est
  mon budget, pas le classement des autres) et le **pourcentage du duel** que je
  viens de juger. Jamais d'ELO dans ce retour.
- **La justesse d'un juré n'est pas gelée, elle est inconnue** avant la clôture :
  un vote est juste si l'animal choisi finit devant. `correctVotes` reste donc à
  0 d'ici là, et le classement s'appelle « jurés les plus actifs » (D11).
- **Un vote est juste si l'animal choisi finit avec un ELO final strictement
  supérieur** à son adversaire de ce duel — l'ELO **final**, pas celui du moment.
  Si c'était celui du moment, « je clique toujours sur le plus haut » serait une
  stratégie parfaite ; comme l'appariement oppose des voisins, copier plafonne à
  ~55 % contre 87 % pour qui regarde vraiment. Ne pas confondre trois chiffres :
  `expectedPicked` est la **prédiction**, `aSharePercent` l'**observation**, la
  justesse le **verdict**.
- **Le partage des voix repose souvent sur une poignée de votes** : médiane de 4
  par duel, et une fois sur cinq le juré est le premier. D'où `duelVotes` dans la
  réponse — à 1, l'app dit « premier verdict » et non `100 %`, qui se lirait
  « tout le monde est d'accord avec moi ».
- **Tri des listes (D87)** : avant le premier classement, participants et jurés
  sortent dans l'**ordre d'inscription inversé**. Ensuite seulement, c'est le
  classement. Le tri est fait côté serveur.
- **Allocation (D85)** : 5 votes/jour et 35 au total ; 10 et 70 dès que le
  concours dépasse **20** participants — à 20 pile c'est 5, le palier bascule à
  21. Les deux valeurs sont **stockées sur le concours** et figées à
  l'activation, donc réglables sans redéploiement.
- **On devient juré au premier vote**, zéro friction : `submitVote` crée le
  document s'il n'existe pas. Il n'y a pas de `joinAsJudge`.
- **Un juré arrivé en cours de concours est posé dernier**, pas à `rank: null` :
  Firestore trie les `null` **en premier** en ordre croissant.
- **Le registre des notifications n'est pas négociable** : aucun emoji, aucun
  point d'exclamation, aucune félicitation, **vouvoiement**. Le luxe ne
  complimente pas, il constate. Des tests le vérifient.
- **Une notification invite, elle n'informe pas** : venir voter, ne pas perdre
  ses votes, venir voir où l'on en est. Jamais un rang : la clôture dit que
  c'est tombé, l'app dit le reste. Les soirs de semaine ne notifient **rien** —
  le classement se recalcule et se lit dans l'app, le résultat c'est le dimanche.
- **On ne genre jamais l'animal.** « L'identité de Nala est validée » accorde
  avec « identité », jamais avec l'animal. Toute formule gendrée est un bug.
- **Une notification par joueur et par soir**, même s'il est à la fois
  participant et juré : le dimanche, qui reçoit la clôture ne reçoit pas
  l'ouverture.
- **Le motif d'un refus de pièce ne part jamais en notification** : il est tapé
  pour l'écran d'identité, pas pour un volet de notification.
- **Une requête de groupe de collections matche par nom de sous-collection**,
  sans regarder le parent. La protection est `contestOf()` de `collections.ts`.
  `challenges` a disparu le 2026-09-29 ; le garde reste, parce qu'il est vrai
  sans elle.
- **`set(..., { merge: true })` n'interprète pas les chemins pointés**,
  contrairement à `update()`. `{ "stats.gold": 1 }` crée un champ littéralement
  nommé `stats.gold` à côté de `stats`. Il faut `{ stats: { gold: 1 } }`. Aucune
  erreur n'est levée : les agrégats ne bougent simplement pas.
- **`bestRank` est un minimum, et aucun `FieldValue` ne sait faire un minimum.**
  La clôture relit donc les documents au lieu d'incrémenter à l'aveugle.
- **Dans une transaction Firestore, toutes les lectures précèdent toutes les
  écritures.** `nextSequence` fait une lecture : elle doit être appelée **avant**
  le premier `set`.
- **Le jeton Firebase fait foi.** Le client Ktor pose un `Authorization: Bearer`
  sur chaque appel, et `http/identity.ts` le vérifie : l'identité vient du jeton,
  jamais du `userUid` déclaré. Le repli sur le `userUid` déclaré n'existe que sur
  un projet de debug, pour le compte d'essai sans session Firebase.
- **`.eslintrc.js` est réaligné sur le style du socle** (100 colonnes, accolades
  espacées, pas de JSDoc obligatoire). Ne pas remettre le preset `google` seul :
  il laisse plus de cent erreurs, et `lint` est un `predeploy`.
- **Les fichiers de `functions/backup/` ne sont pas des restes.** Ce sont les
  copies écrites *avant* les suppressions du 2026-09-29, et la seule marche
  arrière. Le dossier est ignoré par git. Les conserver ailleurs que sur le
  portable, ou les supprimer en connaissance de cause.
- **Firestore `pet-match---debug`** : édition **STANDARD**, type
  `FIRESTORE_NATIVE`.
