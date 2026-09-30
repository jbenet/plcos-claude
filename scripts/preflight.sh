#!/usr/bin/env bash
# Does this machine meet the rev 3 plan (docs/deploy/rev3.md)? Run it inside the app's container, or on
# the VM fallback, before the first deploy and again before cutover.
#
#   bash scripts/preflight.sh          every check, including S3, egress and LabOS reachability
#   bash scripts/preflight.sh --dry    local checks only: no network except a loopback database
#
# Prints one line per check: PASS, WARN, FAIL or SKIP. Exits 1 on any FAIL. It prints variable NAMES
# and whether they are set, never a value. It reads the database (SELECT only) and, without --dry,
# writes and deletes one small marker object under plcos-preflight/ in the backup bucket.
# The limits come from rev 3's ask; the minimums are the runbook's measured floors.
set -uo pipefail
cd "$(dirname "$0")/.."

DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
NEED_MEM_GIB=6; MIN_MEM_GIB=4        # rev 3 ask; runbook §5: 4 GiB leaves almost no headroom
NEED_CPU=2
NEED_VOLUME_GB=20; MIN_FREE_GB=4     # 2.1 GB of working files at cutover (runbook §3c), plus room
NEED_PG_MAJOR=16                     # rev 3: 17, 16 works
TEMPLATE=docs/deploy/service.env.example
fails=0; warns=0
line() { printf '%-4s %-22s %s\n' "$1" "$2" "$3"; }
pass() { line PASS "$1" "$2"; }
warn() { line WARN "$1" "$2"; warns=$((warns + 1)); }
fail() { line FAIL "$1" "$2"; fails=$((fails + 1)); }
skip() { line SKIP "$1" "$2"; }
# Missing tools are a FAIL on the target and a WARN in a dry run on another machine.
need() { if [ "$DRY" = 1 ]; then warn "$@"; else fail "$@"; fi; }
loopback() { case "$1" in 127.0.0.1|localhost|::1|'[::1]'|'') return 0;; *) return 1;; esac; }
echo "Preflight $( [ "$DRY" = 1 ] && echo '(dry: no network beyond loopback)' ) on $(uname -sm), $(date -u +%Y-%m-%dT%H:%MZ)"

# ---- environment (names only) ------------------------------------------------------------------
profile="${DATA_PROFILE:-}"
if [ -f "$TEMPLATE" ]; then
  missing=(); later=(); forbidden=()
  tag=""
  while IFS= read -r l; do
    case "$l" in
      '# ['*) tag="${l#\# [}"; tag="${tag%%]*}";;
      [A-Z]*=*)
        name="${l%%=*}"
        if [ -n "${!name+x}" ] && [ -n "${!name}" ]; then set=1; else set=0; fi
        case "$tag" in
          required) [ "$set" = 1 ] || missing+=("$name");;
          required-real) [ "$profile" != real ] || [ "$set" = 1 ] || missing+=("$name");;
          later) [ "$set" = 1 ] || later+=("$name");;
          never) [ "$set" = 0 ] || forbidden+=("$name");;
        esac
        tag="";;
    esac
  done < "$TEMPLATE"
  [ ${#missing[@]} -eq 0 ] && pass env "required variables set (profile ${profile:-unset})" || fail env "unset: ${missing[*]}"
  [ ${#forbidden[@]} -eq 0 ] && pass env-forbidden "no Mac-only variable set" || fail env-forbidden "must be unset on the service: ${forbidden[*]}"
  [ ${#later[@]} -eq 0 ] || warn env-later "not yet set (fine at cutover): ${later[*]}"
else
  fail env "$TEMPLATE not found"
fi
case "$profile" in demo|real) ;; *) fail profile "DATA_PROFILE must be demo or real";; esac
if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in *://*:*@*) fail db-url "DATABASE_URL carries a password; use PGPASSWORD";; esac
fi

# ---- runtime -----------------------------------------------------------------------------------
want_node="$(sed -n 's/^ARG NODE_VERSION=\([0-9]*\).*/\1/p' Dockerfile 2>/dev/null)"
if command -v node >/dev/null; then
  have_node="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$have_node" = "${want_node:-$have_node}" ] && pass node "v$(node -p process.versions.node)" || warn node "v$have_node here, the image uses $want_node"
else fail node "not installed"; fi
if node -e "require('child_process').execFileSync(process.execPath,['-e','0']); new (require('worker_threads').Worker)('0',{eval:true}).on('exit',c=>process.exit(c))" 2>/dev/null; then
  pass processes "a child process and a worker thread start"
else fail processes "cannot start a child process or worker thread (imports need both)"; fi
nofile="$(ulimit -n)"
[ "$nofile" = unlimited ] || [ "$nofile" -ge 1024 ] && pass open-files "ulimit -n $nofile" || warn open-files "ulimit -n $nofile is low"

# ---- memory and CPU (the container's limits when there are any) ---------------------------------
mem=""
if [ -r /sys/fs/cgroup/memory.max ] && [ "$(cat /sys/fs/cgroup/memory.max)" != max ]; then mem="$(cat /sys/fs/cgroup/memory.max)"
elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ] && [ "$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)" -lt 1000000000000000 ]; then mem="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
elif [ -r /proc/meminfo ]; then mem="$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) * 1024 ))"
elif command -v sysctl >/dev/null; then mem="$(sysctl -n hw.memsize 2>/dev/null)"; fi
if [ -n "$mem" ]; then
  gib10="$(( mem * 10 / 1073741824 ))"; shown="$((gib10 / 10)).$((gib10 % 10)) GiB"
  if [ "$gib10" -ge $((NEED_MEM_GIB * 10)) ]; then pass memory "$shown"
  elif [ "$gib10" -ge $((MIN_MEM_GIB * 10)) ]; then warn memory "$shown: under the ${NEED_MEM_GIB} GiB asked; never run two heavy imports at once"
  else fail memory "$shown: under the ${MIN_MEM_GIB} GiB floor (server 1.25 GiB + findings import 2.43 GiB)"; fi
else warn memory "could not read the memory limit"; fi
cpus=""
if [ -r /sys/fs/cgroup/cpu.max ] && read -r quota period < /sys/fs/cgroup/cpu.max && [ "$quota" != max ]; then cpus="$(( (quota + period - 1) / period ))"
elif command -v nproc >/dev/null; then cpus="$(nproc)"
elif command -v sysctl >/dev/null; then cpus="$(sysctl -n hw.ncpu 2>/dev/null)"; fi
[ -n "$cpus" ] && { [ "$cpus" -ge "$NEED_CPU" ] && pass cpu "$cpus" || fail cpu "$cpus, need $NEED_CPU"; } || warn cpu "could not read the CPU limit"

# ---- the data volume (config.data.root) ---------------------------------------------------------
root="data/${profile:-demo}"
probe_dir="$root"; [ -d "$probe_dir" ] || probe_dir="data"
if [ -d "$probe_dir" ]; then
  read -r total_kb free_kb < <(df -Pk "$probe_dir" | awk 'NR==2 {print $2, $4}')
  total_gb=$(( total_kb / 1000000 )); free_gb=$(( free_kb / 1000000 ))
  [ "$free_gb" -ge "$MIN_FREE_GB" ] && pass disk-free "$free_gb GB free at $probe_dir" || fail disk-free "$free_gb GB free at $probe_dir, need $MIN_FREE_GB"
  [ "$total_gb" -ge "$NEED_VOLUME_GB" ] && pass disk-size "$total_gb GB volume" || warn disk-size "$total_gb GB volume, asked for $NEED_VOLUME_GB"
  marker="$probe_dir/.preflight-$$"
  if ( umask 077; : > "$marker" ) 2>/dev/null; then rm -f "$marker"; pass disk-write "$probe_dir is writable"
  else fail disk-write "$probe_dir is not writable by uid $(id -u)"; fi
else fail disk "no data folder at $(pwd)/data (the volume mounts there)"; fi

# ---- tools the backup and cutover run -----------------------------------------------------------
client_major=""
for t in pg_dump pg_restore psql; do
  if command -v "$t" >/dev/null; then
    v="$("$t" --version | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"; client_major="${v%%.*}"
    [ "$client_major" -ge 17 ] && pass "$t" "$v" || warn "$t" "$v, the image ships 17"
  else need "$t" "not installed (the image installs postgresql-client-17)"; fi
done
command -v gpg >/dev/null && pass gpg "$(gpg --version | head -1)" || need gpg "not installed"
command -v aws >/dev/null && pass aws "$(aws --version 2>&1 | head -1)" || need aws "not installed (backups upload with it)"

# ---- TLS trust for PL's database ------------------------------------------------------------------
for var in NODE_EXTRA_CA_CERTS PGSSLROOTCERT; do
  file="${!var:-}"
  if [ -z "$file" ]; then need "$var" "unset (the image sets the RDS CA bundle)"; continue; fi
  out="$(node -e '
    const pem = require("fs").readFileSync(process.argv[1], "utf8");
    const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    const { X509Certificate } = require("crypto");
    const live = certs.map(c => new X509Certificate(c)).filter(c => new Date(c.validTo) > new Date());
    console.log(`${certs.length} ${live.length}`);' "$file" 2>/dev/null)"
  read -r n ok <<< "${out:-0 0}"
  [ "${ok:-0}" -gt 0 ] && pass "$var" "$n certificates, $ok unexpired" || fail "$var" "$file holds no unexpired certificate"
done

# ---- database -----------------------------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  fail database "DATABASE_URL unset"
else
  host="$(node -e 'try { console.log(new URL(process.argv[1]).hostname) } catch { console.log("?") }' "$DATABASE_URL")"
  if ! loopback "$host"; then
    mode="${PGSSLMODE:-}"; case "$DATABASE_URL" in *sslmode=verify-full*) mode=verify-full;; esac
    [ "$mode" = verify-full ] && pass db-tls-mode "verify-full for pg_dump and psql" || fail db-tls-mode "remote database: set PGSSLMODE=verify-full"
  fi
  if [ "$DRY" = 1 ] && ! loopback "$host"; then
    skip database "remote database not contacted in a dry run"
  elif ! command -v psql >/dev/null; then
    skip database "no psql"
  else
    q="select current_setting('server_version_num'), split_part(current_setting('server_version'), ' ', 1),
       coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false),
       has_database_privilege(current_database(), 'CREATE'),
       (select pg_get_userbyid(datdba) = current_user from pg_database where datname = current_database()),
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_')"
    if row="$(PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -XAtq -F ' ' -v ON_ERROR_STOP=1 -c "$q" 2>/dev/null)"; then
      read -r num ver ssl create owner tables <<< "$row"
      [ "$num" -ge $((NEED_PG_MAJOR * 10000)) ] && pass db-version "Postgres $ver" || fail db-version "Postgres $ver, need $NEED_PG_MAJOR+"
      [ -z "$client_major" ] || [ "$client_major" -ge $((num / 10000)) ] || fail db-client "pg_dump $client_major cannot dump server $((num / 10000))"
      if loopback "$host"; then pass db-tls "loopback, no TLS needed"
      elif [ "$ssl" = t ]; then pass db-tls "connection is TLS"; else fail db-tls "connection is not TLS"; fi
      [ "$create" = t ] && pass db-create "may create schemas (migrations)" || fail db-create "cannot CREATE in the database (migrations need it)"
      [ "$owner" = t ] && pass db-owner "owns the database (cutover's freeze needs ALTER DATABASE)" || warn db-owner "does not own the database; cutover.sh's freeze needs ALTER DATABASE"
      pass db-tables "$tables tables (cutover needs an empty target)"
    else
      fail database "cannot connect or query (the URL is not printed)"
    fi
  fi
fi

# ---- backup key ------------------------------------------------------------------------------------
if [ -n "${BACKUP_GPG_PUBLIC_KEY:-}" ] && command -v gpg >/dev/null; then
  g="$(mktemp -d)"
  if printf '%s\n' "$BACKUP_GPG_PUBLIC_KEY" | GNUPGHOME="$g" gpg --batch --quiet --import 2>/dev/null; then
    listing="$(GNUPGHOME="$g" gpg --batch --with-colons --list-keys 2>/dev/null)"
    fpr="$(awk -F: '$1 == "fpr" {print $10; exit}' <<< "$listing")"
    secret="$(GNUPGHOME="$g" gpg --batch --with-colons --list-secret-keys 2>/dev/null | grep -c '^sec' || true)"
    if [ "${secret:-0}" -gt 0 ]; then fail backup-key "BACKUP_GPG_PUBLIC_KEY holds a PRIVATE key; replace it with the public half"
    elif awk -F: '($1 == "pub" || $1 == "sub") && $12 ~ /[eE]/ {f=1} END {exit !f}' <<< "$listing"; then pass backup-key "public key $fpr can encrypt"
    else fail backup-key "the key cannot encrypt"; fi
  else fail backup-key "BACKUP_GPG_PUBLIC_KEY does not import"; fi
  GNUPGHOME="$g" gpgconf --kill all 2>/dev/null; rm -rf "$g"
else
  skip backup-key "BACKUP_GPG_PUBLIC_KEY unset"
fi

# ---- network: S3, the connector APIs and LabOS ---------------------------------------------------
if [ "$DRY" = 1 ]; then
  skip s3 "dry run: would put, list and delete plcos-preflight/<stamp> in \$BACKUP_BUCKET"
  skip egress "dry run: would reach api.affinity.co, api.linear.app, api.anthropic.com"
  skip labos "dry run: would expect 401 from \$LABOS_ME_URL without a token"
else
  if [ -n "${BACKUP_BUCKET:-}" ] && command -v aws >/dev/null; then
    key="plcos-preflight/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    if printf 'preflight\n' | aws s3 cp - "s3://$BACKUP_BUCKET/$key" >/dev/null 2>&1 \
      && aws s3 ls "s3://$BACKUP_BUCKET/plcos-preflight/" >/dev/null 2>&1 \
      && aws s3 rm "s3://$BACKUP_BUCKET/$key" >/dev/null 2>&1; then
      pass s3 "put, list and delete work in the bucket"
    else fail s3 "put, list or delete failed (the backup needs all three)"; fi
  else skip s3 "BACKUP_BUCKET unset or no aws CLI"; fi
  # Any HTTP answer proves the route; no credential is sent.
  for url in https://api.affinity.co https://api.linear.app https://api.anthropic.com; do
    status="$(node -e 'fetch(process.argv[1],{method:"HEAD",signal:AbortSignal.timeout(8000)}).then(r=>console.log(r.status),()=>console.log(0))' "$url")"
    [ "$status" != 0 ] && pass egress "$url answers ($status)" || fail egress "$url unreachable"
  done
  if [ -n "${LABOS_ME_URL:-}" ]; then
    status="$(node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(8000)}).then(r=>console.log(r.status),()=>console.log(0))' "$LABOS_ME_URL")"
    [ "$status" = 401 ] && pass labos "/me answers 401 without a token" || fail labos "/me answered $status without a token (expected 401)"
  fi
fi

echo "Preflight: $fails failed, $warns warnings."
[ "$fails" -eq 0 ]
