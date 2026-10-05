/** Service preparation (docs/deploy/status-2026-09-30.md): the env template stays complete, preflight
 * prints names and never values, and the cutover file pack leaves out what must stay on the Mac.
 * Invented inputs only; no database, keys or network. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Check } from './harness';

const TAGS = new Set(['required', 'required-real', 'later', 'optional', 'image', 'internal', 'never']);

async function sources(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await sources(p, out);
    else if (/\.(?:tsx?|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

export async function serviceEnvTemplate(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let tag = '';
  for (const line of (await readFile('docs/deploy/service.env.example', 'utf8')).split('\n')) {
    const t = /^# \[([a-z-]+)\]/.exec(line);
    if (t) { tag = t[1]!; continue; }
    const v = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (v) { names.set(v[1]!, v[2]!.trim() ? `VALUE:${tag}` : tag); tag = ''; }
  }
  return names;
}

/** Every environment variable the running service reads: the app's code and the backup script. */
export async function serviceEnvReads(): Promise<Set<string>> {
  const read = new Set<string>();
  const files = [...await sources('app'), ...await sources('lib'), ...await sources('config'), 'instrumentation.ts'];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const m of text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) read.add((m[1] ?? m[2])!);
    // An indirect read names its variable in a constant first (lib/connectors/linear/key.ts).
    if (/process\.env\[[A-Z_]+\]/.test(text)) for (const m of text.matchAll(/const [A-Z_]+ = '([A-Z][A-Z0-9_]*)'/g)) read.add(m[1]!);
  }
  const backup = await readFile('scripts/backup-service.sh', 'utf8');
  for (const m of backup.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}]/g)) read.add(m[1]!);
  return read;
}

export async function serviceEnvProperties(check: Check): Promise<void> {
  const template = await serviceEnvTemplate();
  const reads = await serviceEnvReads();
  const unlisted = [...reads].filter(n => !template.has(n)).sort();
  check('SERVICE ENV template lists every variable the service reads',
    unlisted.length === 0 && reads.size > 15,
    unlisted.length ? `Add to docs/deploy/service.env.example: ${unlisted.join(', ')}` : `${reads.size} variables read, all listed.`);
  const badTag = [...template].filter(([, tag]) => !TAGS.has(tag)).map(([n, tag]) => `${n} (${tag || 'no tag'})`);
  check('SERVICE ENV template tags every name and holds no value', badTag.length === 0,
    badTag.length ? `Fix: ${badTag.join(', ')}` : `${template.size} names, each tagged, all values empty.`);

  const scratch = await mkdtemp(join(tmpdir(), 'service-prep-'));
  try {
    // Preflight: names only. An invented secret-looking value must never reach its output.
    const decoy = 'invented-decoy-value-7f3a';
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DATA_PROFILE: 'real', DAKOTA_PASSWORD: decoy };
    env[[...template.keys()].find(n => n.startsWith('AFFINITY'))!] = decoy;
    const run = spawnSync('bash', ['scripts/preflight.sh', '--dry'], { encoding: 'utf8', timeout: 60_000, env: env as NodeJS.ProcessEnv });
    const out = `${run.stdout}${run.stderr}`;
    check('PREFLIGHT prints variable names, never values, and fails a Mac-only variable',
      run.status === 1 && !out.includes(decoy) && /FAIL env-forbidden +must be unset on the service: DAKOTA_PASSWORD/.test(out)
        && /FAIL env +unset: .*LABOS_ME_URL/.test(out) && /FAIL database +DATABASE_URL unset/.test(out),
      'Dry run with invented values; DATA_PROFILE=real makes the real-only keys required.');

    // Cutover files: an invented real root with every excluded kind of path, plus files that must go.
    const root = join(scratch, 'real');
    const keep = ['enrich/raw/invented-a.json', 'enrich/batches/b1.txt', 'issues/0001.md', 'workflows/runs.jsonl', 'prospects/p.json',
      'dakota/raw/account.jsonl'];
    const drop = ['postgres/PG_VERSION', 'database/pglite.bin', 'database.lock', 'postgres.url',
      'logs/server.log', 'rehearsal/x.dump', 'backups/b.gpg', '.real-copy-20260928/database/x', '.preview-copy',
      'enrich/identity-review.jsonl', 'enrich/research-set.jsonl', 'enrich/lp-unit-review.jsonl'];
    for (const f of [...keep, ...drop]) { await mkdir(dirname(join(root, f)), { recursive: true }); await writeFile(join(root, f), 'invented\n'); }
    const out1 = join(scratch, 'files.tar.gz');
    const pack = spawnSync('bash', ['scripts/cutover-files.sh', 'pack', root, out1], { encoding: 'utf8' });
    const listed = spawnSync('tar', ['-tzf', out1], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map(s => s.replace(/^\.\//, '')).sort();
    check('CUTOVER FILES pack moves the working files, Dakota\'s replica included, and leaves out databases, snapshots and exports',
      pack.status === 0 && JSON.stringify(listed) === JSON.stringify([...keep].sort()) && /Packed 6 files/.test(pack.stdout),
      `Invented tree: ${keep.length} kept, ${drop.length} excluded paths absent from the archive.`);
    const inside = spawnSync('bash', ['scripts/cutover-files.sh', 'pack', root, join(root, 'enrich', 'x.tar.gz')], { encoding: 'utf8' });
    const again = spawnSync('bash', ['scripts/cutover-files.sh', 'pack', root, out1], { encoding: 'utf8' });
    check('CUTOVER FILES refuses an archive inside the root or over an existing file',
      inside.status !== 0 && /outside/.test(inside.stderr) && again.status !== 0 && /exists/.test(again.stderr), 'Two refusals, nothing written.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
