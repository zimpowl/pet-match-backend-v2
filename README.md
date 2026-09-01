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
| tableau initial | Toutes les décisions D1 → D89, avec ce qui est annulé |

L'app KMP consomme déjà ce contrat. Ses **fakes sont l'implémentation de référence** :
`shared/src/commonMain/kotlin/com/zimpo/petmatch/contest/data/FakeContestApi.kt`
et `profile/data/FakeProfileApi.kt` renvoient exactement les formes attendues.
Quand un endpoint réel répond pareil, on passe `useFakeBackendV2` à `false` et l'app
se branche sans une ligne de changement.

## État

- **L0 — socle** ✅ `models/` et `core/` : ELO (flottant, D16), allocation quotidienne,
  plafond, score de difficulté, classements. Aucun endpoint. 24 tests.
- **L2 — lectures** ⬅️ prochaine étape. `getContests`, `getContest`, `getJudge`,
  `getPet`, `getVoteSession`, déployées **à côté** des anciennes. Plus un script de
  seed et les index Firestore. Le §5 fixe le budget de lectures à viser.
- **L3 — écritures**, **L1 — migration**, **L4 — cycle de vie** : ensuite, dans cet ordre.
  Les lectures d'abord parce qu'elles seules débloquent la bascule du flag.

## Commandes

```bash
cd functions
npm test     # tsc -p tsconfig.test.json && node --test  (24 tests)
npm run build
npm run lint
```

## Points à ne pas perdre de vue

- **Tri des listes (D87)** : avant le premier classement du lundi 18 h, participants
  et jurés sortent dans l'**ordre d'inscription inversé** — dernier inscrit en tête.
  Ensuite, et seulement ensuite, c'est le classement. Le tri est fait côté serveur.
- **Allocation (D85)** : 5 votes/jour et 35 au total ; 10 et 70 dès que le concours
  dépasse 20 participants. Des constantes, changées en redéployant.
- **Inscription (D89)** : tous les animaux d'un joueur peuvent s'inscrire au même
  concours. La clé `participants/{petUid}` suffit à empêcher le doublon.
- **Les votes du jour** sont renvoyés dans **chaque** réponse, lecture comme écriture.
- **Numérotation (D83)** : trois séquences globales — chiens, chats, jurés — plus une
  pour les concours. Incrémentées en transaction, jamais réutilisées.
- Les **skills Firebase** sont dans `.claude/skills/`. Le skill `firebase-firestore`
  demande d'identifier l'édition de l'instance avant toute chose.
