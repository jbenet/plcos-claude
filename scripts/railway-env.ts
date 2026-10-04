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
  'required-real': 'Set it at cutover (step 5f).',
  later: 'Leave unset at cutover; set it afterwards.',
  optional: 'Leave unset (the default works).',
  image: 'Do not set: the Dockerfile sets it.',
  internal: 'Do not set: the code sets it.',
  never: '**Never set** on Railway.',
};

// Railway-specific notes. ${{Postgres.…}} are Railway reference variables, resolved by Railway; the names
// in "Keychain" are where the Mac keeps the same secret today, to copy from by hand, never through a file.
const RAILWAY: Record<string, string> = {
  DATA_PROFILE: '`demo` for the first boot, `real` at cutover.',
  LABOS_ME_URL: 'Decision A. Set only if LabOS sign-in can reach the Railway domain; otherwise the sign-in that replaces it.',
  DATABASE_URL: '`postgresql://plcos_app@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plcos_demo` first, then `…/plcos_live`. No password in it.',
  PGPASSWORD: 'The `plcos_app` password you set on Railway Postgres (§4 step 3). Not the Mac\'s: new passwords for the cloud.',
  PGSSLMODE: 'Leave unset on the private network (code change 1).',
  ANTHROPIC_API_KEY: 'From an Anthropic workspace with a monthly limit. Set when the cloud research jobs start (§7).',
  FEEDBACK_EXPORT_TOKEN: 'A new random token (`openssl rand -hex 32`); the Mac keeps its copy with `npm run secret:store -- feedback-export-token`.',
  SCHEDULE_DAILY_AT: '`03:00` (UTC), the day after a manual Affinity sync works from Railway.',
  BACKUP_COMMAND: '`bash scripts/backup-service.sh`',
  BACKUP_BUCKET: 'The S3 bucket in your AWS account (decision D).',
  BACKUP_GPG_PUBLIC_KEY: 'The armored public half only (rev3.md "Backups"). The private half never goes to Railway.',
  AWS_REGION: 'The bucket\'s region.',
  AWS_ACCESS_KEY_ID: 'An IAM user that can only put, list and delete under the bucket\'s `plcos-*` prefixes. Railway has no AWS role.',
  AWS_SECRET_ACCESS_KEY: 'That IAM user\'s secret.',
  PORT: 'Do not set: Railway sets it, and the image listens on it.',
  GIT_COMMIT: 'Build argument; code change 2 takes it from Railway\'s commit variable.',
  DAKOTA_USERNAME: '**Never set.** Dakota stays on the Mac (decision C).',
  DAKOTA_PASSWORD: '**Never set.** See DAKOTA_USERNAME.',
};

// Connector variables are matched by prefix: only each connector's own folder names them (npm run boundaries).
const BY_PREFIX: Array<[string, string]> = [
  ['AFFINITY_', 'Keychain `plcos-affinity`. Set at cutover.'],
  ['LINEAR_', 'Keychain `plcos-linear` / `api-key`. Set at cutover.'],
  ['GOOGLE_OAUTH_', '**Not yet.** Gmail drafts move to the cloud with decision A\'s Google option, or later (docs/25).'],
];
const note = (r: Row) => RAILWAY[r.name] ?? BY_PREFIX.find(([p]) => r.name.startsWith(p))?.[1] ?? BY_TAG[r.tag];

// Railway's own settings that are not in the template, because the code never reads them.
const EXTRA: Array<[string, string]> = [
  ['RAILWAY_RUN_UID', '`0` only if the volume is not writable by the image\'s user 10001 (code change 3); remove it once that change lands.'],
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
