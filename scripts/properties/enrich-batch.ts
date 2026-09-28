/** Batch selection exercises the actual CLI on invented files, without opening a database. */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Check } from './harness';

export async function enrichBatchProperties(check: Check) {
  const scratch = await mkdtemp(join(tmpdir(), 'batch-keys-'));
  const dir = join(scratch, 'data/demo/enrich');
  try {
    for (const folder of ['raw', 'strategy', 'batches']) await mkdir(join(dir, folder), { recursive: true });
    const names = ['revised', 'resolved', 'probable', 'alias', 'engaged', 'committed', 'warm', 'missing', 'unresolved', 'colleague', 'unlisted', 'reserved'];
    const candidates = names.map(key => ({ key, name: `Invented ${key}`, domains: [],
      org: ['alias', 'colleague'].includes(key) ? 'Invented Shared Firm' : null,
      pursuits: [{ status: key === 'engaged' ? 'discussing' : key === 'committed' ? 'committed' : 'selected' }],
      contact: { meetings: 0, groupMeetings: 0, lastFromThem: null, lastTouch: null } }));
    const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n');
    await writeFile(join(dir, 'candidates.jsonl'), jsonl(candidates));
    await writeFile(join(dir, 'research-set.jsonl'), jsonl(candidates));
    await writeFile(join(dir, 'triage.jsonl'), jsonl([{ key: 'warm', lane: 'warm now' }]));
    await writeFile(join(dir, 'entity-keys.json'), JSON.stringify({ 'invented-alias': 'alias' }));
    for (const key of ['resolved', 'probable', 'invented-alias', 'unresolved', 'unlisted', 'reserved']) {
      // Filename deliberately differs: the key inside the finding is authoritative.
      await writeFile(join(dir, 'raw', `file-${key}.json`), JSON.stringify({ key,
        researched: { at: '2026-09-28' }, identity: { match: key === 'unresolved' ? 'ambiguous' : key === 'probable' ? 'probable' : 'confirmed' } }));
    }
    for (const key of ['revised', 'colleague']) await writeFile(join(dir, 'strategy', `${key}.json`), JSON.stringify({ key, made: { at: '2026-09-28' } }));
    await writeFile(join(dir, 'batches/s01.txt'), 'reserved\n');
    const keys = [...names.filter(k => !['colleague', 'unlisted'].includes(k)), 'unknown'];
    await writeFile(join(scratch, 'keys.txt'), keys.join('\n'));
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-batch.ts'), 'w5', 'test', '2', '--keys', join(scratch, 'keys.txt')],
      { cwd: scratch, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
    const files = (await readdir(join(dir, 'batches'))).filter(f => f.startsWith('test'));
    const batches = await Promise.all(files.map(f => readFile(join(dir, 'batches', f), 'utf8')));
    const selected = batches.join('').trim().split('\n').sort();
    const expected = ['revised', 'resolved', 'probable', 'alias', 'engaged', 'committed', 'warm', 'colleague'].sort();
    check('W5 --keys retains new eligible LPs, resolves finding aliases and keeps strategy colleagues together',
      JSON.stringify(selected) === JSON.stringify(expected) && batches.some(b => b.includes('alias\n') && b.includes('colleague\n')),
      `Invented CLI fixture selected ${selected.length} LPs; confirmed/probable research, engaged and warm qualify without a strategy.`);
    check('W5 --keys reports every omitted key by reason and respects open batches',
      stdout.includes('4 of 11 listed keys not selected (no finding: 1, unresolved: 1, not a candidate: 1, open batch: 1, already batched: 0)'),
      'Unlisted LPs stay out; missing, unresolved, unknown and reserved targets are counted explicitly.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
