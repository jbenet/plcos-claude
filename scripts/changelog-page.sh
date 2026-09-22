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

count=0
while IFS= read -r f; do
  rel="${f#"$SRC"/}"
  mkdir -p "$OUT/shots/$(dirname "$rel")"
  cp "$f" "$OUT/shots/$rel"
  count=$((count + 1))
done < <(find "$SRC" -name '*.webp' | sort)

npx tsx scripts/changelog-html.ts "$OUT/changelog.html"
echo "shots · $count images in $OUT/shots"
