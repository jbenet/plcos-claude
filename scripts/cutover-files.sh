#!/usr/bin/env bash
# The working files that move to the service's volume at cutover (runbook §3c), and nothing else.
#
#   bash scripts/cutover-files.sh list <real root>                  counts and bytes of what would go
#   bash scripts/cutover-files.sh pack <real root> <out.tar.gz>     archive them; then upload and unpack
#                                                                  under /app/data/real on the volume
#
# Left out, and why:
#   postgres/ database/ database.lock postgres.url   the database moves by pg_dump (cutover.sh), not as files
#   dakota/                                          Dakota stays on the Mac (rev 3 decision 3)
#   logs/ rehearsal/ backups/ .real-copy-* .preview-copy   local history, snapshots and copies
#   the research export files in enrich/             regenerated on the service from the stripped database
#                                                    (runbook §3: "Export the research set"); today's copies
#                                                    can carry Dakota-derived titles and profile links
# The archive is listed back and refused if any excluded path is in it. Prints counts only, never names.
set -euo pipefail
cmd="${1:-}"; root="${2:-}"; out="${3:-}"
case "$cmd" in list|pack) ;; *) sed -n 2,6p "$0" >&2; exit 2;; esac
[ -d "$root" ] || { echo "Refused: $root is not a folder." >&2; exit 2; }
root="$(cd "$root" && pwd -P)"

EXCLUDE_DIRS=(postgres database dakota logs rehearsal backups)
EXCLUDE_FILES=(database.lock postgres.url .preview-copy)
EXPORTS=(research-set.jsonl candidates.jsonl team.json triage.jsonl identity-review.jsonl lp-unit-review.jsonl)
prune=()
for d in "${EXCLUDE_DIRS[@]}"; do prune+=(-path "./$d" -o); done
for f in "${EXCLUDE_FILES[@]}"; do prune+=(-path "./$f" -o); done
for f in "${EXPORTS[@]}"; do prune+=(-path "./enrich/$f" -o); done
prune+=(-name '.real-copy-*')

list="$(mktemp)"; trap 'rm -f "$list"' EXIT
( cd "$root" && find . \( "${prune[@]}" \) -prune -o \( -type f -o -type l \) -print0 ) > "$list"
count="$(tr -cd '\0' < "$list" | wc -c | tr -d ' ')"
if stat -c %s / >/dev/null 2>&1; then size=(stat -c %s); else size=(stat -f %z); fi  # GNU, else BSD (the Mac)
bytes=0; [ "$count" = 0 ] || bytes="$(cd "$root" && xargs -0 "${size[@]}" < "$list" | awk '{s += $1} END {print s + 0}')"
echo "Working files to move: $count files, $(( bytes / 1048576 )) MiB (excluded: ${EXCLUDE_DIRS[*]} ${EXCLUDE_FILES[*]} .real-copy-* and ${#EXPORTS[@]} regenerated exports)."
[ "$cmd" = pack ] || exit 0

[ -n "$out" ] || { echo "Refused: pack needs an output file." >&2; exit 2; }
case "$(cd "$(dirname "$out")" && pwd -P)/" in "$root"/*) echo "Refused: the archive must be written outside $root." >&2; exit 2;; esac
[ ! -e "$out" ] || { echo "Refused: $out exists." >&2; exit 2; }
umask 077
tar -C "$root" --null -T "$list" -czf "$out"
# The fence: read the archive back and refuse anything that should not be in it.
bad="$(tar -tzf "$out" | sed 's#^\./##' | awk -v dirs="${EXCLUDE_DIRS[*]}" -v files="${EXCLUDE_FILES[*]}" -v ex="${EXPORTS[*]}" '
  BEGIN { n = split(dirs, d, " "); m = split(files, f, " "); k = split(ex, e, " ") }
  { for (i = 1; i <= n; i++) if ($0 == d[i] || index($0, d[i] "/") == 1) { print; next }
    for (i = 1; i <= m; i++) if ($0 == f[i]) { print; next }
    for (i = 1; i <= k; i++) if ($0 == "enrich/" e[i]) { print; next }
    if ($0 ~ /(^|\/)\.real-copy-/) print }' | wc -l | tr -d ' ')"
if [ "$bad" != 0 ]; then rm -f "$out"; echo "Refused: $bad excluded paths reached the archive; it was deleted." >&2; exit 1; fi
in_archive="$(tar -tzf "$out" | grep -vc '/$' || true)"
[ "$in_archive" = "$count" ] || { rm -f "$out"; echo "Refused: the archive has $in_archive entries, expected $count; it was deleted." >&2; exit 1; }
echo "Packed $count files into $(basename "$out") ($(( $(wc -c < "$out") / 1048576 )) MiB compressed); no excluded path inside."
