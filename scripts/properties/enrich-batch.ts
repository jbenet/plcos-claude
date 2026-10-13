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

  // --tighten (W5 1.13): strategies before 1.13, furthest pursuit status first, back to Selected, either layout.
  const tight = await mkdtemp(join(tmpdir(), 'batch-tighten-'));
  const tdir = join(tight, 'data/demo/enrich');
  try {
    for (const folder of ['raw', 'strategy/spv-invented', 'batches']) await mkdir(join(tdir, folder), { recursive: true });
    const fund = 'Invented Fund', spv = 'Invented SPV';
    const rows: Array<[string, Array<[string, string]>]> = [['selected', [[fund, 'selected']]], ['connecting', [[fund, 'connecting']]],
      ['committed', [[fund, 'committed']]], ['done', [[fund, 'committed']]], ['sourcing', [[fund, 'sourcing']]], ['spvOnly', [[fund, 'selected'], [spv, 'discussing']]]];
    const cands = rows.map(([key, ps]) => ({ key, name: `Invented ${key}`, domains: [], org: null,
      pursuits: ps.map(([vehicle, status]) => ({ vehicle, status })), contact: { meetings: 0, groupMeetings: 0, lastFromThem: null, lastTouch: null } }));
    const jsonl = (xs: unknown[]) => xs.map(x => JSON.stringify(x)).join('\n');
    await writeFile(join(tdir, 'candidates.jsonl'), jsonl(cands));
    await writeFile(join(tdir, 'research-set.jsonl'), jsonl(cands));
    await writeFile(join(tdir, 'vehicles.json'), JSON.stringify([{ slug: 'fund-invented', name: fund }, { slug: 'spv-invented', name: spv }]));
    const strategy = (key: string, version: string, vehicle: string) => JSON.stringify({ key, made: { at: '2026-10-01', version }, ask: { vehicle } });
    for (const key of ['selected', 'connecting', 'committed', 'sourcing']) await writeFile(join(tdir, 'strategy', `${key}.json`), strategy(key, '1.12', fund));
    await writeFile(join(tdir, 'strategy', 'done.json'), strategy('done', '1.13', fund));
    await writeFile(join(tdir, 'strategy', 'spvOnly.json'), strategy('spvOnly', '1.13', fund));
    await writeFile(join(tdir, 'strategy/spv-invented/spvOnly.json'), strategy('spvOnly', '1.10', 'spv-invented'));
    await writeFile(join(tdir, 'batches/astra-other-01.txt'), 'connecting\n');
    await promisify(execFile)(process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-batch.ts'), 'w5', 'tt', '1', '--tighten'],
      { cwd: tight, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
    const files = (await readdir(join(tdir, 'batches'))).filter(f => f.startsWith('tt')).sort();
    const order = (await Promise.all(files.map(f => readFile(join(tdir, 'batches', f), 'utf8')))).map(t => t.trim());
    check('W5 --tighten takes pre-1.13 strategies furthest first, back to Selected, in either layout, skipping open Astra batches',
      JSON.stringify(order) === JSON.stringify(['committed', 'spvOnly', 'selected']),
      `Invented fixture ordered ${JSON.stringify(order)}; 1.13 files, Sourcing and an LP held by another Astra batch stay out.`);
  } finally { await rm(tight, { recursive: true, force: true }); }

  // A strategy under an identity alias, or only in a vehicle folder, is the LP's: not handed out as a new one (12 Oct 2026).
  const al = await mkdtemp(join(tmpdir(), 'batch-alias-'));
  const adir = join(al, 'data/demo/enrich');
  try {
    for (const folder of ['raw', 'strategy/spv-invented', 'batches']) await mkdir(join(adir, folder), { recursive: true });
    const cands = ['fresh', 'aliased', 'foldered'].map(key => ({ key, name: `Invented ${key}`, domains: [], org: null,
      pursuits: [{ vehicle: 'Invented Fund', status: 'discussing' }], contact: { meetings: 0, groupMeetings: 0, lastFromThem: null, lastTouch: null } }));
    const jsonl = (xs: unknown[]) => xs.map(x => JSON.stringify(x)).join('\n');
    await writeFile(join(adir, 'candidates.jsonl'), jsonl(cands));
    await writeFile(join(adir, 'research-set.jsonl'), jsonl(cands));
    await writeFile(join(adir, 'entity-keys.json'), JSON.stringify({ 'old-aliased': 'aliased' }));
    const strategy = (key: string, vehicle: string) => JSON.stringify({ key, made: { at: new Date().toISOString(), version: '1.13' }, ask: { vehicle } });
    await writeFile(join(adir, 'strategy', 'old-aliased.json'), strategy('old-aliased', 'Invented Fund'));
    await writeFile(join(adir, 'strategy/spv-invented/foldered.json'), strategy('foldered', 'spv-invented'));
    await promisify(execFile)(process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-batch.ts'), 'w5', 'aa', '5'],
      { cwd: al, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
    const files = (await readdir(join(adir, 'batches'))).filter(f => f.startsWith('aa'));
    const picked = (await Promise.all(files.map(f => readFile(join(adir, 'batches', f), 'utf8')))).join('').trim().split('\n').filter(Boolean).sort();
    check('W5 hands out no LP whose strategy sits under an alias or only in a vehicle folder',
      JSON.stringify(picked) === JSON.stringify(['fresh']), `Invented fixture picked ${JSON.stringify(picked)}.`);
  } finally { await rm(al, { recursive: true, force: true }); }

  // --tighten resolves aliases and loose vehicle names; --vehicle focuses a cut on named vehicles, every stage (12 Oct 2026).
  const fv = await mkdtemp(join(tmpdir(), 'batch-focus-'));
  const fdir = join(fv, 'data/demo/enrich');
  try {
    for (const folder of ['raw', 'strategy', 'batches']) await mkdir(join(fdir, folder), { recursive: true });
    const fund = 'Invented Fund', spv = 'Invented SPV';
    const rows: Array<[string, string, string]> = [['aliased', fund, 'selected'], ['loose', fund, 'connecting'], ['spvLate', spv, 'sourcing'], ['other', fund, 'sourcing']];
    const cands = rows.map(([key, vehicle, status]) => ({ key, name: `Invented ${key}`, domains: [], org: null,
      pursuits: [{ vehicle, status }], contact: { meetings: 0, groupMeetings: 0, lastFromThem: null, lastTouch: null } }));
    const jsonl = (xs: unknown[]) => xs.map(x => JSON.stringify(x)).join('\n');
    await writeFile(join(fdir, 'candidates.jsonl'), jsonl(cands));
    await writeFile(join(fdir, 'research-set.jsonl'), jsonl(cands));
    await writeFile(join(fdir, 'vehicles.json'), JSON.stringify([{ slug: 'fund-invented', name: fund }, { slug: 'spv-invented', name: spv }]));
    await writeFile(join(fdir, 'entity-keys.json'), JSON.stringify({ 'old-aliased': 'aliased' }));
    const strategy = (key: string, vehicle: string) => JSON.stringify({ key, made: { at: '2026-10-01', version: '1.12' }, ask: { vehicle } });
    await writeFile(join(fdir, 'strategy', 'old-aliased.json'), strategy('old-aliased', fund));
    await writeFile(join(fdir, 'strategy', 'loose.json'), strategy('loose', 'the invented fund'));
    await writeFile(join(fdir, 'strategy', 'spvLate.json'), strategy('spvLate', 'spv-invented'));
    await writeFile(join(fdir, 'strategy', 'other.json'), strategy('other', fund));
    const cut = async (prefix: string, extra: string[]) => {
      await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-batch.ts'), 'w5', prefix, '9', '--tighten', ...extra],
        { cwd: fv, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
      const files = (await readdir(join(fdir, 'batches'))).filter(f => f.startsWith(prefix));
      return (await Promise.all(files.map(f => readFile(join(fdir, 'batches', f), 'utf8')))).join('').trim().split('\n').filter(Boolean).sort();
    };
    const plain = await cut('pl', []);
    check('W5 --tighten takes a strategy filed under an alias, and one whose vehicle is named loosely',
      JSON.stringify(plain) === JSON.stringify(['aliased', 'loose']), `Invented fixture picked ${JSON.stringify(plain)}.`);
    await rm(join(fdir, 'batches'), { recursive: true, force: true }); await mkdir(join(fdir, 'batches'));
    const focused = await cut('fo', ['--vehicle', 'spv-invented']);
    check('W5 --tighten --vehicle takes only that vehicle, at every stage', JSON.stringify(focused) === JSON.stringify(['spvLate']),
      `Invented fixture picked ${JSON.stringify(focused)}.`);
  } finally { await rm(fv, { recursive: true, force: true }); }

  // w1 --search (the Astra "Search pass", 13 Oct 2026): pages-only findings, and two cuts minutes apart never share LPs.
  const sv = await mkdtemp(join(tmpdir(), 'batch-search-'));
  const sdir = join(sv, 'data/demo/enrich');
  try {
    for (const folder of ['raw', 'strategy', 'batches']) await mkdir(join(sdir, folder), { recursive: true });
    const cands = ['pagesA', 'pagesB', 'searched'].map((key) => ({ key, name: `Invented ${key}`, domains: [], org: `Invented Org ${key}`,
      pursuits: [{ vehicle: 'Invented Fund', status: 'selected' }], contact: { meetings: 0, groupMeetings: 0, lastFromThem: null, lastTouch: null } }));
    const jsonl = (xs: unknown[]) => xs.map(x => JSON.stringify(x)).join('\n');
    await writeFile(join(sdir, 'candidates.jsonl'), jsonl(cands));
    await writeFile(join(sdir, 'research-set.jsonl'), jsonl(cands));
    for (const c of cands) await writeFile(join(sdir, 'raw', `${c.key}.json`), JSON.stringify({ key: c.key,
      researched: { at: '2026-09-28', method: c.key === 'searched' ? 'search' : 'pages' }, identity: { match: 'confirmed' } }));
    const cut = async (prefix: string) => {
      await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-batch.ts'), 'w1', prefix, '1', '--search', '--max', '1'],
        { cwd: sv, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
      const files = (await readdir(join(sdir, 'batches'))).filter(f => f.startsWith(prefix));
      return (await Promise.all(files.map(f => readFile(join(sdir, 'batches', f), 'utf8')))).join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).key);
    };
    const first = await cut('astra-aaaaaaaa-'), second = await cut('astra-bbbbbbbb-'), third = await cut('astra-cccccccc-');
    check('w1 --search takes pages-only findings, and an open Astra batch holds its LPs from the next cut',
      first.length === 1 && second.length === 1 && first[0] !== second[0] && [...first, ...second].every((k) => k.startsWith('pages')) && !third.length,
      `Invented fixture cut ${JSON.stringify([first, second, third])}.`);
  } finally { await rm(sv, { recursive: true, force: true }); }
}
