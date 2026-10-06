import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCloudStrategy } from '../../lib/workflows/cloud-w5';
import type { ToolResponse } from '../../lib/workflows/cloud-w1';
import { readRuns } from '../../lib/workflows/ledger';
import { WorkflowRefusal } from '../../lib/workflows/refusal';
import { freshDb, type Check } from './harness';

/**
 * W5 in the cloud (docs/28 §6.4) on invented LPs, records and strategies, with the model stubbed: no network,
 * no real key, no real record. The envelope, ledger, validator, layout rules and file writes are the real ones.
 */
export async function cloudW5Properties(check: Check) {
  const db = await freshDb();
  const juan = (await db.one<{ id: string }>("select id::text from platform.app_user where handle = 'juan'"))!.id;
  const [v1, v2] = await db.query<{ slug: string; name: string }>('select slug, name from platform.vehicle order by slug limit 2');
  const root = await mkdtemp(join(tmpdir(), 'cloud-w5-')), dir = join(root, 'enrich');
  const strategy = (key: string, vehicle: string, extra: Record<string, unknown> = {}) => ({
    key, name: 'Invented LP', made: { at: '1999-01-01', by: 'the model', workflow: 'W5', version: '0.1', inputs: { finding: 'made up', money: 'made up', bestPath: 'A' }, revised: [{ at: '1999-01-02', by: 'x', rule: 'y' }] },
    fit: { [vehicle]: { verdict: 'possible', why: 'Invented reason.' } },
    scores: { capacity: { band: 'unknown', basis: 'Nothing on file.' }, affinity: { level: 'medium', basis: 'Invented.' }, propensity: { level: 'low', basis: 'Invented.' }, timeToDecision: { band: 'unknown', basis: 'Invented.' } },
    angle: 'An invented angle.', route: null, next: { what: 'Ask the owner for a short call', who: 'juan', when: 'this month' },
    ask: { vehicle, shape: 'verify first' }, openQuestions: [], risks: [], list: '2027', confidence: 'low', ...extra });
  const sent: Array<Record<string, any>> = [];
  const usage = { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
  const reply = (body: unknown): ToolResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }], usage });
  const callModel = async (_key: string, body: Record<string, unknown>) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    const k = (JSON.parse((body.messages as Array<{ content: string }>)[0]!.content) as { key: string }).key;
    if (k === 'lp-a') return reply({ strategies: [{ folder: null, strategy: strategy('lp-a', v1!.name) }, { folder: v2!.slug, strategy: strategy('lp-a', v2!.slug) }] });
    if (k === 'lp-b') return reply({ strategies: [{ folder: null, strategy: strategy('lp-b', v1!.slug, { list: 'someday' }) }] });
    if (k === 'lp-c') return reply({ strategies: [{ folder: null, strategy: strategy('lp-c', v1!.slug, { ask: { vehicle: v1!.slug, shape: 'firm-level ask' },
      made: { at: '1999-01-01', by: 'the model', workflow: 'W5', version: '9.9', inputs: { finding: null, lead: { key: 'lp-a', at: '1999-01-01' } } } }) }] });
    return reply({ strategies: [{ folder: v1!.slug, strategy: strategy('lp-d', v1!.slug) }] });
  };
  try {
    for (const d of ['batches', 'raw', 'strategy']) await mkdir(join(dir, d), { recursive: true });
    const cand = (key: string, money: unknown) => ({ key, name: 'Invented LP', status: 'Committed', money, notes: [{ summary: 'an invented note' }],
      contact: { lastFromThem: null, meetings: 0, groupMeetings: 0 }, pursuits: [] });
    await writeFile(join(dir, 'candidates.jsonl'), [cand('lp-a', { amount: 1000000, track: 'close', state: 'signed', signedOn: null, signedPerSource: false, wired: 0 }),
      cand('lp-b', null), cand('lp-c', null), cand('lp-d', null), cand('lp-other', null)].map((r) => JSON.stringify(r)).join('\n'));
    await writeFile(join(dir, 'connections.jsonl'), [{ lp: 'lp-a', tier: 'C' }, { lp: 'lp-a', tier: 'B' }, { lp: 'lp-other', tier: 'A' }].map((r) => JSON.stringify(r)).join('\n'));
    await writeFile(join(dir, 'raw', 'lp-a.json'), JSON.stringify({ key: 'lp-a', researched: { at: '2026-09-30' }, facts: [] }));
    const oldA = { ...strategy('lp-a', v1!.name), made: { at: '2026-09-01', by: 'claude (sub-agent)', workflow: 'W5', version: '1.10' } };
    await writeFile(join(dir, 'strategy', 'lp-a.json'), JSON.stringify(oldA));
    await writeFile(join(dir, 'strategy', 'lp-d.json'), JSON.stringify(strategy('lp-d', v1!.slug)));
    await writeFile(join(dir, 'batches', 'w5-01a.txt'), 'lp-a\nlp-b\nlp-c\nlp-d\n');
    await writeFile(join(dir, 'batches', 'big.txt'), Array.from({ length: 9 }, (_, i) => `lp-${i}`).join('\n'));
    await writeFile(join(dir, 'batches', 'absent.txt'), 'lp-nobody\n');
    const deps = { callModel, enabled: true, key: 'invented-stub-only', now: () => Date.parse('2026-10-06T05:00:00Z') };

    let refused = 0;
    for (const [input, d] of [[{ batch: 'w5-01a.txt' }, { ...deps, enabled: false }], [{ batch: 'w5-01a.txt' }, { ...deps, key: null }],
      [{ batch: 'big.txt' }, deps], [{ batch: 'absent.txt' }, deps], [{ batch: '../raw/lp-a.json' }, deps]] as const) {
      try { await runCloudStrategy(input, juan, root, d); } catch (e) { if (e instanceof WorkflowRefusal) refused++; }
    }
    check('Cloud W5 refuses when off, keyless, over its LP limit, with no records for the batch, or outside batches; nothing sent', refused === 5 && sent.length === 0, `refused ${refused}, sent ${sent.length}`);

    const result = await runCloudStrategy({ batch: 'w5-01a.txt' }, juan, root, deps);
    const a = JSON.parse(await readFile(join(dir, 'strategy', 'lp-a.json'), 'utf8'));
    const a2 = JSON.parse(await readFile(join(dir, 'strategy', v2!.slug, 'lp-a.json'), 'utf8'));
    const c = JSON.parse(await readFile(join(dir, 'strategy', 'lp-c.json'), 'utf8'));
    const keptA = JSON.parse(await readFile(join(dir, 'inbox', result.runId, 'replaced', 'strategy', 'lp-a.json'), 'utf8'));
    const exists = (p: string) => readFile(join(dir, p), 'utf8').then(() => true, () => false);
    check('Cloud W5 writes made and its pins itself: today, the cloud, the protocol version, the finding, the close track, the best tier and the lead\'s date from its file',
      a.made.by === 'claude (cloud)' && a.made.at === '2026-10-06' && a.made.version === '1.10' && a.made.revised === undefined
      && a.made.inputs.finding === '2026-09-30' && a.made.inputs.money === 'close signed 1000000' && a.made.inputs.bestPath === 'B'
      && a2.ask.vehicle === v2!.slug && a2.made.inputs.bestPath === 'B'
      && c.made.inputs.finding === null && c.made.inputs.money === null && c.made.inputs.bestPath === null && c.made.inputs.lead?.key === 'lp-a' && c.made.inputs.lead.at === '2026-09-01',
      JSON.stringify({ a: a.made, c: c.made }));
    check('Cloud W5 holds the layout and the validator: a refused strategy and a second file for one vehicle go to rejects, a strategy on file is kept first',
      JSON.stringify(keptA) === JSON.stringify(oldA) && !(await exists('strategy/lp-b.json')) && !(await exists(`strategy/${v1!.slug}/lp-d.json`))
      && result.written === 3 && result.refused === 2 && result.failed === 2 && result.replaced === 1 && result.lists['2027'] === 3,
      JSON.stringify(result));
    const run = (await readRuns({ root })).runs.find((r) => r.runId === result.runId);
    const agent = await db.one<{ n: number }>(`select count(*)::int as n from agents.run where agent_kind = 'cloud-w5' and status = 'proposed'`);
    const first = sent[0]!;
    check('Cloud W5: no tools, the large model, the shared inputs cached, one call an LP, and the run recorded with measured usage',
      sent.length === 4 && first.tools === undefined && first.model === 'claude-opus-5-5' && first.system[1].cache_control?.type === 'ephemeral'
      && !JSON.parse(first.messages[0].content).paths.some((p: { lp: string }) => p.lp !== 'lp-a')
      && run?.outcome === 'partial' && run.finish?.usage?.input === 4 * 3000 && agent?.n === 1,
      JSON.stringify({ calls: sent.length, outcome: run?.outcome }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
