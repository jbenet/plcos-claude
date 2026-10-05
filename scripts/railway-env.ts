/**
 * The Railway variable checklist (docs/deploy/railway.md §4), generated from docs/deploy/service.env.example
 * so the two cannot drift: every name in the template gets a row, by its tag, and a few get a Railway
 * note. Names and where each value comes from only; this script never reads a value.
 *
 *   npx tsx scripts/railway-env.ts            the markdown table, for the doc
 *   npx tsx scripts/railway-env.ts --check    exit 1 when the template has a tag this script doesn't know
 */
import { readFileSync } from 'node:fs';

type Row = { name: string; tag: string; secret: boolean };

// What to enter on Railway, by the template's tag. A per-name note below replaces it.
const BY_TAG: Record<string, string> = {
  required: 'Set it.',
  'required-real': 'Set it at cutover (§5 step f).',
  later: 'Leave unset at cutover; set it afterwards.',
  optional: 'Leave unset (the default works).',
  image: 'Do not set: the Dockerfile sets it.',
  internal: 'Do not set: the code sets it.',
  never: '**Never set** on Railway.',
  platform: 'Do not set: Railway sets it.',
};

// Railway-specific notes. ${{Postgres.…}} are Railway reference variables, resolved by Railway; the names
// in "Keychain" are where the Mac keeps the same secret today, to copy from by hand, never through a file.
const RAILWAY: Record<string, string> = {
  DATA_PROFILE: '`demo` for the first boot, `real` at cutover.',
  LABOS_ME_URL: 'Leave unset: sign-in is Google (§3).',
  PLCOS_SECRET: '`openssl rand -base64 32`, sealed. One of the two values that live outside the app; keep a copy in a password manager (§8).',
  PLCOS_PUBLIC_URL: 'Leave unset: /setup fills it from Railway\'s domain.',
  PLCOS_DEPLOYED: 'Do not set: the Dockerfile sets it (Google sign-in, never the user switcher).',
  DATABASE_URL: '`postgresql://plcos_app@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plcos_demo` first, then `…/plcos_live`. No password in it.',
  PGPASSWORD: 'The `plcos_app` password you set on Railway Postgres (§4 step 2). One of the two secrets that live outside the app.',
  PGSSLMODE: 'Leave unset on the private network (code change 1).',
  ANTHROPIC_API_KEY: 'Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins.',
  FEEDBACK_EXPORT_TOKEN: 'Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET. An env value still wins.',
  SCHEDULE_DAILY_AT: '`03:00` (UTC), the day after a manual Affinity sync works from Railway.',
  BACKUP_COMMAND: 'Leave unset: no S3 for now. Railway backs up its volumes, and the Mac keeps encrypted pulls (§8).',
  BACKUP_BUCKET: 'Leave unset (no S3 for now, §8).',
  BACKUP_GPG_PUBLIC_KEY: 'Leave unset (no S3 for now, §8).',
  AWS_REGION: 'Leave unset (no S3 for now, §8).',
  AWS_ACCESS_KEY_ID: 'Leave unset (no S3 for now, §8).',
  AWS_SECRET_ACCESS_KEY: 'Leave unset (no S3 for now, §8).',
  PORT: 'Do not set: Railway sets it, and the image listens on it.',
  GIT_COMMIT: 'Build argument; code change 2 takes it from Railway\'s commit variable.',
  DAKOTA_USERNAME: 'Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET (decision C: Dakota moves to the cloud). An env value still wins.',
  DAKOTA_PASSWORD: 'Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET. An env value still wins.',
};

// Connector variables are matched by prefix: only each connector's own folder names them (npm run boundaries).
const BY_PREFIX: Array<[string, string]> = [
  ['AFFINITY_', 'Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins.'],
  ['LINEAR_', 'Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins.'],
  ['GOOGLE_SIGNIN_', 'Leave unset: enter it in /setup (then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins.'],
  // Mailguard's address; its token is tagged never, which wins below.
  ['MAILGUARD_', 'Leave unset: enter it in Settings → Connections. An env value still wins.'],
];
const note = (r: Row) => RAILWAY[r.name] ?? (r.tag === 'never' ? undefined : BY_PREFIX.find(([p]) => r.name.startsWith(p))?.[1]) ?? BY_TAG[r.tag];

// Railway's own settings that are not in the template, because the code never reads them.
const EXTRA: Array<[string, string]> = [
  ['RAILWAY_RUN_UID', '`0`: the entrypoint starts as root only to hand `/app/data` to user 10001, then drops to it (§2).'],
];

export function readTemplate(path = 'docs/deploy/service.env.example'): Row[] {
  const rows: Row[] = [];
  let tag = '', secret = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = /^# \[([a-z-]+)\](.*)$/.exec(line);
    if (t) { tag = t[1]!; secret = /\bsecret\b/.test(t[2]!); continue; }
    const v = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (v) { rows.push({ name: v[1]!, tag, secret }); tag = ''; secret = false; }
  }
  return rows;
}

function main() {
  const rows = readTemplate();
  const unknown = rows.filter(r => !BY_TAG[r.tag]);
  if (unknown.length) {
    console.error(`Unknown tag on: ${unknown.map(r => r.name).join(', ')}. Add the tag to scripts/railway-env.ts.`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) { console.log(`${rows.length} names, every tag known.`); return; }
  const out = ['| Variable | Tag | Secret | On Railway |', '|---|---|---|---|'];
  for (const r of rows) out.push(`| \`${r.name}\` | ${r.tag} | ${r.secret ? 'yes' : ''} | ${note(r)} |`);
  for (const [name, note] of EXTRA) out.push(`| \`${name}\` | railway | | ${note} |`);
  console.log(out.join('\n'));
}

if (process.argv[1]?.endsWith('railway-env.ts')) main();
