/** Invented performance corpus only. No caller-supplied path or deployed-root access. */
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeLine, type RunLine } from '../lib/workflows/ledger';
import { recordActivity } from '../lib/activity/log';

export const RAW_FILES = 1200;
export const LEDGER_RUNS = 300;
const at = (i: number) => `2026-09-${String(1 + i % 27).padStart(2, '0')}T10:00:00.000Z`;
const id = (i: number) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const rawName = (i: number) => `invented-${String(i).padStart(4, '0')}.json`;
const targetBytes = (i: number) => i < 1140 ? (32 + (i % 3) * 32) * 1024
  : i < 1194 ? 512 * 1024 : (4 + (i % 3) * 2) * 1024 * 1024;

function finding(i: number, revision = 0): string {
  const url = `https://research-${i % 19}.example.org/fictional/${i}`;
  const fact = { field: 'invented-role', value: 'INVENTED_PRIVATE_FIXTURE '.repeat(42), source: { url } };
  const value = {
    key: `invented-${i}`, name: `Invented Research Person ${i}`, revision,
    researched: { at: i % 211 === 0 ? 'invalid date' : at(i), workflow: 'W1' },
    queries: Array.from({ length: 3 + i % 8 + revision }, (_, n) => `INVENTED_PRIVATE_FIXTURE query ${i} ${n}`),
    facts: Array.from({ length: Math.max(1, Math.floor(targetBytes(i) / 1150)) }, (_, n) => ({ ...fact,
      source: { url: n % 11 === 0 ? `https://www.sec.gov/Archives/invented/${i}/${n % 5}` : `${url}/${n % 23}#part-${n % 4}` } })),
    identity: { links: [{ url: `${url}/0#different` }, { url: 'https://user:secret@example.org/private' }, { url: 'file:///invented' }] },
    connections: [{ source: `${url}/0` }, { source: `${url}/1#duplicate` }],
    profile: { signals: [{ source: 'https://news.example.net/invented' }, { source: '127.0.0.1' }] },
  };
  return JSON.stringify(value);
}

function run(i: number): string {
  const startedAt = at(i), script = i % 10 === 0;
  const start: RunLine = { event: 'started', runId: id(i), parentRunId: null,
    workflow: script ? (i % 20 === 0 ? 'DAKOTA' : 'WGRAPH') : ['W1', 'W1c', 'W5', 'W12'][i % 4],
    operation: script ? (i % 20 === 0 ? 'dakota-pull' : 'warehouse-graph') : 'research',
    protocol: { version: 'invented-v1', hash: 'a'.repeat(64) }, source: script ? 'script' : 'chatgpt',
    agent: 'invented-fixture-agent', model: script ? null : 'invented-model', launchFolder: '/invented', workerFolder: '/invented',
    batch: { id: `invented-${i}`, manifest: 'invented.txt', hash: 'b'.repeat(64), planned: 4 },
    startedAt, endedAt: null, counts: { selected: 4, written: null, valid: null, failed: null, skipped: null },
    checks: [], usage: null, outcome: 'unknown', reason: null };
  const finish: RunLine = { ...start, event: 'finished', endedAt: startedAt.replace('10:00', '10:01'),
    counts: { selected: 4, written: 4, valid: 4, failed: 0, skipped: 0 }, outcome: 'succeeded',
    checks: [{ name: 'invented-check', status: 'pass' }],
    usage: i % 7 === 0 ? null : { input: 3000 + i, output: 500 + i, cacheRead: 1500, cacheWrite: 100,
      cost: null, source: 'measured', ...(script ? { method: `script: ${10 + i} Dakota requests` } : {}) } };
  return encodeLine(start) + encodeLine(finish);
}

export async function createActivityPerfFixture() {
  if (process.env.DATA_PROFILE === 'real') throw new Error('Activity fixture refuses the real profile.');
  const root = await mkdtemp(join(tmpdir(), 'plcos-activity-perf-invented-'));
  let rawBytes = 0;
  try {
    for (const dir of ['enrich/raw', 'workflows', 'dakota/raw/account', 'dakota/raw/contact', 'enrich/warehouse/pages', 'intake/nested', 'activity'])
      await mkdir(join(root, dir), { recursive: true });
    // Small sequential batches limit transient memory even for the 8 MB findings.
    for (let i = 0; i < RAW_FILES; i++) {
      const text = finding(i); rawBytes += Buffer.byteLength(text);
      await writeFile(join(root, 'enrich/raw', rawName(i)), text);
      if (i % 8 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    await writeFile(join(root, 'workflows/runs.jsonl'), Array.from({ length: LEDGER_RUNS }, (_, i) => run(i)).join(''));
    await writeFile(join(root, 'workflows/usage-estimates.jsonl'), Array.from({ length: LEDGER_RUNS }, (_, i) =>
      JSON.stringify({ runId: id(i), input: 4000 + i, output: 900 + i })).join('\n') + '\n');
    for (let i = 0; i < 12; i++) {
      const stamp = `invented-${i}`;
      await writeFile(join(root, 'dakota/raw', `${stamp}.manifest.json`), JSON.stringify({ at: at(i),
        ...(i % 2 === 0 ? { runId: id(i * 20) } : {}), requests: 10 + i * 20,
        modules: { account: { written: 20 + i }, contact: { written: 30 + i } } }));
      for (const kind of ['account', 'contact']) await writeFile(join(root, 'dakota/raw', kind, `${stamp}.jsonl`),
        '{"invented":true,"payload":"fictional-record"}\n'.repeat(20 + i));
    }
    const pages = Array.from({ length: 32 }, (_, i) => ({ queryHash: i.toString(16).padStart(24, '0'), retrievedAt: at(i), rows: i + 5 }));
    for (const page of pages) await writeFile(join(root, 'enrich/warehouse/pages', `${page.queryHash}.json`), JSON.stringify(Array.from({ length: page.rows }, () => ({ invented: true }))));
    await writeFile(join(root, 'enrich/warehouse/graph-manifest.json'), JSON.stringify({ asOf: at(10), runId: id(10), inputPages: [...pages, pages[0], { queryHash: '../invalid', rows: 99 }] }));
    await writeFile(join(root, 'dakota/test-invented.json'), JSON.stringify({ at: at(15), requests: 3 }));
    for (let i = 0; i < 8; i++) {
      const file = join(root, 'intake/nested', `invented-${i}.csv`);
      await writeFile(file, 'name,kind\nInvented Person,invented\n'.repeat(i + 1));
      await utimes(file, new Date(at(i)), new Date(at(i)));
    }
    await recordActivity({ source: 'dakota', at: at(0), runId: id(0), requests: 2, records: 4, bytesIn: 128, bytesOut: 64 }, root);
    await recordActivity({ source: 'agents', at: at(1), runId: id(1), segment: 'W1', requests: null, records: 4, bytesIn: 200, bytesOut: 1000, estimated: true }, root);
    return {
      root, rawBytes, rawFiles: RAW_FILES, ledgerRuns: LEDGER_RUNS,
      changeLargeFile: () => writeFile(join(root, 'enrich/raw', rawName(1199)), finding(1199, 1)),
      appendRun: () => appendFile(join(root, 'workflows/runs.jsonl'), run(300)),
      removeFinding: () => rm(join(root, 'enrich/raw', rawName(1111))),
      addCutoff: () => recordActivity({ source: 'fetch', at: '2026-09-14T10:00:00.000Z', origin: 'https://actual.example.org/invented', requests: 7, records: 7, bytesIn: 70, bytesOut: 7 }, root),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Fixture generator takes no output path; only a new temporary invented root is allowed.');
  const fixture = await createActivityPerfFixture();
  console.log(JSON.stringify({ root: fixture.root, rawFiles: fixture.rawFiles, rawBytes: fixture.rawBytes, ledgerRuns: fixture.ledgerRuns }));
}
