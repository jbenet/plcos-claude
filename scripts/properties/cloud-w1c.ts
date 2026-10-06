import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factReviewProblems } from '../../lib/enrich/fact-review';
import { normalise, pageText, publicAddress, quoteOnPage } from '../../lib/workflows/cited-pages';
import { runCloudFactCheck, type ModelRequest } from '../../lib/workflows/cloud-w1c';
import { readRuns } from '../../lib/workflows/ledger';
import { WorkflowRefusal } from '../../lib/workflows/refusal';
import { freshDb, type Check } from './harness';

/**
 * The cloud fact check (docs/28-cloud-workflows.md, slice 1) on invented findings, invented pages and a stubbed
 * model: no network, no real key, no real record. The pages and the model are the only stubs; the envelope,
 * the ledger, the validator and the review file are the real ones.
 */
export async function cloudW1cProperties(check: Check) {
  const db = await freshDb();
  const juan = (await db.one<{ id: string }>("select id::text from platform.app_user where handle = 'juan'"))!.id;
  const root = await mkdtemp(join(tmpdir(), 'cloud-w1c-')), dir = join(root, 'enrich');
  const A = 'https://firm.example.org/team', B = 'https://news.example.net/story', L = 'https://www.linkedin.com/in/invented',
    M = 'http://169.254.169.254/latest/meta-data', S1 = 'https://www.sec.gov/cgi-bin/one', S2 = 'https://www.sec.gov/cgi-bin/two';
  const fact = (url: string, value: string, quote?: string) => ({ field: 'role', value, source: { url, kind: 'primary' }, confidence: 'medium', ...(quote ? { quote } : {}), detail: { company: 'Invented Capital Partners' } });
  const finding = (key: string, facts: unknown[]) => ({ key, name: 'Invented Person', researched: { at: '2026-10-01', by: 'fixture', workflow: 'W1', version: '1.50' },
    identity: { match: 'confirmed', basis: 'Invented fixture' }, facts });
  const one = finding('invented-one', [
    fact(A, 'Partner at Invented Capital Partners', 'Pat Example is a Partner at Invented Capital Partners'),
    fact(A, 'Leads seed rounds', 'leads every seed round we make'), // not on page A: supported must become partly
    fact(L, 'Former analyst', 'analyst'),                            // LinkedIn: never fetched, unavailable
    fact(B, 'Joined the board of Example Robotics'),
  ]);
  const two = finding('invented-two', [fact(M, 'Metadata fact'), fact(S1, 'Filed a Form D'), fact(S2, 'Filed another Form D')]);
  const three = finding('invented-three', [fact(A, 'Partner', 'Partner at Invented Capital Partners')]);

  const requested: Array<{ url: string; ua: string; headers: string[] }> = [], waits: number[] = [];
  const lookedUp: string[] = [];
  let bTries = 0;
  const pageFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url), h = new Headers(init?.headers);
    requested.push({ url: u, ua: h.get('user-agent') ?? '', headers: [...h.keys()] });
    if (u === A) return new Response('<html><head><script>var x="hidden";</script></head><body><p>Pat Example is a <b>Partner</b> at Invented&nbsp;Capital Partners.</p><img src="/logos/example-robotics.png" alt="Example Robotics"></body></html>', { headers: { 'content-type': 'text/html' } });
    if (u === B) return ++bTries === 1 ? new Response('', { status: 429 }) : new Response('<p>Pat joined the board of Example Robotics.</p>', { headers: { 'content-type': 'text/html' } });
    if (u.startsWith('https://www.sec.gov/')) return new Response('FORM D notice', { headers: { 'content-type': 'text/plain' } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const pages = { fetch: pageFetch, lookup: async (h: string) => { lookedUp.push(h); return [{ address: h.endsWith('.sec.gov') || h.endsWith('example.org') || h.endsWith('example.net') ? '93.184.215.14' : '10.0.0.8' }]; },
    sleep: async (ms: number) => { waits.push(ms); }, now: () => 0 };
  const calls: ModelRequest[] = [];
  const answer = (key: string, n: number, note = 'Said on the page.') => JSON.stringify({ key, identity: 'holds', identityNote: 'Same firm and role on its own page.',
    facts: Array.from({ length: n }, (_, i) => ({ i, grade: 'supported', note })), counts: { supported: 99 } });
  const callModel = async (_key: string, req: ModelRequest) => {
    calls.push(req);
    const key = (JSON.parse(req.user) as { key: string }).key;
    const text = key === 'invented-three' ? 'not json' : answer(key, (JSON.parse(req.user) as { facts: unknown[] }).facts.length);
    return { text, stop: 'end_turn', usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 } };
  };
  try {
    await mkdir(join(dir, 'batches'), { recursive: true });
    await mkdir(join(dir, 'raw'), { recursive: true });
    for (const f of [one, two, three]) await writeFile(join(dir, 'raw', `${f.key}.json`), JSON.stringify(f));
    await writeFile(join(dir, 'batches', 'w1c-07a.jsonl'), ['invented-one', 'invented-two', 'invented-three'].map((key) => JSON.stringify({ key })).join('\n'));
    const deps = { pages, callModel, enabled: true, key: 'invented-stub-only' };

    // Refusals first: each refuses before the ledger, the envelope or a page.
    const refusals: string[] = [];
    const refuses = async (input: Record<string, unknown>, d: Record<string, unknown> = deps) => {
      try { await runCloudFactCheck(input, juan, root, d as never); refusals.push('ran'); } catch (e) { refusals.push(e instanceof WorkflowRefusal ? 'refused' : `threw ${(e as Error).message}`); }
    };
    const envelopesBefore = Number((await db.one<{ n: string }>('select count(*)::text n from agents.envelope'))!.n);
    await refuses({ batch: 'w1c-07a.jsonl', review: 'fact-review-07a.jsonl' }, { ...deps, enabled: false });
    await refuses({ batch: 'w1c-07a.jsonl', review: 'fact-review-07a.jsonl' }, { ...deps, key: null });
    await refuses({ batch: 'w1c-07a.jsonl', review: 'review.jsonl' });
    await refuses({ batch: '../raw/invented-one.json', review: 'fact-review-07a.jsonl' });
    await writeFile(join(dir, 'batches', 'missing.jsonl'), '{"key":"invented-nobody"}');
    await refuses({ batch: 'missing.jsonl', review: 'fact-review-07a.jsonl' });
    await writeFile(join(dir, 'fact-review-06a.jsonl'), '{}\n');
    await refuses({ batch: 'w1c-07a.jsonl', review: 'fact-review-06a.jsonl' });
    const envelopesAfter = Number((await db.one<{ n: string }>('select count(*)::text n from agents.envelope'))!.n);
    const ledgerAfterRefusals = await readRuns({ root }).catch(() => ({ runs: [] as unknown[] }));
    check('A cloud fact check refuses when off, keyless, misnamed, outside batches, missing a finding or reusing a review file',
      refusals.length === 6 && refusals.every((r) => r === 'refused') && requested.length === 0 && calls.length === 0
      && envelopesAfter === envelopesBefore && ledgerAfterRefusals.runs.length === 0,
      `refusals: ${refusals.join(', ')}; ${requested.length} page requests, ${calls.length} model calls, ${envelopesAfter - envelopesBefore} envelopes, ${ledgerAfterRefusals.runs.length} ledger runs`);

    // The run.
    const result = await runCloudFactCheck({ batch: 'w1c-07a.jsonl', review: 'fact-review-07a.jsonl' }, juan, root, deps);
    const rows = (await readFile(join(dir, 'fact-review-07a.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const r1 = rows.find((r) => r.key === 'invented-one'), r2 = rows.find((r) => r.key === 'invented-two');
    const urls = requested.map((r) => r.url);
    check('The cloud fact check reads only the cited public pages, once each, comes back once to a refusing site, and never LinkedIn or a private address',
      !urls.includes(L) && !urls.includes(M) && urls.filter((u) => u === A).length === 1 && urls.filter((u) => u === B).length === 2
      && urls.indexOf(B) < urls.indexOf(S1) && urls.lastIndexOf(B) > urls.indexOf(S2) && !lookedUp.includes('www.linkedin.com')
      && requested.every((r) => !/claude|anthropic|plc|capital os|juan/i.test(r.ua) && r.headers.every((h) => ['user-agent', 'accept'].includes(h)))
      && requested.filter((r) => r.url.includes('sec.gov')).every((r) => r.ua.includes('blue.tunguska@agentmail.to'))
      && requested.filter((r) => !r.url.includes('sec.gov')).every((r) => !r.ua.includes('@')) && waits.includes(1100),
      `requests: ${urls.length}; waits ${waits.join(',')}`);
    check('It holds the model to the rules: unread pages grade unavailable, a quote not on its page is partly, counts are recomputed, rows pass the validator',
      r1?.facts[0].grade === 'supported' && r1?.facts[1].grade === 'partly' && /mechanical check/.test(r1?.facts[1].note) && r1?.facts[2].grade === 'unavailable'
      && /LinkedIn/.test(r1?.facts[2].note) && r1?.facts[3].grade === 'supported' && r1?.counts.supported === 2 && r1?.counts.partly === 1 && r1?.counts.unavailable === 1
      && r2?.facts[0].grade === 'unavailable' && r2?.facts[1].grade === 'supported' && r2?.facts[2].grade === 'supported'
      && rows.length === 2 && rows.every((r) => factReviewProblems(r, r.key === 'invented-one' ? one : two).length === 0),
      JSON.stringify(rows.map((r) => r.counts)));
    const ledger = await readRuns({ root });
    const run = ledger.runs.find((x) => x.runId === result.runId);
    const agentRun = await db.one<{ status: string; n: string; refused: string; agent_kind: string; prompt_hash: string }>(
      `select r.status::text, r.agent_kind, r.prompt_hash, count(t.*)::text n, count(t.*) filter (where not t.allowed)::text refused
         from agents.run r left join agents.tool_call t on t.run_id = r.run_id where r.agent_kind = 'cloud-w1c' group by r.run_id order by r.started_at desc limit 1`);
    const audit = await db.one<{ detail: Record<string, unknown> }>(`select detail from platform.audit_log where action = 'workflow.cloud_run' order by at desc limit 1`);
    check('The run is pinned in the ledger and the envelope, every page and call is a recorded tool call, and the audit has counts only',
      ledger.issues.length === 0 && run?.outcome === 'partial' && run.start?.source === 'app' && run.start.operation === 'cloud' && run.start.model === 'claude-haiku-4-5'
      && run.finish?.counts.valid === 2 && run.finish.counts.failed === 1 && run.finish.usage?.source === 'measured' && run.finish.usage.input === 3000 && run.finish.usage.output === 600
      && result.graded === 2 && result.failed === 1 && result.pages.cited === 6 && result.pages.read === 4
      && agentRun?.status === 'proposed' && Number(agentRun.n) === 6 + 1 + 3 && agentRun.refused === '0'
      && audit !== null && !JSON.stringify(audit.detail).includes('Invented Person') && !JSON.stringify(audit.detail).includes('example.org'),
      `outcome ${run?.outcome}; tool calls ${agentRun?.n}; ${JSON.stringify(result.pages)}`);
    const sent = calls[0]!;
    check('The model gets no tools, only the finding and its pages, with the page script stripped and image names kept',
      !('tools' in sent) && sent.model === 'claude-haiku-4-5' && /## Grading/.test(sent.system) && /## Facts/.test(sent.system)
      && !sent.user.includes('hidden') && sent.user.includes('example-robotics.png') && calls.length === 3,
      `${calls.length} calls`);

    // A second run of the same round refuses: the review file is never written over.
    await refuses({ batch: 'w1c-07a.jsonl', review: 'fact-review-07a.jsonl' });
    const unchanged = (await readFile(join(dir, 'fact-review-07a.jsonl'), 'utf8')).trim().split('\n').length === 2;
    check('A finished round\'s review file is never written over', refusals.at(-1) === 'refused' && unchanged, refusals.at(-1) ?? '');

    // The second step: corrections, asked for, held to the protocol, recorded by the server, originals kept.
    const four = finding('invented-four', [fact(A, 'Founder of Invented Capital Partners', 'founded Invented Capital Partners')]);
    await writeFile(join(dir, 'raw', 'invented-four.json'), JSON.stringify(four));
    await writeFile(join(dir, 'batches', 'w1c-08a.jsonl'), ['invented-one', 'invented-two', 'invented-four'].map((key) => JSON.stringify({ key })).join('\n'));
    const fixes: string[] = [];
    const correcting = async (k: string, req: ModelRequest) => {
      if (!/second step/.test(req.system)) return callModel(k, req);
      const sent = JSON.parse(req.user) as { finding: { key: string } };
      fixes.push(sent.finding.key);
      const proposed = sent.finding.key === 'invented-one'
        ? { ...one, facts: [one.facts[0], fact(A, 'Partner at Invented Capital Partners', 'Pat Example is a Partner at Invented Capital Partners'), one.facts[2], one.facts[3]] }
        : { ...four, identity: { match: 'confirmed', basis: 'A stronger basis the model made up' } };
      return { text: JSON.stringify({ finding: proposed, what: 'Cut one fact to its page\'s words.' }), stop: 'end_turn', usage: { input: 2000, output: 800, cacheRead: 0, cacheWrite: 0 } };
    };
    const fixed = await runCloudFactCheck({ batch: 'w1c-08a.jsonl', review: 'fact-review-08a.jsonl', correct: true }, juan, root, { ...deps, callModel: correcting, now: () => Date.parse('2026-10-06T03:00:00Z') });
    const oneAfter = JSON.parse(await readFile(join(dir, 'raw', 'invented-one.json'), 'utf8'));
    const fourAfter = JSON.parse(await readFile(join(dir, 'raw', 'invented-four.json'), 'utf8'));
    const keptOriginal = JSON.parse(await readFile(join(dir, 'inbox', fixed.runId, 'replaced', 'raw', 'invented-one.json'), 'utf8').catch(() => '{}'));
    const fixedRun = (await readRuns({ root })).runs.find((x) => x.runId === fixed.runId);
    check('Corrections run only where a grade calls for one, pass the protocol\'s limits, are dated by the server and keep the original',
      fixes.sort().join() === 'invented-four,invented-one' && fixed.corrected === 1 && fixed.correctionsRefused === 1
      && oneAfter.facts[1].value === 'Partner at Invented Capital Partners' && JSON.stringify(oneAfter.facts[0]) === JSON.stringify(one.facts[0])
      && oneAfter.researched.at === '2026-10-01' && oneAfter.researched.corrected?.length === 1
      && oneAfter.researched.corrected[0].by === 'claude (cloud), W1c' && oneAfter.researched.corrected[0].at === '2026-10-06'
      && JSON.stringify(keptOriginal) === JSON.stringify(one) && JSON.stringify(fourAfter) === JSON.stringify(four)
      && fixedRun?.finish?.checks.some((c) => c.name === 'corrections held to the protocol' && c.status === 'pass') === true,
      `fixes ${fixes.join(',')}; corrected ${fixed.corrected}, refused ${fixed.correctionsRefused}`);
    const { correctionProblems } = await import('../../lib/workflows/cloud-w1c-correct');
    const readPages = new Map([[A, { url: A, state: 'read' as const, why: null, status: 200, text: 'Pat Example is a Partner at Invented Capital Partners.', truncated: false, sec: false }]]);
    const g = [{ i: 0, grade: 'partly', note: '' }];
    const base = finding('invented-five', [fact(A, 'Partner', 'Partner at Invented Capital Partners')]) as never as import('../../lib/enrich/schema').Finding;
    const refusedKinds = [
      { ...base, facts: [fact('https://elsewhere.example.org/', 'Partner', 'Partner')] },
      { ...base, facts: [fact(A, 'Partner', 'a quote the page does not have')] },
      { ...base, profile: { summary: 'x', investorType: 'angel', capacity: { band: '1m-5m', basis: 'made up' } } },
      { ...base, name: 'Another Name' },
    ].map((x) => correctionProblems(base, x, g, readPages).length > 0);
    const keptSupported = correctionProblems(base, { ...base, facts: [] }, [{ i: 0, grade: 'supported', note: '' }], readPages).length > 0;
    check('A correction is refused for a new page, a quote not on its page, a changed capacity band or name, or a supported fact dropped',
      refusedKinds.every(Boolean) && keptSupported && correctionProblems(base, base, g, readPages).length === 0, JSON.stringify(refusedKinds) + correctionProblems(base, base, g, readPages).join('; '));

    check('Page text and quote helpers: public addresses only, scripts dropped, quotes matched after normalising',
      !publicAddress('127.0.0.1') && !publicAddress('10.1.2.3') && !publicAddress('169.254.169.254') && !publicAddress('192.168.0.1') && !publicAddress('::1')
      && !publicAddress('fd00::1') && !publicAddress('::ffff:10.0.0.1') && publicAddress('93.184.215.14') && publicAddress('2606:2800:220:1::1')
      && !pageText('<script>secret()</script><p>Hi</p>', 'text/html').includes('secret')
      && quoteOnPage('“Partner” at Invented—Capital', 'He is a "partner" at invented - capital.') && !quoteOnPage('Founder', 'He is a partner')
      && normalise('A  B') === 'a b', 'unit checks');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
