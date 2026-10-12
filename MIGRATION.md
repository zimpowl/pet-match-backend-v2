# La migration qui reste à faire

Une seule, et elle porte un nom : **passer la production à la source unique des
médailles** (D138). Debug y est déjà ; la prod n'y est pas.

Ce fichier ne garde que ce qui reste **à faire**. Tout ce qui est fait est dans
l'historique git, et l'exploitation courante est dans `OPERATIONS.md`.

---

## Où on en est

| | Code déployé | Champs gelés en base |
|---|---|---|
| `pet-match---debug` | ✅ à jour (2026-10-11) | ✅ retirés — 403 participations, 525 jurés |
| `pet-match-30417` (prod) | ❌ code d'avant | ❌ encore là |

**Rien ne presse et rien n'est cassé.** La prod sert l'ancien code, qui lit les
palmarès gelés sur chaque participation : c'est cohérent avec elle-même. Ce qui
suit la met d'accord avec debug.

---

## Ce que ça change pour le joueur

Aujourd'hui en prod, un juré passé Maître apparaît encore **Novice** sur un
concours qu'il a jugé quand il l'était — chaque participation garde une copie de
ce qu'il valait ce jour-là. Après la bascule, il apparaît Maître partout, avec
son palmarès du jour, et c'est la même valeur sur sa fiche, sur une ligne de
jury et sur sa slab.

---

## L'ordre

### 1. La sauvegarde, avant tout le reste

```bash
cd functions
npm run backup -- --project=pet-match-30417 --out=../backup-prod-$(date +%F)
```

Vérifier que les fichiers ne sont pas vides avant de continuer. Sans `--out`,
une simulation **écrase** `functions/backup/`.

### 2. Supprimer `signRulesHttp`

Le règlement se lit, il ne se signe plus (commit `513336e`) : la fonction n'est
plus dans le code, mais elle tourne encore en prod. Un déploiement s'arrêtera
net dessus tant qu'elle est là.

```bash
npx firebase functions:delete signRulesHttp --region us-central1 --project pet-match-30417
```

> ⚠️ **Le seul point à vérifier avant.** Une app installée qui appelle encore la
> signature du règlement recevra une erreur. Si de vieux binaires traînent,
> fermer d'abord la porte de version (`npm run gate`, §4 d'`OPERATIONS.md`) pour
> les forcer à se mettre à jour.

### 3. Le code

```bash
npx firebase deploy --only functions --project pet-match-30417
```

En interactif, **lire la liste de suppression avant de confirmer** : elle doit
être vide, puisque l'étape 2 a déjà fait le ménage. Jamais `--force`.

Si le déploiement bute sur le quota CPU, les trois pièges Cloud Run et leurs
remèdes sont au §8 d'`OPERATIONS.md`.

### 4. Vérifier avant d'écrire quoi que ce soit

Le code neuf lit les palmarès sur `pets/{id}` et `users/{id}`. Cette commande
compare, pour un concours clos, ce que servent les lignes et ce que disent les
fiches : les deux doivent être identiques **avant** de toucher à la base.

```bash
BASE=https://us-central1-pet-match-30417.cloudfunctions.net
UID=$(curl -s "$BASE/getContestsHttp" | python3 -c \
  "import json,sys;print(next(c['uid'] for c in json.load(sys.stdin)['contests'] if c['status']=='CLOSED'))")
curl -s "$BASE/getContestHttp?contestUid=$UID" | python3 -c "
import json,sys,urllib.request
d=json.load(sys.stdin)
for r in d['participants'][:5]:
    p=json.load(urllib.request.urlopen('$BASE/getPetHttp?petUid='+r['petUid']))['pet']
    print(r['name'], 'OK' if r['career']==p['stats'] and r['level']==p['level'] else 'DIVERGENT')
"
```

Que du `OK` : on continue. Un seul `DIVERGENT` : on s'arrête et on cherche.

### 5. Retirer les champs gelés

`gradeAtEntry` et `statsAtContest` ne sont plus lus par personne. Les laisser,
c'est laisser une seconde vérité derrière soi — celle qu'on relira par erreur
dans six mois, et qui mentira.

L'outil **refuse la prod par construction**. Il faut élargir la garde
nommément, puis la révoquer juste après :

```ts
// functions/src/admin/unfreeze.ts, dans parseOptions()
if (!emulated && !/debug/i.test(projectId)) {
```

devient, le temps de l'opération :

```ts
if (!emulated && !/debug|pet-match-30417/i.test(projectId)) {
```

puis :

```bash
cd functions
npm run unfreeze -- --project=pet-match-30417             # à blanc : combien ?
npm run unfreeze -- --project=pet-match-30417 --commit    # écrit
npm run unfreeze -- --project=pet-match-30417             # doit rendre 0
```

**Et remettre la garde.** C'est la dernière étape, pas une option : un outil
destructeur qui accepte la production est une bombe à retardement.

### 6. Rejouer l'étape 4

Les champs ont disparu ; les lignes doivent servir exactement les mêmes valeurs
qu'avant. Si quelque chose bouge ici, c'est que du code lisait encore les champs
gelés.

---

## Et l'app ?

**Elle n'a rien à attendre de cette migration.** Le contrat de transport n'a pas
changé — `level` et `career` sont toujours là, avec les mêmes noms et les mêmes
formes. Une app déjà installée continue de fonctionner et affichera simplement
les valeurs du jour.

La publication de l'app sur les magasins est un sujet séparé, et son ordre
propre tient en une ligne : **la prod doit porter le code neuf avant qu'un
binaire ne soit soumis**, parce que le relecteur d'Apple ouvre l'app. Ici, la
condition est déjà remplie dans les deux sens — rien ne bloque.
