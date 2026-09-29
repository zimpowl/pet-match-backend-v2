# Exploiter PetMatch

Ce qui se décide à la main, comment le faire, et ce que le joueur en apprend.
Tout se passe en ligne de commande depuis `functions/`, et **rien n'écrit sans
`--commit`** : le défaut est toujours un essai à blanc.

Les outils refusent tout projet dont l'identifiant ne contient pas « debug ».
Pour la production, il faudra lever cette garde sciemment.

---

## 1. Ce que le joueur reçoit

| Événement | Notification | Déclenché par |
|---|---|---|
| Résultat du soir (18 h) | oui | `dailyCycle` |
| Clôture d'un concours | oui | `dailyCycle` |
| Rappel de vote (15 h) | oui | `dailyReminder` |
| **Niveau atteint** | oui | `grade.level` monte |
| **Identité confirmée** | oui | `isVerified` / `verifiedAt` |
| **Pièce refusée** | oui | demande passée à `REJECTED` |
| **Photo retirée** | oui | `hiddenAt` posé |
| **Compte suspendu** | oui | `suspendedUntil` posé |

Les quatre dernières sont des **nouvelles du dossier**. Elles ne parlent pas du
jeu : elles disent ce qui est arrivé à un compte, et aucun écran ne l'apprendra
à qui n'ouvre pas l'app.

## 2. Les deux interrupteurs

Dans les réglages de l'app, et stockés dans `users/{uid}.notifications` :

- **Résultats du soir** — coupe le classement de 18 h et la clôture.
- **Rappel de vote** — coupe le mot de 15 h.

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

`--hide` et `--suspend` déclenchent chacun une notification.

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

## 5. Répéter la migration sur dev

Le projet de dev est **`pet-match---debug`**. La migration y est **rejouable
autant de fois qu'on veut** : elle lit `challenges`, écrit dans `contests` avec
des identifiants déterministes, et réécrit par-dessus au passage suivant. C'est
ici qu'on répète — la production ne se répète pas.

```bash
cd functions

# à blanc : lit tout, n'écrit rien
npm run migrate -- --project=pet-match---debug

# pour de vrai
npm run migrate -- --project=pet-match---debug --commit
```

Le passage à blanc est ce qu'on lit **avant** de poser. Il imprime ce qu'il a
trouvé et ce qu'il compte écrire, et il **refuse d'écrire** si un identifiant de
`challenges` entre en collision avec un vestige v0 de `contests`.

Deux lignes du rapport méritent un regard :

- **`animaux à créer (espèce inconnue, rangés en DOG)`** — un participant legacy
  dont l'animal n'a pas pu être retrouvé par son nom sous son propriétaire. La
  migration en fabrique un, forcément chien. Un compte de plus ici veut dire un
  animal fantôme de plus en base.
- **`seenPairs non remappables`** — des paires de duels dont un des deux animaux
  n'existe plus. Sans conséquence : elles servaient à éviter de re-présenter un
  duel déjà vu, et le concours est clos.

### Ce qu'on vérifie après

```bash
# les concours migrés existent et portent un numéro : ce sont les « conservés »
npm run cleanup -- --project=pet-match---debug --targets=contests-v0 --out=/tmp/verif

# l'app les verrait — l'endpoint réclame un userUid, le repli debug l'accepte sans jeton
curl -s "https://us-central1-pet-match---debug.cloudfunctions.net/getContestsHttp?userUid=<uid>"
```

Le `--out` n'est pas un détail : sans lui, une simple simulation **écrase**
`functions/backup/` — la sauvegarde s'écrit même en `--dry-run`.

### Les vestiges v0 cohabitent

`contests` porte deux générations : les concours migrés, qui ont un `number`, et
les documents de la v0, qui n'en ont pas. Les seconds restent visibles en base
tant qu'on ne passe pas `--targets=contests-v0`. La migration s'en accommode —
elle les détecte et refuse seulement en cas de collision d'identifiant.

### Repartir de zéro

Un redéploiement du projet de debug efface les données v2. Il faut alors
**rejouer la migration**, sinon l'app s'ouvre sans un seul concours.

## 6. Basculer en production

Le projet de production est **`pet-match-30417`**. Rien n'y a encore été
déployé : tout ce qui suit a été éprouvé sur `pet-match---debug` et n'a jamais
tourné en vrai.

### Ce qu'il faut décider avant

- **L'ancienne app s'éteint-elle ce jour-là ?** Supprimer `challenges` coupe le
  backend legacy, donc l'app encore installée chez les joueurs. Tant que la
  réponse est non, on migre sans nettoyer.

### Les gardes à lever

Sept outils refusent tout projet dont l'identifiant ne contient pas « debug ».
C'est délibéré : ils écrasent des données.

```
migrate  cleanup  schedule  seed  grades  nationality  tokens
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

> **Élargir les gardes d'abord.** Tant que ce n'est pas fait, chacune des
> commandes `npm run` ci-dessous est **refusée** : `pet-match-30417` ne contient
> pas « debug ». Voir la section précédente.

```bash
cd functions
export PROD=pet-match-30417

# 1. la sauvegarde, avant tout le reste
npm run backup -- --project=$PROD --collection=challenges,pets,users,contests,configuration
#    vérifier que les fichiers ne sont pas vides avant de continuer

# 2. les règles et les index — SANS --force
npx firebase deploy --only firestore:rules --project $PROD
npx firebase deploy --only firestore:indexes --project $PROD
#    répondre NON à toute suppression : les index du legacy servent encore
#    attendre qu'ils soient READY, pas BUILDING, avant l'étape 4

# 3. la migration, à blanc puis pour de vrai
npm run migrate -- --project=$PROD
npm run migrate -- --project=$PROD --commit

# 4. le code — POINT DE NON-RETOUR
npx firebase deploy --only functions --project $PROD
#    en interactif : lire la liste de suppression avant de confirmer
#    jamais --force, jamais --only functions:<nom> (un filtre annule les suppressions)

# 5. seconde passe de migration
npm run migrate -- --project=$PROD --commit
#    le legacy a continué d'écrire entre 3 et 4 : c'est cette passe qui rattrape

# 6. la rétention des pièces d'identité
npm run retention -- --project=$PROD --commit

# 7. vérifier l'app de bout en bout, sur la variante prodEnv

# 8. seulement après vérification
npm run cleanup -- --project=$PROD --targets=contests-v0,legacy,instagram,mail
npm run cleanup -- --project=$PROD --targets=contests-v0,legacy,instagram,mail --commit

# 9. les index morts, maintenant que plus rien ne les lit
npx firebase deploy --only firestore:indexes --project $PROD --force

# 10. remettre les gardes, et redéployer — deux d'entre elles vivent dans le code
```

**Pourquoi le code après les données.** Déployer les fonctions v2 **supprime**
les fonctions legacy du projet : elles ne sont plus dans les sources, et le CLI
propose de retirer tout ce qui n'y est pas. L'ancien backend s'arrête donc à
l'étape 4. Le faire avant la migration reviendrait à couper la source pendant
qu'on la lit.

Deux noms survivent à cette suppression parce qu'ils existent des deux côtés :
`getOrCreateHttp` et `createPetHttp` sont **écrasés**, pas retirés. L'ancienne
app y trouvera un handler v2 qui réclame un jeton qu'elle n'envoie pas, et
prendra un 403 plutôt qu'un 404. C'est le comportement voulu, mais autant le
savoir en lisant les logs.

**Les points de retour.** Après l'étape 1 on sait restaurer. Après l'étape 3 on
peut encore effacer les concours migrés et revenir. **Après l'étape 4, non** :
revenir en arrière demande de redéployer le dépôt legacy. Après l'étape 8,
`challenges` n'existe plus et la migration n'est plus rejouable — c'est la
seconde étape irréversible, et elle gagne à être un autre jour.

**Copier la sauvegarde de l'étape 8 ailleurs que sur le disque du portable**
avant de la lancer. C'est la seule marche arrière qui reste.

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

### Quand le déploiement bute sur le quota CPU

Trois pièges rencontrés à la bascule du 2026-09-29, aucun des trois documenté
par Firebase, et tous destinés à se reproduire. Le troisième est le seul qui ne
dise rien : il se lit dans les données, pas dans les journaux.

**Les révisions mortes retiennent le quota.** Chaque déploiement empile une
révision Cloud Run sans supprimer la précédente, et Cloud Run compte
`maxInstances × CPU` de **chacune** dans le quota « Total allowable CPU » de la
région — même celles qui ne servent aucun trafic. Ce jour-là, 27 fonctions
vivantes réservaient 77 CPU, mais 168 révisions mortes en retenaient **1 487**.
Le déploiement échouait sur « Container Healthcheck failed. Quota exceeded ».

Baisser `maxInstances` ne libère rien : ça ajoute une révision de plus. Il faut
supprimer les mortes, ce qui est sans risque puisqu'elles ne reçoivent rien :

```bash
gcloud run services list --project <projet> --region us-central1 \
  --format="value(status.traffic[0].revisionName)" | sort > /tmp/keep.txt
gcloud run revisions list --project <projet> --region us-central1 \
  --format="value(metadata.name)" | sort > /tmp/all.txt

comm -23 /tmp/all.txt /tmp/keep.txt | wc -l          # regarder d'abord
comm -23 /tmp/all.txt /tmp/keep.txt | while read r; do
  gcloud run revisions delete "$r" --region us-central1 --project <projet> --quiet
done
```

À faire tous les dix à quinze déploiements, avant que le quota ne morde.

**L'autorisation d'invocation ne se pose qu'à la création.** Firebase accorde
`allUsers / roles/run.invoker` quand il **crée** une fonction HTTP, jamais quand
il la met à jour. Une fonction créée pendant un déploiement qui a échoué plus
loin reste donc sans autorisation, et Cloud Run répond un **403 en HTML** — à ne
pas confondre avec le 403 JSON de `http/identity.ts`, qui lui est le bon
comportement. Redéployer ne corrige rien.

```bash
for s in <services>; do
  gcloud run services add-iam-policy-binding "$s" --region us-central1 \
    --project <projet> --member allUsers --role roles/run.invoker --quiet
done
```

**Nommer les services un par un.** Surtout pas de boucle sur « tout ce qui
existe » : `dailyCycle` et `dailyReminder` sont appelées par Cloud Scheduler avec
un compte de service, et les rendre publiques laisserait n'importe qui déclencher
la clôture des concours.

**Une fonction peut afficher « v2 » et servir encore l'ancien conteneur.** C'est
le plus sournois des trois, parce qu'il ne produit aucune erreur.

Un déploiement se fait en deux temps : Firebase appelle `UpdateFunction`, puis
Cloud Run déroule la nouvelle révision. Quand le second échoue sur le quota, le
premier a **déjà réussi** — les métadonnées et l'étiquette
`firebase-functions-hash` portent la valeur neuve. `firebase functions:list`
affiche donc la fonction comme à jour, pendant que Cloud Run continue d'envoyer
100 % du trafic à la dernière révision saine.

Pour les deux noms qui entrent en collision avec le backend legacy —
`getOrCreateHttp` et `createPetHttp` — cette dernière révision saine **est le
legacy**. Le 2026-09-29, `getOrCreateHttp` a servi la révision du 21 juillet
pendant cinq heures après la bascule.

Ce que ça donne côté produit, et pourquoi on ne l'a pas vu tout de suite : la
réponse du legacy ne porte ni `needsRules` ni `needsProfile`. Le DTO de l'app
donne `false` par défaut aux deux, donc `entryGate` renvoyait tout le monde
directement dans l'app — ni règlement, ni formulaire de juré. Aucune erreur,
aucun 500, aucune ligne de journal anormale. Ce qui a mis sur la piste est un
détail de données : trois comptes créés à la forme legacy (`coins: 3000`,
`name: "Anonyme"`) sur un projet dont les règles Firestore refusaient toute
écriture cliente depuis deux heures. Seule une fonction pouvait les écrire.

Et il ne se répare jamais seul : au déploiement suivant, Firebase compare les
hachages, les trouve égaux, et affiche `Skipped (No changes detected)`.

Le détecter — comparer ce qui sert à ce qui a été tenté :

```bash
gcloud run services list --project <projet> \
  --format="table(metadata.name, status.traffic[0].revisionName, status.latestCreatedRevisionName)"
```

Une colonne du milieu différente de la troisième signale un déroulement échoué.
Une colonne du milieu **vide** est pire : le service n'a aucune révision prête et
répond 503. Dater la révision qui sert lève le doute :
antérieure au jour de la bascule, c'est du legacy.

Le corriger — cibler la fonction par son nom :

```bash
npx firebase deploy --only functions:getOrCreateHttp,functions:createPetHttp --project <projet>
```

C'est l'échappatoire au « Skipped », et elle est dans le code : le prédicat de
saut de `planner.js` commence par `!want[id].targetedByOnly`. Une fonction
nommée explicitement n'est jamais sautée, quel que soit son hachage. Inutile de
tout supprimer pour repousser.

**Ce `--only` ne contredit pas l'interdiction du §6.** Là-bas, un filtre est
proscrit parce qu'il annule les **suppressions** de fonctions legacy, et c'est
tout l'objet du déploiement de bascule. Une fois les suppressions faites, il n'y
a plus rien à annuler : cibler par nom redevient le bon outil, et le seul qui
force un redéploiement à hachage identique.

## 7. Ce qui n'est pas couvert

- **Aucune interface.** Tout passe par la ligne de commande. Une console de
  modération se justifiera quand le volume l'exigera, pas avant.
- **Le signalant n'est jamais prévenu** de la suite donnée à son signalement.
  Volontaire pour l'instant : lui répondre, c'est lui dire ce qu'on a fait d'un
  tiers.
- **La suspension ne se lève pas toute seule.** `suspendedUntil` est une date ;
  aucun geste ne la retire avant terme, et rien ne prévient à la levée.
- **Aucun rattrapage si l'app est désinstallée.** Sans jeton, la notification se
  perd, et rien ne la rejoue au retour.
