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
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DakotaClient } from '../lib/connectors/dakota/client';
import { beginRun, finishRun, realRoot } from '../lib/workflows/ledger';

const MODULES = ['account', 'contact', 'investment', 'investment_strategy'];

async function main() {
  const op = process.argv[2];
  if (op !== 'test') throw new Error('usage: dakota-sync.ts test');
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
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
