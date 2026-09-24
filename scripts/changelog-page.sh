#!/usr/bin/env bash
# Build the standalone build-log page: HTML plus a copy of every screenshot.
#
#   scripts/changelog-page.sh <outdir>
#
# The output directory is ready to publish as-is: changelog.html references shots/<stage>/…
# relative to itself. The screenshots are already stored web-sized (2000 px WebP, issue
# 0021), so they are copied rather than resized.
set -euo pipefail

OUT="${1:?usage: scripts/changelog-page.sh <outdir>}"
SRC="docs/changelog/shots"

mkdir -p "$OUT"
rm -rf "${OUT:?}/shots"

# Shots in the asset store (docs/changelog/published-assets.json) are referenced by their asset
# URL, so they are not copied: the page may carry at most 255 files.
published=$(node -e 'try { console.log(Object.keys(require("./docs/changelog/published-assets.json")).join("\n")) } catch {}')

count=0
stored=0
while IFS= read -r f; do
  rel="${f#"$SRC"/}"
  if grep -qxF "$rel" <<<"$published"; then stored=$((stored + 1)); continue; fi
  mkdir -p "$OUT/shots/$(dirname "$rel")"
  cp "$f" "$OUT/shots/$rel"
  count=$((count + 1))
done < <(find "$SRC" -name '*.webp' | sort)

npx tsx scripts/changelog-html.ts "$OUT/changelog.html"
# A byte-identical shot is referenced through its twin, so its own copy is not published.
dupes=0
while IFS= read -r f; do rm -f "$f"; dupes=$((dupes + 1)); done < <(
  cd "$OUT/shots" && find . -name '*.webp' -exec shasum {} + | sort -k2 | awk 'seen[$1]++ { print $2 }' | sed "s#^\./#$OUT/shots/#")
echo "shots · $((count - dupes)) images in $OUT/shots ($dupes byte-identical, published once; $stored in the asset store)"
