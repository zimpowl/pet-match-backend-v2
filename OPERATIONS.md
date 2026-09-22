# Exploiter PetMatch

Ce qui se décide à la main, comment le faire, et ce que le joueur en apprend.
Tout se passe en ligne de commande depuis `functions/`, et **rien n'écrit sans
`--commit`** : le défaut est toujours un essai à blanc.

Les outils refusent tout projet dont l'identifiant ne contient pas « debug ».
Pour la production, il faudra lever cette garde sciemment.

---

## 1. Ce que le joueur reçoit

| Événement | Notification | Courrier | Déclenché par |
|---|---|---|---|
| Résultat du soir (18 h) | oui | non | `dailyCycle` |
| Clôture d'un concours | oui | non | `dailyCycle` |
| Rappel de vote (15 h) | oui | non | `dailyReminder` |
| **Niveau atteint** | oui | oui | `grade.level` monte |
| **Identité confirmée** | oui | oui | `isVerified` / `verifiedAt` |
| **Pièce refusée** | oui | oui | demande passée à `REJECTED` |
| **Photo retirée** | oui | oui | `hiddenAt` posé |
| **Compte suspendu** | oui | oui | `suspendedUntil` posé |

Les quatre dernières sont des **nouvelles du dossier**. Elles ne parlent pas du
jeu : elles disent ce qui est arrivé à un compte, et aucun écran ne l'apprendra
à qui n'ouvre pas l'app.

## 2. Les trois interrupteurs

Dans les réglages de l'app, et stockés dans `users/{uid}.notifications` :

- **Résultats du soir** — coupe le classement de 18 h et la clôture.
- **Rappel de vote** — coupe le mot de 15 h.
- **Recevoir un mail** — coupe le **courrier** des nouvelles du dossier. Ce
  réglage **n'est pas affiché** tant que l'extension de courrier n'est pas
  installée : il ne servirait qu'à couper ce que personne ne reçoit. Le champ
  `notifications.email` existe et vaut oui ; remettre la ligne dans
  `SettingsPresenter` suffira.

Les nouvelles du dossier **partent toujours en notification**, quels que soient
les deux premiers interrupteurs. On ne choisit pas d'ignorer qu'une photo a été
retirée. Seule la trace écrite est un choix. La règle vit dans `wanted()`,
`functions/src/data/notify.ts`.

## 3. Les gestes

### Signalements

```bash
cd functions
npm run reports -- --project=pet-match---debug                              # la file
npm run reports -- --project=pet-match---debug --id=<id> --close --commit      # vu, rien à faire
npm run reports -- --project=pet-match---debug --id=<id> --hide --commit       # l'image signalée se tait
npm run reports -- --project=pet-match---debug --id=<id> --show --commit       # et elle reparaît
npm run reports -- --project=pet-match---debug --id=<id> --withdraw --commit   # hors des concours ouverts
npm run reports -- --project=pet-match---debug --id=<id> --suspend=14 --commit # et le compte aussi
npm run reports -- --project=pet-match---debug --id=<id> --takedown --commit   # tout d'un coup
```

`--hide` **ne supprime rien** : la photo reste en base, c'est la preuve du
signalement. Elle n'est plus servie, et l'app affiche « photo supprimée » à sa
place.

Il vise **une image**, pas un profil. Un animal en porte plusieurs — celle de sa
fiche, et une par inscription qu'il a pu changer — et le signalement dit
laquelle était affichée. Seuls les documents qui portent cette image-là se
taisent ; les autres photos restent servies. Fermer un compte ne masque rien :
les concours gardent la photo qu'ils ont recopiée, c'est `--hide` et lui seul
qui cache.

`--show` fait le geste inverse, et celui-là **rend tout** : l'asymétrie permet
de défaire un masquage trop large sans avoir à deviner ce qu'il avait emporté.

`--withdraw` ne touche que les concours non clos — un concours clos garde ses
participations, les défaire referait le palmarès de gens qui n'ont rien demandé.
Tous ferment le signalement.

`--hide` et `--suspend` déclenchent chacun une notification et un courrier.

### Pièces d'identité

```bash
npm run verifications -- --project=pet-match---debug                                  # la file
npm run verifications -- --project=pet-match---debug --id=<id> --download              # la pièce, en local
npm run verifications -- --project=pet-match---debug --id=<id> --accept --commit
npm run verifications -- --project=pet-match---debug --id=<id> --refuse="motif" --commit
```

La file imprime, sous chaque demande, le nom du fichier, son type et un **lien
cliquable** vers la console Firebase pour le voir ou le télécharger. Le lien
passe par la console et jamais par une URL de téléchargement : `documents/` est
fermé en lecture pour tout le monde dans `storage.rules`, et un lien à jeton
contournerait précisément cette règle. La console demande d'être membre du
projet — c'est la bonne porte.

Sans `--accept` ni `--refuse`, `--id` affiche la demande complète : qui, quel
animal, quels fichiers, avec les mêmes liens.

Ce que le joueur peut déposer : une **photo ou un PDF**, dix mégaoctets au plus,
sur les deux apps.

La pièce **reste dans le bucket après la décision** : c'est la trace de ce qui a
été confirmé, et elle doit pouvoir être reproduite. `--download` la récupère en
local — `pieces/<id>/` par défaut, `--download=<dossier>` ailleurs — sans rien
écrire ni décider. Ce dossier sort de Firebase : il ne va pas dans le dépôt.

Elle ne reste pas pour toujours. **Cinq ans**, posés sur le bucket lui-même :

```bash
npm run retention -- --project=pet-match---debug            # ce qui est en place
npm run retention -- --project=pet-match---debug --commit   # la règle des cinq ans
```

Google Cloud Storage efface alors chaque pièce cinq ans après son dépôt, sans
que personne ait à y penser. La commande est idempotente : elle dit si la règle
est déjà là. **À passer une fois par projet**, debug comme prod.

Et **fermer un compte les efface avant l'échéance** : une pièce justifie une
confirmation, elle ne justifie plus rien quand le compte n'existe plus.
`deleteAccountHttp` vide le préfixe `documents/<uid>/` et détache les demandes.

`--accept` lève la
confirmation, ce qui **relève le grade dans la seconde** et envoie les deux
nouvelles — « identité confirmée », puis « grade 1 ». `--refuse` envoie le
motif tel qu'écrit : il sera lu par le joueur, mot pour mot.

### Grades

```bash
npm run grades -- --project=pet-match---debug --commit
```

Recalcule et relève tous les grades. Utile après une correction de données ; en
temps normal le cycle de 18 h et la confirmation d'identité suffisent. Un grade
ne redescend jamais, et chaque cran franchi garde sa date.

## 4. Où ça se déclenche

Trois déclencheurs Firestore, dans `functions/src/triggers/account.ts`. Ils
regardent les documents changer, quel que soit **qui** les change — un outil,
un script, ou la console Firebase à la main.

| Fonction | Document | Ce qu'elle regarde |
|---|---|---|
| `onUserChanged` | `users/{uid}` | `isVerified`, `grade.level`, `suspendedUntil`, `hiddenAt` |
| `onPetChanged` | `pets/{petUid}` | `verifiedAt`, `grade.level`, `hiddenAt` |
| `onVerificationReviewed` | `verifications/{id}` | passage à `REJECTED` |

C'est pour ça que modifier un champ **à la main dans la console** prévient
quand même le joueur. Il n'y a pas de porte dérobée.

Un cran : `onUserChanged` relève le grade, ce qui réécrit le document et le
rappelle. Au second passage seul le grade a bougé — la nouvelle du grade part,
une seule fois.

Les journaux :

```bash
npx firebase functions:log --only onUserChanged --project pet-match---debug
```

## 5. Le courrier

Rien n'envoie de mail aujourd'hui. Le code **met en file** : il écrit un
document dans la collection `mail`, au format attendu par l'extension Firebase
**Trigger Email from Firestore**. Les documents s'empilent sans partir, et
c'est sans conséquence — l'extension installée, l'arriéré part avec le reste.

À installer une fois, par projet :

```bash
cd functions
npx firebase ext:install firebase/firestore-send-email --project pet-match---debug
```

L'installateur pose ses questions. Ce qu'il faut répondre :

| Question | Réponse |
|---|---|
| Firestore Instance ID | `(default)` |
| Firestore Instance Location | `europe-west1` — celle de la base |
| Authentication Type | `UsernamePassword` (ou `OAuth2` selon le fournisseur) |
| SMTP connection URI | `smtps://<utilisateur>@<hôte>:465` — **sans le mot de passe** |
| SMTP password | le mot de passe, stocké en secret |
| Email documents collection | **`mail`** — c'est là qu'écrit le code |
| Default FROM address | l'expéditeur, par exemple `PetMatch <ne-pas-repondre@pet-match.fr>` |
| Firestore TTL type / value | `Day` / `7` — les messages traités s'effacent au bout d'une semaine |

Le mot de passe va dans **SMTP password**, jamais dans l'URI : le champ est un
secret, l'URI est stockée en clair dans la configuration de l'extension.

Tant que l'extension n'est pas là, les documents s'empilent sans partir — et
rien d'autre ne casse. Une fois installée, la file part toute seule, **y
compris l'arriéré**.

L'adresse n'est **jamais recopiée** dans Firestore : elle est lue dans Firebase
Auth au moment de l'envoi. Un compte sans adresse — le faux compte de debug,
par exemple — ne reçoit rien, sans erreur.

## 6. Basculer en production

Le projet de production est **`pet-match-30417`**. Rien n'y a encore été
déployé : tout ce qui suit a été éprouvé sur `pet-match---debug` et n'a jamais
tourné en vrai.

### Ce qu'il faut décider avant

- **L'ancienne app s'éteint-elle ce jour-là ?** Supprimer `challenges` coupe le
  backend legacy, donc l'app encore installée chez les joueurs. Tant que la
  réponse est non, on migre sans nettoyer.
- **Qui reçoit le courrier ?** L'extension d'envoi doit être installée sur le
  projet de production avec ses propres identifiants SMTP, séparés de ceux de
  debug.

### Les gardes à lever

Neuf outils refusent tout projet dont l'identifiant ne contient pas « debug ».
C'est délibéré : ils écrasent des données.

```
migrate  cleanup  purge  schedule  seed  grades  nationality  tokens
```

Plus, dans `functions/src/triggers/lifecycle.ts`, les déclenchements manuels
`runCycleHttp` et `runRemindersHttp`.

La garde est la même partout, une ligne par fichier :

```ts
if (!emulated && !/debug/i.test(projectId)) throw new Error(...);
```

**Ne pas la retirer.** L'élargir au projet de production nommément, le jour où
on en a besoin, et la remettre après. Un outil qui accepte n'importe quel
projet finit par tourner sur le mauvais.

`reports` et `verifications` n'ont pas cette garde : ils sont faits pour
tourner en production, et ne détruisent rien.

Une garde reste en place quoi qu'il arrive : celle de `http/identity.ts`. En
production, **pas de jeton, pas d'appel** — le repli sur l'uid déclaré n'existe
que sur un projet de debug.

### L'ordre

```bash
cd functions

# 1. le code, les index, l'extension
npx firebase deploy --only functions --project pet-match-30417
npx firebase deploy --only firestore:indexes --project pet-match-30417
npx firebase ext:install firebase/firestore-send-email --project pet-match-30417

# 2. la sauvegarde, avant tout
npm run retention -- --project=pet-match-30417 --commit
npm run backup -- --project=pet-match-30417 --collection=challenges,pets,users

# 3. la migration, à blanc puis pour de vrai
npm run migrate -- --project=pet-match-30417
npm run migrate -- --project=pet-match-30417 --commit

# 4. vérifier l'app de bout en bout, sur la variante prodEnv

# 5. seulement si l'ancienne app est éteinte
npm run cleanup -- --project=pet-match-30417 \
  --collection=challenges,contests,matches,posts --commit
```

La migration est **rejouable** : elle lit `challenges` et réécrit par-dessus.
Le nettoyage, non — il supprime la source. C'est pour ça qu'il est dernier, et
qu'il sauvegarde avant de supprimer.

### Ce qui doit exister côté app

- Construire la variante **`prodEnv`**, qui pointe sur
  `us-central1-pet-match-30417.cloudfunctions.net` et sur l'identifiant Google
  de production. La variante `debugEnv` porte le suffixe `.debug` : les deux
  s'installent côte à côte.
- `useFakeAuth` vaut `false` sur Android, et suit le binaire sur iOS — un build
  de release ne peut pas y entrer.
- Les fichiers `GoogleService-Info-Prod.plist` et `google-services.json` de
  production doivent être ceux du bon projet.

### Ce qui doit exister côté site

La vitrine `www.pet-match.fr` (dépôt `pet-match-web`) lit une seule route,
`getPodiumsHttp`, et pointe encore sur **debug** : c'est le défaut de
`src/config.js`, tant que le v2 n'est pas en production. Le jour de la bascule,
la reconstruire avec la bonne adresse — Vite fige la variable **au moment du
build**, la redéployer sans reconstruire ne changerait rien :

```bash
cd pet-match-web
VITE_API_BASE=https://us-central1-pet-match-30417.cloudfunctions.net npm run build
npx firebase deploy --only hosting --project pet-match-30417
```

Ou changer le défaut dans `src/config.js`, ce qui évite d'y repenser au build
suivant. Vérifier ensuite que la page montre bien des concours : une vitrine
vide veut dire que la migration n'a pas encore clos de concours en production.

### Après la bascule

Le cycle de 18 h et le rappel de 15 h tournent tout seuls, en heure de Paris.
Vérifier le lendemain matin :

```bash
npx firebase functions:log --only dailyCycle --project pet-match-30417
```

## 7. Ce qui n'est pas couvert

- **Aucune interface.** Tout passe par la ligne de commande. Une console de
  modération se justifiera quand le volume l'exigera, pas avant.
- **Le signalant n'est jamais prévenu** de la suite donnée à son signalement.
  Volontaire pour l'instant : lui répondre, c'est lui dire ce qu'on a fait d'un
  tiers.
- **La suspension ne se lève pas toute seule.** `suspendedUntil` est une date ;
  aucun geste ne la retire avant terme, et rien ne prévient à la levée.
- **Aucun rattrapage si l'app est désinstallée.** Sans jeton, la notification se
  perd. C'est précisément ce que le courrier corrige.
