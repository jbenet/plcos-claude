#!/usr/bin/env bash
# Build the Capital OS image from one commit's tracked files (docs/deploy/rev2/image-and-cutover.md).
#
#   bash scripts/image-build.sh [<commit>] [--tag <name>]
#
# The build context is `git archive <commit>` piped straight into `docker build -`: nothing from
# the working tree (untracked files, data/, plcos-data, .next, node_modules, .env) can enter it.
# Prints the image id, its size and the build time. It never pushes and contacts no registry beyond
# the base-image and npm pulls docker itself makes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

commit="HEAD"; tag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a name}"; shift 2 ;;
    -h|--help) sed -n 2,9p "$0"; exit 0 ;;
    *) commit="$1"; shift ;;
  esac
done

sha="$(git rev-parse --verify -q "${commit}^{commit}")" || { echo "No such commit: $commit" >&2; exit 2; }
short="${sha:0:12}"
tag="${tag:-capital-os:$short}"

# The archive must hold nothing under data/ except its README, and no plcos-data path at all.
bad="$(git ls-tree -r --name-only "$sha" | grep -vx 'data/README.md' | grep -iE '(^|/)plcos-data(/|$)|(^|/)data/real(/|$)|^data/' || true)"
[ -z "$bad" ] || { echo "Refused: commit $short tracks files under data/ or plcos-data." >&2; exit 1; }
echo "Context check passed: git archive $short holds $(git ls-tree -r --name-only "$sha" | wc -l | tr -d ' ') tracked files, none under data/real or plcos-data."
command -v docker >/dev/null 2>&1 || { echo "docker is not installed here; nothing was built." >&2; exit 3; }
start="$(date +%s)"
git archive --format=tar "$sha" | DOCKER_BUILDKIT=1 docker build \
  --build-arg GIT_COMMIT="$sha" --label "org.opencontainers.image.revision=$sha" \
  -t "$tag" -
secs=$(( $(date +%s) - start ))
bytes="$(docker image inspect -f '{{.Size}}' "$tag")"
printf 'Built %s from %s in %ss; image size %s MiB.\n' "$tag" "$short" "$secs" "$(( bytes / 1024 / 1024 ))"
