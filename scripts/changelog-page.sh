#!/usr/bin/env bash
# Build the standalone build-log page: HTML plus web-sized copies of every screenshot.
#
#   scripts/changelog-page.sh <outdir>
#
# The output directory is ready to publish as-is: changelog.html references shots/<stage>/…
# relative to itself. Screenshots are captured at 2880px; 2000px keeps them sharp on a
# wide window — which is the whole reason for widening the window — and still cuts the
# payload substantially.
set -euo pipefail

OUT="${1:?usage: scripts/changelog-page.sh <outdir>}"
SRC="docs/changelog/shots"

mkdir -p "$OUT"
rm -rf "${OUT:?}/shots"

count=0
while IFS= read -r f; do
  rel="${f#"$SRC"/}"
  mkdir -p "$OUT/shots/$(dirname "$rel")"
  if command -v sips >/dev/null 2>&1; then
    sips -Z 2000 "$f" --out "$OUT/shots/$rel" >/dev/null
  else
    cp "$f" "$OUT/shots/$rel"   # no resizer available; full size still renders
  fi
  count=$((count + 1))
done < <(find "$SRC" -name '*.png' | sort)

npx tsx scripts/changelog-html.ts "$OUT/changelog.html"
echo "shots · $count images in $OUT/shots"
