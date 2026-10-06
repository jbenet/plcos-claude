import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProspectFile } from '../../lib/enrich/prospect-rows';
import { addProspects } from '../../lib/enrich/prospects';
import { runCloudSourcing } from '../../lib/workflows/cloud-sourcing';
import type { ToolResponse } from '../../lib/workflows/cloud-w1';
import { readRuns } from '../../lib/workflows/ledger';
import { WorkflowRefusal } from '../../lib/workflows/refusal';
import { freshDb, type Check } from './harness';

/**
 * Prospect sourcing in the cloud (docs/28 §6.2) on invented people and pages, with the model stubbed: no
 * network, no real key, no real record. The envelope, ledger, row check and file write are the real ones.
 */
export async function cloudSourcingProperties(check: Check) {
  const db = await freshDb();
  const juan = (await db.one<{ id: string }>("select id::text from platform.app_user where handle = 'juan'"))!.id;
  const vehicles = await db.query<{ slug: string; name: string; kind: string }>('select slug, name, kind::text as kind from platform.vehicle order by slug');
  const fund = vehicles.find((v) => v.kind !== 'grant_rail')!, grant = vehicles.find((v) => v.kind === 'grant_rail');
  const lpNames = (await db.query<{ name: string }>(`select distinct e.display_name as name from identity.entity e join strategy.pursuit p on p.entity_id = e.entity_id limit 50`)).map((r) => r.name);
  const root = await mkdtemp(join(tmpdir(), 'cloud-sourcing-')), dir = join(root, 'enrich');
  const A = 'https://foundation.example.org/board', B = 'https://news.example.net/angels';
  const pages = { fetch: (async (url: string | URL) => String(url) === A
    ? new Response('<p>Robin Example chairs the Invented Family Foundation, which backs neuroscience research.</p>', { headers: { 'content-type': 'text/html' } })
    : new Response('', { status: 404 })) as typeof fetch, lookup: async () => [{ address: '93.184.215.14' }], sleep: async () => undefined, now: () => 0 };
  const sent: Array<Record<string, any>> = [];
  const usage = { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const reply = (stop_reason: string, content: unknown[]): ToolResponse => ({ stop_reason, content: content as ToolResponse['content'], usage });
  let script: 'good' | 'leak' = 'good';
  const callModel = async (_key: string, body: Record<string, unknown>) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    const turn = (body.messages as unknown[]).length;
    if (script === 'leak') return reply('tool_use', [{ type: 'server_tool_use', id: 's9', name: 'web_search', input: { query: `neuroscience angels ${fund.name}` } }]);
    if (turn === 1) return reply('tool_use', [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'family foundation neuroscience research board' } },
      { type: 'tool_use', id: 't1', name: 'fetch_page', input: { url: A } },
      { type: 'tool_use', id: 't2', name: 'fetch_page', input: { url: B } },
    ]);
    const row = (name: string, sources: string[], extra: Record<string, unknown> = {}) => ({ name, org: 'Invented Family Foundation', country: 'United States',
      reason: 'Chairs a foundation that backs neuroscience research.', strategic: true, capacity: { band: '$500K–1M', basis: 'Chairs a family foundation.' }, sources,
      personalUrls: ['https://www.linkedin.com/in/invented', 'https://robin.example.org'], ...extra });
    return reply('end_turn', [{ type: 'text', text: JSON.stringify({ prospects: [
      row('Robin Example', [A, B, 'https://www.linkedin.com/in/invented'], { route: { best: 'made up', score: 99 }, status: 'sourcing', emailDomain: 'example.org', capacity: { band: '$1M+', basis: 'x', guess: false } }),
      row('Sam Snippet', [B]),
      row('Robin Example', [A]),
      row('Kim Nowhere', [A], { country: '' }),
    ] }) }]);
  };
  try {
    await mkdir(dir, { recursive: true });
    const deps = { pages, callModel, enabled: true, key: 'invented-stub-only', now: () => Date.parse('2026-10-06T06:00:00Z') };
    const brief = 'Family offices and foundations funding neuroscience research in the US.';
    let refused = 0;
    for (const [input, d] of [[{ vehicle: fund.slug, brief }, { ...deps, enabled: false }], [{ vehicle: fund.slug, brief }, { ...deps, key: null }],
      [{ vehicle: 'no-such-vehicle', brief }, deps], [{ vehicle: fund.slug, brief: 'too short' }, deps],
      ...(grant ? [[{ vehicle: grant.slug, brief }, deps]] : [])] as Array<[Record<string, unknown>, typeof deps]>) {
      try { await runCloudSourcing(input, juan, root, d); } catch (e) { if (e instanceof WorkflowRefusal) refused++; }
    }
    check('Cloud sourcing refuses when off, keyless, for an unknown vehicle or a grant rail, or without a brief; nothing sent',
      refused === (grant ? 5 : 4) && sent.length === 0, `refused ${refused}, sent ${sent.length}`);

    const result = await runCloudSourcing({ vehicle: fund.slug, brief, count: 10 }, juan, root, deps);
    const text = await readFile(join(dir, result.file!), 'utf8');
    const { records, invalid } = parseProspectFile({ file: result.file!, text });
    const r = records[0]?.p as Record<string, any> | undefined;
    const prompt = JSON.stringify(sent[0]);
    check('Cloud sourcing gives the model the vehicle and the brief only, never a record of ours',
      prompt.includes(brief) && prompt.includes(fund.name) && !lpNames.some((n) => n && n.length > 5 && prompt.includes(n)) && sent[0]!.tools[0].blocked_domains.includes('linkedin.com'),
      `${lpNames.length} names checked`);
    check('Cloud sourcing holds rows to the import: the server sets vehicle, status, key, guess and route; sources only pages read; no LinkedIn or email domain; one row a person; a country',
      result.written === 1 && result.refused === 3 && invalid.length === 0 && records.length === 1 && r!.vehicle === fund.slug && r!.status === 'new'
      && r!.personKey === 'cloud-sourced:robin-example--invented-family-foundation' && r!.capacity.guess === true && r!.route === null
      && JSON.stringify(r!.sources) === JSON.stringify([A]) && JSON.stringify(r!.personalUrls) === JSON.stringify(['https://robin.example.org']) && r!.emailDomain === undefined
      && /^prospects\/2026-10-06-cloud-[0-9a-f]{8}-/.test(result.file!),
      JSON.stringify({ result, row: r }));

    const imported = await addProspects(db, juan, [{ file: result.file!, text }]);
    check('A cloud-sourced file passes the real prospects import as it stands', imported.added === 1, JSON.stringify(imported).slice(0, 300));

    script = 'leak';
    const leak = await runCloudSourcing({ vehicle: fund.slug, brief }, juan, root, deps);
    const runs = (await readRuns({ root })).runs;
    const tool = await db.query<{ n: number }>(`select count(*)::int as n from agents.tool_call t join agents.run r on r.run_id = t.run_id where r.agent_kind = 'cloud-sourcing' and t.tool = 'web-search' and not t.allowed`);
    check('Cloud sourcing: a search naming our vehicle keeps nothing, and both runs are recorded',
      leak.written === 0 && leak.queryRefusals === 1 && leak.outcome === 'failed' && (await readdir(join(dir, 'prospects'))).length === 1
      && runs.filter((x) => x.start?.workflow === 'sourcing').length === 2 && runs.find((x) => x.runId === result.runId)?.outcome === 'partial' && tool[0]!.n === 1,
      JSON.stringify(leak));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
