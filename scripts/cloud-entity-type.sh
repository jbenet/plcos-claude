#!/usr/bin/env bash
# A record's local type on the cloud app, by token (lib/sync/entity-type.ts; issue 0063). Run on the Mac, like
# scripts/cloud-feedback.sh. Names are real data: the list lands in data/real/entity-types.tsv and only ids and
# counts reach the terminal.
#
#   bash scripts/cloud-entity-type.sh list                       pipeline people named like an organisation we hold,
#                                                                with any person evidence, to data/real/entity-types.tsv
#   bash scripts/cloud-entity-type.sh show <id>                  one record by its pipeline or entity id (or its first 8+
#                                                                characters), to data/real/entity-type-<id>.json
#   bash scripts/cloud-entity-type.sh find '<name>'              every current record whose name holds those words, any
#                                                                type, to data/real/entity-find.json (issue 0138)
#   bash scripts/cloud-entity-type.sh review '<name>'            the duplicate groups held back for review by that name,
#                                                                with W13 group ids and reasons, to data/real/identity-review-find.json
#   bash scripts/cloud-entity-type.sh tickets                    undecided approval tickets counted by kind, requester and
#                                                                state; counts only (issue 0137)
#   bash scripts/cloud-entity-type.sh org <entity id> 'reason'   marks that record an organisation (local, reversible)
#   bash scripts/cloud-entity-type.sh person <entity id> 'reason'
#   bash scripts/cloud-entity-type.sh reverse <correction id> 'reason'
#
# The token needs the sync:admin scope, which only an Admin holds (Preferences → MCP access → "Admin").
# Secrets, never printed and never on a command line, as for scripts/cloud-push.sh:
#   the token     Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests).
#   the app URL   CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
die() { printf '[cloud-entity-type] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO="${CLOUD_APP_URL:-}"
[ -n "$TO" ] || TO="$(keychain app-url || true)"
[ -n "$TO" ] || die "no destination: set CLOUD_APP_URL, or store it as Keychain item plcos-railway / app-url"
TO="${TO%/}"
if [[ "$TO" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then proto='=https'
elif [[ "$TO" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then proto='=http'
else die "CLOUD_APP_URL must be https://<host> (http only on 127.0.0.1, for tests)"; fi
if [ -n "${CLOUD_PUSH_TOKEN+set}" ]; then token="$CLOUD_PUSH_TOKEN"; else token="$(keychain push-token || true)"; fi
[[ "$token" =~ ^plcos_mcp_[A-Za-z0-9_-]{30,80}$ ]] \
  || die "no token: make an \"Admin\" token in Preferences → MCP access and store it as Keychain item plcos-railway / push-token"

OUT="data/real/entity-types.tsv"
UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
call() { curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"; }
answer() {
  local code="${1##*$'\n'}" reply="${1%$'\n'*}"
  printf '%s' "$reply" | node -e '
const [code, mode, out] = process.argv.slice(1);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error(`[cloud-entity-type] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-entity-type] REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
if (mode === "list") {
  const fs = require("fs"), path = require("path");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const rows = a.items.map((c) => [c.entityId, c.name, c.pursuits, c.evidence.join(",") || "none", c.organizations.join(",")].join("\t"));
  fs.writeFileSync(out, ["entity\tname\tpipelines\tperson evidence\torganisations", ...rows].join("\n") + "\n");
  const bare = a.items.filter((c) => !c.evidence.length).length;
  console.log(`[cloud-entity-type] ${a.items.length} listed, ${bare} with no person evidence: ${out}`);
} else if (mode === "show") {
  const fs = require("fs"), path = require("path");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(a.records, null, 2) + "\n");
  console.log(`[cloud-entity-type] ${a.records.length} record(s): ${out}`);
  for (const r of a.records) console.log([r.entityId, r.type, `${r.pursuits.length} pipeline(s)`, `${r.corrections.filter((c) => !c.reversedAt).length} active correction(s)`,
    `${r.organizations.length} same-name organisation(s)`, `evidence: ${r.evidence.join(",") || "none"}`, r.mergedInto ? `merged into ${r.mergedInto}` : ""].join("\t"));
} else if (mode === "find" || mode === "review") {
  const fs = require("fs"), path = require("path");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const list = mode === "find" ? a.entities : a.groups;
  fs.writeFileSync(out, JSON.stringify(list, null, 2) + "\n");
  console.log(`[cloud-entity-type] ${list.length} ${mode === "find" ? "record(s)" : "group(s)"}: ${out}`);
  if (mode === "find") for (const e of list) console.log([e.entityId, e.type, e.roles.join(",") || "no role", `${e.pursuits} pipeline(s)`].join("\t"));
  else for (const g of list) console.log([g.group.slice(0, 12), `${g.members.length} members`, g.members.map((m) => m.type).join(","), g.reason].join("\t"));
} else if (mode === "tickets") {
  for (const t of a.tickets) console.log([t.kind, t.requester, t.state, t.count].join("\t"));
  console.log(`[cloud-entity-type] ${a.tickets.reduce((n, t) => n + t.count, 0)} undecided ticket(s)`);
} else if (mode === "reverse") console.log(`[cloud-entity-type] ${a.reversed ? "reversed" : "already reversed"}`);
else console.log(`[cloud-entity-type] ${a.correctionId ? `corrected: ${a.correctionId}` : "already that type"}`);
' "$code" "$2" "${3:-}"
}
post() {
  local body
  body="$(node -e 'const [op, id, type, reason] = process.argv.slice(1);
    process.stdout.write(JSON.stringify(op === "reverse" ? { operation: op, correctionId: id, reason }
      : { operation: op, entityId: id, type, reason, requestKey: `mac:${id}:${type}` }))' "$1" "$2" "${3:-}" "$4")"
  answer "$(printf '%s' "$body" | call -H 'Content-Type: application/json' --data-binary @- -w '\n%{http_code}' "$TO/api/sync/entity-type")" "$1"
}

case "${1:-}" in
  list) [ $# -eq 1 ] || usage; answer "$(call -w '\n%{http_code}' "$TO/api/sync/entity-type")" list "$OUT" ;;
  show) [ $# -eq 2 ] && [[ "$2" =~ ^[0-9a-fA-F-]{8,36}$ ]] || usage; answer "$(call -w '\n%{http_code}' "$TO/api/sync/entity-type?id=$2")" show "data/real/entity-type-$2.json" ;;
  tickets) [ $# -eq 1 ] || usage; answer "$(call -w '\n%{http_code}' "$TO/api/sync/entity-type?tickets=open")" tickets ;;
  find|review) [ $# -eq 2 ] && [ -n "$2" ] || usage
    q="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$2")"
    answer "$(call --max-time 300 -w '\n%{http_code}' "$TO/api/sync/entity-type?$1=$q")" "$1" "data/real/$([ "$1" = find ] && echo entity-find || echo identity-review-find).json" ;;
  org|person) [ $# -eq 3 ] && [[ "$2" =~ $UUID ]] && [ -n "$3" ] || usage; post correct "$2" "$1" "$3" ;;
  reverse) [ $# -eq 3 ] && [[ "$2" =~ $UUID ]] && [ -n "$3" ] || usage; post reverse "$2" "" "$3" ;;
  *) usage ;;
esac
