# Exploiter PetMatch

Tout ce qui se décide à la main : les commandes, les gestes de modération, ce
que le joueur en apprend, et les pièges de déploiement.

Tout se lance **depuis `functions/`** — c'est là qu'est le `package.json` — et
**rien n'écrit sans `--commit`** : le défaut est toujours un essai à blanc.

```bash
cd functions
npm run <outil> -- --project=<projet>            # compte et signale
npm run <outil> -- --project=<projet> --commit   # écrit
```

La plupart des outils **refusent tout projet dont l'identifiant ne contient pas
« debug »**. C'est délibéré : ils écrasent des données. Trois exceptions
assumées, parce qu'elles existent pour tourner en production : `gate` — c'est là
qu'on ferme la porte après une publication et surtout là qu'on la rouvre en
urgence —, `links` — un lien créé sur un projet de debug ne mène nulle part, et
un flyer s'imprime une fois — et `reports`, `verifications`, `backup`,
`retention`, qui ne détruisent rien.

| Commande | Ce qu'elle fait | Prod |
|---|---|---|
| `npm run reports` | Lit et traite les signalements | oui |
| `npm run verifications` | Lit et traite les demandes de confirmation d'identité | oui |
| `npm run retention` | Pose la règle d'expiration des pièces d'identité | oui |
| `npm run gate` | Lit et écrit la porte de version | oui |
| `npm run links` | Liens courts : tableau de bord, création, QR | oui |
| `npm run backup` | Copie des collections vers `backup/` | oui |
| `npm run grades` | Relève les grades acquis | debug |
| `npm run tokens` | Efface les jetons de notification | debug |
| `npm run unfreeze` | Retire les palmarès gelés des participations (D138) | debug |
| `npm run seed` | Remplit un projet de debug de données de test | debug |

---

## 1. Ce que le joueur reçoit

| Événement | Notification | Déclenché par |
|---|---|---|
| Résultats du concours clos (dimanche 18 h), à qui y avait un rôle | oui | `dailyCycle` |
| Concours qui commence (dimanche 18 h), à tous les autres | oui | `dailyCycle` |
| Classement du soir (lundi–samedi) | **non** — il se lit dans l'app | `dailyCycle` |
| Rappel de vote (15 h), au juré qui n'a rien posé | oui | `dailyReminder` |
| **Niveau atteint** | oui | `grade.level` monte |
| **Identité confirmée** | oui | `isVerified` / `verifiedAt` |
| **Pièce refusée** | oui | demande passée à `REJECTED` |
| **Photo retirée** | oui | `hiddenAt` posé |
| **Compte suspendu** | oui | `suspendedUntil` posé |

Les cinq dernières sont des **nouvelles du dossier**. Elles ne parlent pas du
jeu : elles disent ce qui est arrivé à un compte, et aucun écran ne l'apprendra
à qui n'ouvre pas l'app.

### Les deux interrupteurs

Dans les réglages de l'app, stockés dans `users/{uid}.notifications` :

- **Résultats** — coupe les deux messages du dimanche.
- **Rappel de vote** — coupe le mot de 15 h.

Les nouvelles du dossier **partent toujours**, quels que soient ces deux
interrupteurs. On ne choisit pas d'ignorer qu'une photo a été retirée. Seule la
trace écrite est un choix. La règle vit dans `wanted()`, `src/data/notify.ts`.

---

## 2. Les gestes

### Signalements

```bash
npm run reports -- --project=<projet>                                  # la file
npm run reports -- --project=<projet> --id=<id> --close --commit       # vu, rien à faire
npm run reports -- --project=<projet> --id=<id> --hide --commit        # l'image se tait
npm run reports -- --project=<projet> --id=<id> --show --commit        # et elle reparaît
npm run reports -- --project=<projet> --id=<id> --withdraw --commit    # hors des concours ouverts
npm run reports -- --project=<projet> --id=<id> --suspend=14 --commit  # et le compte aussi
npm run reports -- --project=<projet> --id=<id> --takedown --commit    # tout d'un coup
```

`--hide` **ne supprime rien** : la photo reste en base, c'est la preuve du
signalement. Elle n'est plus servie, et l'app affiche « photo supprimée » à sa
place — ce qui n'est pas « il manque une photo », et dire les deux pareil
laisserait croire à un oubli.

Il vise **une image**, pas un profil. Un animal en porte plusieurs — celle de sa
fiche, et une par inscription — et le signalement dit laquelle était affichée.
Seuls les documents qui portent cette image-là se taisent. Fermer un compte ne
masque rien : les concours gardent la photo qu'ils ont recopiée.

`--show` fait le geste inverse, et celui-là **rend tout** : l'asymétrie permet
de défaire un masquage trop large sans deviner ce qu'il avait emporté.

`--withdraw` ne touche que les concours **non clos** — un concours clos garde
ses participations, les défaire referait le palmarès de gens qui n'ont rien
demandé. Tous ferment le signalement. `--hide` et `--suspend` notifient.

### Pièces d'identité

```bash
npm run verifications -- --project=<projet>                                # la file
npm run verifications -- --project=<projet> --id=<id> --download           # la pièce, en local
npm run verifications -- --project=<projet> --id=<id> --accept --commit
npm run verifications -- --project=<projet> --id=<id> --refuse="motif" --commit
```

La file imprime, sous chaque demande, le nom du fichier, son type et un **lien
cliquable vers la console Firebase**. Jamais une URL de téléchargement :
`documents/` est fermé en lecture pour tout le monde dans `storage.rules`, et un
lien à jeton contournerait précisément cette règle. La console demande d'être
membre du projet — c'est la bonne porte.

Ce que le joueur peut déposer : une **photo ou un PDF**, dix mégaoctets au plus.

`--accept` lève la confirmation, ce qui **relève le grade dans la seconde** et
envoie les deux nouvelles — « identité confirmée », puis « grade 1 ».
`--refuse` envoie le motif tel qu'écrit : il sera lu par le joueur, mot pour mot.

La pièce **reste dans le bucket après la décision** : c'est la trace de ce qui a
été confirmé. Elle ne reste pas pour toujours — **cinq ans**, posés sur le
bucket lui-même :

```bash
npm run retention -- --project=<projet>            # ce qui est en place
npm run retention -- --project=<projet> --commit   # la règle des cinq ans
```

Idempotente, **à passer une fois par projet**, debug comme prod. Et fermer un
compte efface ses pièces avant l'échéance : `deleteAccountHttp` vide le préfixe
`documents/<uid>/`.

### Grades

```bash
npm run grades -- --project=<projet> --commit
```

Relève tous les grades acquis. Utile après une correction de données ; en temps
normal le cycle de 18 h et la confirmation d'identité suffisent. **On relève, on
ne recalcule pas** : un grade ne redescend jamais, et chaque cran garde sa date.

| 0 | Novice | dès l'inscription |
| 1 | Confirmé | 4 concours **et** identité vérifiée |
| 2 | Amateur | 1 médaille |
| 3 | Aguerri | 3 médailles |
| 4 | Expert | 6 médailles dont 1 or |
| 5 | Maître | 10 médailles dont 2 or |
| 6 | Légende | 15 médailles dont 5 or |

C'est **une échelle, pas un cumul** : le niveau est le plus grand cran dont
*toutes* les conditions jusqu'à lui sont remplies. Un profil non vérifié
plafonne donc à 0, même couvert de médailles — et c'est pourquoi une grande
partie du parc est à 0 : la vérification est gratuite mais **manuelle**, et la
file s'ouvre avec `npm run verifications`.

---

## 3. Où ça se déclenche

Trois déclencheurs Firestore, dans `src/triggers/account.ts`. Ils regardent les
documents changer, quel que soit **qui** les change — un outil, un script, ou la
console Firebase à la main.

| Fonction | Document | Ce qu'elle regarde |
|---|---|---|
| `onUserChanged` | `users/{uid}` | `isVerified`, `grade.level`, `suspendedUntil`, `hiddenAt` |
| `onPetChanged` | `pets/{petUid}` | `verifiedAt`, `grade.level`, `hiddenAt` |
| `onVerificationReviewed` | `verifications/{id}` | passage à `REJECTED` |

Modifier un champ **à la main dans la console** prévient donc quand même le
joueur. Il n'y a pas de porte dérobée.

```bash
npx firebase functions:log --only onUserChanged --project <projet>
```

---

## 4. La porte de version

```bash
npm run gate -- --project=<projet>                                          # lire
npm run gate -- --project=<projet> --android-latest=200 --ios-latest=5 --commit
npm run gate -- --project=<projet> --android-min=200 --ios-min=5 --commit   # fermer
npm run gate -- --project=<projet> --android-min=0 --ios-min=0 --commit     # rouvrir
```

`--latest` déclare ce qui est **publié sur les magasins** ; `--min` le plus
ancien build encore accepté. L'outil refuse un minimum au-dessus du dernier
publié — c'est ce qui empêche de bloquer tout le monde sur une version que
personne ne peut installer.

Rouvrir est l'issue de secours : l'écriture d'un document, effective en moins
d'une minute, sans déploiement.

---

## 5. Les liens courts

`pet-match.fr/go/<code>` compte un clic et redirige vers le bon magasin selon le
téléphone. Un code par source — une clinique, un post, une campagne — et c'est
ce qui permet de répondre à « est-ce que ça vaut le coup d'y retourner ? ».

```bash
npm run links -- --project=<projet>                                  # le tableau de bord
npm run links -- --project=<projet> --create=<code> --label="…" --commit
npm run links -- --project=<projet> --qr=<code>                      # le QR, en SVG
npm run links -- --project=<projet> --delete=<code> --commit
```

**Ce qui est enregistré, et rien d'autre** : un total, un compteur par jour, un
compteur par plateforme. Pas d'adresse IP, pas d'identifiant, pas de cookie. Une
mesure sans donnée personnelle n'a besoin ni de bandeau de consentement, ni de
registre, ni d'une ligne dans la politique de confidentialité.

**Un code inconnu ne renvoie jamais d'erreur** : QR mal imprimé, faute de
frappe, lien supprimé — la personne part sur le site. On peut donc supprimer un
lien sans se soucier des flyers déjà distribués.

Le QR sort en SVG, correction d'erreur haute, dans `functions/qr/` (ignoré par
git). **Un code par clinique, jamais un code pour tous les vétérinaires** :
c'est toute la valeur du dispositif — savoir chez qui réimprimer.

> ⚠️ `goHttp` n'est joignable sur `pet-match.fr` que par une réécriture déclarée
> dans le `firebase.json` du dépôt **`pet-match-web`**, et **l'ordre est le
> sujet** : si la règle attrape-tout passe devant, le SPA avale le chemin, les
> liens « marchent » en affichant l'accueil, et rien n'est compté.
>
> ```json
> "rewrites": [
>   { "source": "/go/**", "function": "goHttp", "region": "us-central1" },
>   { "source": "**", "destination": "/index.html" }
> ]
> ```

---

## 6. Les jetons de notification

```bash
npm run tokens -- --project=pet-match---debug --commit
```

**À lancer après chaque republication de la prod sur debug**, et *avant* que les
jobs de 18 h ne tournent. Les jetons qui arrivent alors sont ceux des appareils
de **prod** : un `dailyCycle` de debug les servirait pour de vrai, et des
téléphones réels recevraient les notifications d'un bac à sable.

Ce n'est pas une perte : un appareil de debug repose son jeton au lancement
suivant, par `registerDeviceHttp`.

---

## 7. Travailler en local

```bash
npx firebase emulators:start --only firestore,functions --project pet-match---debug
```

Puis, dans un autre terminal, seeder et appeler :

```bash
cd functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node lib/admin/seed.js --project=pet-match---debug --commit
curl -s "http://127.0.0.1:5001/pet-match---debug/us-central1/getContestsHttp?userUid=zimpo"
```

`src/admin/seed.ts` pose un jeu de concours, de participants et de jurés
calqué sur les fakes de l'app. Il est **idempotent** — identifiants fixes, chaque
passe réécrit les mêmes documents.

Repartir de zéro sur debug : vider la base depuis la console Firestore, puis
restaurer un export de production depuis la console Google Cloud. **Sans le
vidage préalable, le legacy survit à la restauration.** Il n'y a plus d'outil de
purge, et c'est délibéré : un outil de suppression dont plus aucune cible
n'existe ne peut que se tromper.

---

## 8. Déployer

```bash
npm run deploy:safe -- <projet>     # dans functions/
```

**Toujours ce script, jamais `firebase deploy` nu.** Il supprime les révisions
sans trafic avant et après le déploiement, puis vérifie que chaque service a une
révision prête. Sans lui, le quota CPU sature en pleine bascule et des fonctions
restent en 503 (panne du 2026-10-17 : connexion et vote coupés). Une seule
fonction : `npx firebase deploy --only functions:<nom> --project <projet>`,
qui ne crée qu'une révision.

Remède durable : demander l'augmentation du quota « Total allowable CPU per
project per region » de `us-central1` dans la console Google Cloud (IAM et
administration → Quotas).

Le `predeploy` relance `lint` puis `build` : une erreur de lint arrête le
déploiement avant qu'il ne commence.

**Lire la liste de suppression avant de confirmer.** Une fonction retirée du
code est supprimée du projet, et une app installée qui l'appelle reçoit une
erreur. En mode non interactif, le déploiement s'arrête net et demande de
supprimer la fonction nommément — c'est le bon réflexe, et il vaut mieux que
`--force`, qui emporte sans dire quoi.

### Les trois pièges Cloud Run

Rencontrés à la bascule du 2026-09-29, aucun documenté par Firebase, tous
destinés à se reproduire.

**Les révisions mortes retiennent le quota.** Chaque déploiement empile une
révision Cloud Run sans supprimer la précédente, et Cloud Run compte
`maxInstances × CPU` de **chacune** dans le quota « Total allowable CPU » de la
région — même celles qui ne servent aucun trafic. Ce jour-là, 27 fonctions
vivantes réservaient 77 CPU, mais 168 révisions mortes en retenaient **1 487**.
Baisser `maxInstances` ne libère rien : ça ajoute une révision de plus.

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

`deploy:safe` le fait à chaque déploiement ; la commande ci-dessus reste pour
nettoyer à la main.

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
existe » : `dailyCycle` et `dailyReminder` sont appelées par Cloud Scheduler
avec un compte de service, et les rendre publiques laisserait n'importe qui
déclencher la clôture des concours.

**Une fonction peut afficher « v2 » et servir encore l'ancien conteneur.** Le
plus sournois des trois, parce qu'il ne produit aucune erreur. Un déploiement se
fait en deux temps : Firebase appelle `UpdateFunction`, puis Cloud Run déroule
la nouvelle révision. Quand le second échoue sur le quota, le premier a **déjà
réussi** — `firebase functions:list` affiche la fonction à jour pendant que
Cloud Run envoie 100 % du trafic à l'ancienne révision. Et il ne se répare
jamais seul : au déploiement suivant, Firebase compare les hachages, les trouve
égaux, et affiche `Skipped (No changes detected)`.

```bash
# détecter : la colonne du milieu doit égaler la troisième
gcloud run services list --project <projet> \
  --format="table(metadata.name, status.traffic[0].revisionName, status.latestCreatedRevisionName)"

# corriger : une fonction nommée n'est jamais sautée
npx firebase deploy --only functions:<nom>,functions:<nom> --project <projet>
```

Une colonne du milieu **vide** est pire : le service n'a aucune révision prête
et répond 503.

---

## 9. Ce qui n'est pas couvert

- **Aucune interface.** Tout passe par la ligne de commande. Une console de
  modération se justifiera quand le volume l'exigera, pas avant.
- **Le signalant n'est jamais prévenu** de la suite donnée à son signalement.
  Volontaire : lui répondre, c'est lui dire ce qu'on a fait d'un tiers.
- **La suspension ne se lève pas toute seule.** `suspendedUntil` est une date ;
  aucun geste ne la retire avant terme, et rien ne prévient à la levée.
- **Aucun rattrapage si l'app est désinstallée.** Sans jeton, la notification se
  perd, et rien ne la rejoue au retour.
