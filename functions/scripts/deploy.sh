#!/usr/bin/env bash
#
# Déployer les fonctions sans saturer le quota CPU de la région (OPERATIONS §8).
#
#   npm run deploy:safe -- pet-match-30417
#
# Cloud Run compte `maxInstances × CPU` de **chaque** révision dans le quota
# « Total allowable CPU », même celles qui ne servent plus rien. Un déploiement
# complet en crée une trentaine d'un coup pendant que les anciennes sont encore
# là : sans nettoyage préalable, le quota sature en pleine bascule, et des
# fonctions restent sans révision prête — c'est la panne du 2026-10-17.
#
# Le script nettoie donc **avant** (pour avoir la place de basculer) et
# **après** (pour la fois suivante), puis vérifie que chaque service est prêt.
# Il ne supprime jamais une révision qui reçoit du trafic, ni la dernière prête.
set -euo pipefail

PROJECT="${1:?projet manquant : npm run deploy:safe -- <projet>}"
REGION="us-central1"

# Les révisions à garder : celles qui servent du trafic, et la dernière prête de
# chaque service — celle vers laquelle on reviendrait.
keep() {
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --format="value(status.traffic[].revisionName,status.latestReadyRevisionName)" \
    | tr ';\t' '\n\n' | sed '/^$/d' | sort -u
}

prune() {
  local kept all dead
  kept="$(mktemp)"
  all="$(mktemp)"
  keep > "$kept"
  gcloud run revisions list --project "$PROJECT" --region "$REGION" \
    --format="value(metadata.name)" | sort -u > "$all"
  dead="$(comm -23 "$all" "$kept")"
  echo "→ $(echo "$dead" | sed '/^$/d' | wc -l | tr -d ' ') révision(s) sans trafic à supprimer"
  # En parallèle, et sans s'arrêter sur une révision déjà partie : Cloud Run
  # en ramasse lui-même pendant qu'on nettoie.
  echo "$dead" | sed '/^$/d' | xargs -P 8 -I{} \
    gcloud run revisions delete {} --region "$REGION" --project "$PROJECT" --quiet >/dev/null 2>&1 || true
  rm -f "$kept" "$all"
}

# Les services dont la dernière révision n'est pas prête : ceux qui répondent 503.
unready() {
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --format="csv[no-heading](metadata.name,status.conditions[0].status)" \
    | awk -F, '$2 != "True" { print $1 }'
}

echo "Nettoyage avant déploiement…"
prune

echo "Déploiement sur $PROJECT…"
npx firebase deploy --only functions --project "$PROJECT" --non-interactive

echo "Nettoyage après déploiement…"
prune

broken="$(unready)"
if [ -n "$broken" ]; then
  echo "✗ Services sans révision prête :"
  echo "$broken"
  echo "Les redéployer un par un : npx firebase deploy --only functions:<nom> --project $PROJECT"
  exit 1
fi
echo "✓ Tous les services sont prêts."
