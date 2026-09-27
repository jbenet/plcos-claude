/**
 * The Dakota workflow (docs/20-dakota.md). Run through the Keychain wrapper, from the live folder:
 *
 *   scripts/with-dakota-key.sh env DATA_PROFILE=real npx tsx scripts/dakota-sync.ts test
 *
 * `test` signs in and asks for record counts only — no records — and writes them to
 * data/real/dakota/test-<time>.json, recorded as a run in the workflow ledger. Later operations
 * (a bulk replica of a module into data/real/dakota/raw/, then a translate step into the database,
 * the same split as Affinity's so re-mapping never needs another query) land here too.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import FIELDS from '../lib/connectors/dakota/fields.json';
import { join, resolve } from 'node:path';
import { DakotaClient } from '../lib/connectors/dakota/client';
import { beginRun, finishRun, realRoot } from '../lib/workflows/ledger';

const MODULES = ['account', 'contact', 'investment', 'investment_strategy'];

async function main() {
  const op = process.argv[2];
  if (op === 'pull') return pull();
  if (op !== 'test') throw new Error('usage: dakota-sync.ts test|pull');
  const user = process.env.DAKOTA_USERNAME, pass = process.env.DAKOTA_PASSWORD;
  if (!user || !pass) throw new Error('No Dakota sign-in in the environment: run through scripts/with-dakota-key.sh');
  const root = await realRoot();
  const protocol = createHash('sha256').update('dakota-test-v1: sign in, count_only per module, no records').digest('hex');
  const runId = await beginRun({ parentRunId: null, workflow: 'dakota', operation: 'test', protocol: { version: 'v1', hash: protocol },
    source: 'script', agent: 'Claude', model: null, launchFolder: resolve('.'), workerFolder: resolve('.'),
    batch: { id: 'dakota-test', manifest: 'modules:' + MODULES.join(','), hash: createHash('sha256').update(MODULES.join(',')).digest('hex'), planned: MODULES.length } });
  const client = new DakotaClient(user, pass);
  const counts: Record<string, number | string> = {};
  let failed = 0;
  for (const m of MODULES) {
    try { counts[m] = await client.count(m); }
    catch (err) { failed++; counts[m] = err instanceof Error ? err.message : String(err); if (/stop and come back/.test(String(err))) break; }
  }
  await mkdir(join(root, 'dakota'), { recursive: true });
  const file = join(root, 'dakota', `test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), requests: client.requests, counts }, null, 2) + '\n');
  await finishRun(runId, { counts: { selected: MODULES.length, written: MODULES.length - failed, valid: MODULES.length - failed, failed, skipped: 0 },
    checks: [{ name: 'signed in', status: failed === MODULES.length ? 'fail' : 'pass' }], outcome: failed === 0 ? 'succeeded' : failed === MODULES.length ? 'failed' : 'partial',
    reason: failed ? `${failed} module(s) refused` : null,
    usage: { input: null, output: null, cacheRead: null, cacheWrite: null, cost: null, source: 'measured', method: `script: ${client.requests} Dakota requests, no model tokens` } });
  console.log(`requests ${client.requests}`);
  for (const [m, c] of Object.entries(counts)) console.log(`${m}: ${c}`);
}
/**
 * `pull`: every record of each module we can read, every documented field, pages of 50 in a stable
 * order, one request a second, into data/real/dakota/raw/<module>/<stamp>.jsonl. Raw and complete, so
 * translating into the database can be redone without asking Dakota again. Stops at the first 429/5xx.
 */
async function pull() {
  const user = process.env.DAKOTA_USERNAME, pass = process.env.DAKOTA_PASSWORD;
  if (!user || !pass) throw new Error('No Dakota sign-in in the environment: run through scripts/with-dakota-key.sh');
  const root = await realRoot();
  const mods = (process.argv[3] ?? 'account,contact').split(',') as Array<'account' | 'contact'>;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = await beginRun({ parentRunId: null, workflow: 'dakota', operation: 'pull', protocol: { version: 'v1', hash: createHash('sha256').update('dakota-pull-v1: all documented fields, max_num 50, order sfid:ASC, 1 req/s').digest('hex') },
    source: 'script', agent: 'Claude', model: null, launchFolder: resolve('.'), workerFolder: resolve('.'),
    batch: { id: `dakota-pull-${stamp}`, manifest: 'modules:' + mods.join(','), hash: createHash('sha256').update(mods.join(',')).digest('hex'), planned: mods.length } });
  const client = new DakotaClient(user, pass);
  const out: Record<string, { expected: number; written: number; fields: string; error?: string }> = {};
  for (const m of mods) {
    const dir = join(root, 'dakota', 'raw', m); await mkdir(dir, { recursive: true });
    const file = join(dir, `${stamp}.jsonl`);
    const expected = await client.count(m);
    let fields: string[] | undefined = (FIELDS as unknown as Record<string, string[]>)[m];
    let offset = 0, written = 0, mode = 'documented';
    try {
      for (;;) {
        let page;
        try { page = await client.page({ module: m, fields, offset }); }
        catch (err) {
          // A field the docs list but our plan cannot read fails the whole request: fall back to Dakota's default set, once.
          if (offset === 0 && fields && /answered 400/.test(String(err))) { fields = undefined; mode = 'default'; continue; }
          throw err;
        }
        if (page.records.length) await appendFile(file, page.records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        written += page.records.length;
        if (page.nextOffset < 0 || page.records.length === 0) break;
        offset = page.nextOffset;
        if (written % 1000 < 50) console.log(`${m}: ${written}/${expected}`);
      }
      out[m] = { expected, written, fields: mode };
    } catch (err) { out[m] = { expected, written, fields: mode, error: err instanceof Error ? err.message : String(err) }; break; }
  }
  await writeFile(join(root, 'dakota', 'raw', `${stamp}.manifest.json`), JSON.stringify({ at: new Date().toISOString(), requests: client.requests, modules: out }, null, 2) + '\n');
  const failed = Object.values(out).filter((x) => x.error || x.written < x.expected).length;
  await finishRun(runId, { counts: { selected: mods.length, written: Object.values(out).reduce((a, x) => a + x.written, 0), valid: mods.length - failed, failed, skipped: mods.length - Object.keys(out).length },
    checks: [{ name: 'every record read', status: failed ? 'fail' : 'pass' }], outcome: failed ? 'partial' : 'succeeded', reason: failed ? JSON.stringify(out).slice(0, 300) : null,
    usage: { input: null, output: null, cacheRead: null, cacheWrite: null, cost: null, source: 'measured', method: `script: ${client.requests} Dakota requests, no model tokens` } });
  console.log(`requests ${client.requests}`); for (const [m, x] of Object.entries(out)) console.log(`${m}: ${x.written}/${x.expected} (${x.fields} fields)${x.error ? ' · ' + x.error : ''}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
