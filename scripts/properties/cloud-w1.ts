import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimalRow, queryRefusal, runCloudProfile, type ToolResponse } from '../../lib/workflows/cloud-w1';
import { readRuns } from '../../lib/workflows/ledger';
import { WorkflowRefusal } from '../../lib/workflows/refusal';
import { freshDb, type Check } from './harness';

/**
 * W1 in the cloud (docs/28 §6.3) on invented LPs, invented pages and a stubbed model conversation: no network,
 * no real key, no real record. The envelope, ledger, validator, page rules and file writes are the real ones.
 */
export async function cloudW1Properties(check: Check) {
  const db = await freshDb();
  const juan = (await db.one<{ id: string }>("select id::text from platform.app_user where handle = 'juan'"))!.id;
  const vehicle = (await db.one<{ name: string }>('select name from platform.vehicle order by name limit 1'))!.name;
  const root = await mkdtemp(join(tmpdir(), 'cloud-w1-')), dir = join(root, 'enrich');
  const A = 'https://firm.example.org/team', B = 'https://news.example.net/story', L = 'https://www.linkedin.com/in/invented';
  const pageFetch = (async (url: string | URL) => {
    const u = String(url);
    if (u === A) return new Response('<p>Pat Example is a Partner at Invented Capital Partners and backs seed-stage neurotechnology companies.</p>', { headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const pages = { fetch: pageFetch, lookup: async () => [{ address: '93.184.215.14' }], sleep: async () => undefined, now: () => 0 };
  const fact = (url: string, value: string, quote: string) => ({ field: 'role', value, quote, source: { url, kind: 'primary' }, confidence: 'medium', detail: { company: 'Invented Capital Partners' } });
  const finding = (key: string, match: string, facts: unknown[]) => ({ key, name: 'whatever the model says', identity: { match, basis: 'Invented basis' }, facts,
    profile: { summary: 'Invented summary.', investorType: 'angel' }, researched: { at: '1999-01-01', by: 'the model', workflow: 'W1', version: '0.1' }, queries: [{ q: 'made up' }] });
  const sent: Array<Record<string, any>> = [];
  const turns = new Map<string, number>();
  const usage = { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
  const reply = (stop_reason: string, content: unknown[]): ToolResponse => ({ stop_reason, content: content as ToolResponse['content'], usage });
  const callModel = async (_key: string, body: Record<string, unknown>) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const lp = (JSON.parse(messages[0]!.content as string) as { lp: { key: string } }).lp.key;
    const t = (turns.get(lp) ?? 0) + 1; turns.set(lp, t);
    if (lp === 'lp-one' && t === 1) return reply('tool_use', [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Pat Example Invented Capital Partners' } },
      { type: 'tool_use', id: 't1', name: 'fetch_page', input: { url: A } },
      { type: 'tool_use', id: 't2', name: 'fetch_page', input: { url: L } },
    ]);
    if (lp === 'lp-one') return reply('end_turn', [{ type: 'text', text: JSON.stringify({ finding: finding('lp-one', 'confirmed', [
      fact(A, 'Partner at Invented Capital Partners', 'Pat Example is a Partner at Invented Capital Partners'),
      fact(A, 'Leads every round', 'leads every round it joins'),
      fact(B, 'Board of Example Robotics', 'joined the board'),
    ]) }) }]);
    if (lp === 'lp-two') return reply('tool_use', [{ type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: `Jane Invented ${vehicle}` } }]);
    return reply('end_turn', [{ type: 'text', text: JSON.stringify({ finding: finding('lp-three', 'not_found', []) }) }]);
  };
  try {
    await mkdir(join(dir, 'batches'), { recursive: true });
    await mkdir(join(dir, 'raw'), { recursive: true });
    const secretRow = { key: 'lp-one', name: 'Pat Example', org: 'Invented Capital Partners', role: 'Partner', location: 'Fargo', type: 'person',
      status: 'Committed', amount: 2500000, note: 'met at a dinner, wants a side letter', lists: ['Top 20 for the first close'], enriched: { title: 'Partner', email: 'pat@example.invalid', links: [] } };
    await writeFile(join(dir, 'batches', 'w1-01a.jsonl'), [secretRow, { key: 'lp-two', name: 'Jane Invented' }, { key: 'lp-three', name: 'Lee Invented' }].map((r) => JSON.stringify(r)).join('\n'));
    const before = { ...finding('lp-three', 'not_found', []), name: 'Lee Invented', researched: { at: '2026-09-01', by: 'claude (sub-agent)', workflow: 'W1', version: '1.49', method: 'pages' } };
    await writeFile(join(dir, 'raw', 'lp-three.json'), JSON.stringify(before));
    const deps = { pages, callModel, enabled: true, key: 'invented-stub-only', now: () => Date.parse('2026-10-06T04:00:00Z') };

    let refused = 0;
    for (const [input, d] of [[{ batch: 'w1-01a.jsonl' }, { ...deps, enabled: false }], [{ batch: 'w1-01a.jsonl' }, { ...deps, key: null }], [{ batch: '../raw/lp-three.json' }, deps]] as const) {
      try { await runCloudProfile(input, juan, root, d); } catch (e) { if (e instanceof WorkflowRefusal) refused++; }
    }
    const result = await runCloudProfile({ batch: 'w1-01a.jsonl' }, juan, root, deps);
    const one = JSON.parse(await readFile(join(dir, 'raw', 'lp-one.json'), 'utf8'));
    const three = JSON.parse(await readFile(join(dir, 'raw', 'lp-three.json'), 'utf8'));
    const keptThree = JSON.parse(await readFile(join(dir, 'inbox', result.runId, 'replaced', 'raw', 'lp-three.json'), 'utf8'));
    const lpTwoWritten = await readFile(join(dir, 'raw', 'lp-two.json'), 'utf8').then(() => true, () => false);
    const firstUser = sent[0]!.messages[0].content as string;
    const toolResults = (sent[1]!.messages as Array<{ role: string; content: any }>)[2]!.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
    check('Cloud W1 refuses when off, keyless or outside batches, and gives the model only what a search may carry',
      refused === 3 && !/Committed|2500000|side letter|Top 20|pat@example/.test(firstUser) && /Invented Capital Partners/.test(firstUser)
      && JSON.stringify(minimalRow(secretRow)) === JSON.stringify({ key: 'lp-one', name: 'Pat Example', type: 'person', org: 'Invented Capital Partners', role: 'Partner', location: 'Fargo', enriched: { title: 'Partner', links: [] } }),
      `refused ${refused}`);
    check('Cloud W1 tools: web search with brokers and LinkedIn blocked, a server fetch that never reads LinkedIn, a cached system prompt',
      sent[0]!.tools[0].name === 'web_search' && sent[0]!.tools[0].blocked_domains.includes('linkedin.com') && sent[0]!.tools[1].name === 'fetch_page'
      && sent[0]!.system[0].cache_control?.type === 'ephemeral' && sent[0]!.model === 'claude-sonnet-5-5'
      && toolResults.find((r) => r.tool_use_id === 't1')?.content.includes('Partner at Invented Capital Partners') === true
      && toolResults.find((r) => r.tool_use_id === 't2')?.is_error === true && /LinkedIn/.test(toolResults.find((r) => r.tool_use_id === 't2')!.content),
      `${sent.length} calls`);
    check('Cloud W1 holds the finding to W1: facts only on pages read in this run with their quotes on the page, researched and queries written by the server',
      one.facts.length === 1 && one.facts[0].source.url === A && one.profile.cautions.length === 2 && one.profile.cautions.every((c: string) => c.startsWith('Unconfirmed'))
      && one.name === 'Pat Example' && one.researched.at === '2026-10-06' && one.researched.by === 'claude (cloud)' && one.researched.method === 'search'
      && one.researched.version === '1.50' && one.queries.length === 1 && one.queries[0].q === 'Pat Example Invented Capital Partners',
      JSON.stringify({ facts: one.facts.length, cautions: one.profile?.cautions?.length, researched: one.researched }));
    const ledger = await readRuns({ root });
    const run = ledger.runs.find((r) => r.runId === result.runId);
    const calls = await db.query<{ tool: string; allowed: boolean }>(`select t.tool, t.allowed from agents.tool_call t join agents.run r on r.run_id = t.run_id where r.agent_kind = 'cloud-w1'`);
    check('Cloud W1: a query naming our vehicle fails that LP, a finding on file is kept before it is replaced, and the run is recorded',
      !lpTwoWritten && result.queryRefusals === 1 && result.written === 2 && result.failed === 1 && result.replaced === 1 && result.demotedFacts === 2
      && JSON.stringify(keptThree) === JSON.stringify(before) && three.researched.version === '1.50' && three.name === 'Lee Invented'
      && run?.outcome === 'partial' && run.start?.model === 'claude-sonnet-5-5' && run.finish?.usage?.input === sent.length * 1500
      && run.finish.checks.some((c) => c.name.startsWith('queries') && c.status === 'fail')
      && calls.some((c) => c.tool === 'web-search' && !c.allowed) && calls.some((c) => c.tool === 'fetch-page firm.example.org' && c.allowed)
      && (await readdir(join(dir, 'raw'))).length === 2,
      JSON.stringify(result));
    check('Query rules: amounts, the pipeline and our vehicles refused; a name with organization and topic allowed',
      queryRefusal('Pat Example $5M fund', []) !== null && queryRefusal('Pat Example 10 million', []) !== null && queryRefusal('Pat Example pipeline', []) !== null
      && queryRefusal(`Pat Example ${vehicle}`, [vehicle]) !== null && queryRefusal('Pat Example Invented Capital Partners neurotechnology', [vehicle]) === null,
      'unit checks');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
