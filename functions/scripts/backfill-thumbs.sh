#!/usr/bin/env bash
#
# Fabriquer les miniatures des photos déjà en ligne (OPERATIONS §9).
#
#   bash scripts/backfill-thumbs.sh pet-match-30417.firebasestorage.app
#
# L'extension Resize Images ne réagit qu'à un fichier qui arrive, et sa version
# actuelle n'a plus de rattrapage. On fait donc « arriver » chaque photo qui
# n'a pas encore ses miniatures : un aller-retour par un dossier hors de
# `images/`, qui garde ses métadonnées — et donc son jeton : les adresses en
# base restent valables.
set -euo pipefail

export BUCKET="gs://${1:?bucket manquant : bash scripts/backfill-thumbs.sh <bucket>}"
work="$(mktemp -d)"

gcloud storage ls "$BUCKET/images/**" > "$work/all"
# Ce qui a déjà sa miniature : son chemin, sans dossier `thumbs` ni palier.
grep '/thumbs/.*_640x640\.webp$' "$work/all" | sed -E 's#/thumbs/(.*)_640x640\.webp$#/\1#' | sort -u > "$work/done" || true
# Les photos, et leur chemin sans extension pour comparer.
grep -v '/thumbs/' "$work/all" | awk '{ base=$0; sub(/\.[^.\/]+$/, "", base); print base "\t" $0 }' | sort > "$work/photos"
join -t $'\t' -v 1 "$work/photos" "$work/done" | cut -f2 > "$work/todo"
echo "→ $(wc -l < "$work/todo" | tr -d ' ') photo(s) sans miniature"

roundtrip() {
  local tmp="$BUCKET/tmp-resize/$(echo "$1" | shasum | cut -c1-16)"
  gcloud storage cp -q "$1" "$tmp" >/dev/null 2>&1 \
    && gcloud storage cp -q "$tmp" "$1" >/dev/null 2>&1 \
    && gcloud storage rm -q "$tmp" >/dev/null 2>&1 \
    || echo "✗ $1"
}
export -f roundtrip
xargs -P 8 -I{} bash -c 'roundtrip "$@"' _ {} < "$work/todo"
rm -rf "$work"
echo "✓ Demandé. L'extension met quelques secondes par photo."
