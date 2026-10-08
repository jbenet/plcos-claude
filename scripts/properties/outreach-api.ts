/**
 * The mail desk's outreach API (docs/27-outreach-api.md), through the real route handler, on invented data:
 *   - the scope: a vehicle-limited token reads no other vehicle; a token without the outreach scope, or no
 *     token, reads nothing; a read token cannot write;
 *   - restricted values (R1 amounts, R2 words and addresses, R4 restriction reasons) never appear to those
 *     without them, and licensed (Dakota) text to no token;
 *   - Capital OS's own labels come back apart: status, close track, seat;
 *   - fund-before-SPV and the ask cap are advisory: they flag and never hold; a blanket restriction holds;
 *   - health details are redacted from the text the desk receives (and investment theses are not);
 *   - CORS refuses every origin not on the allowlist, which is empty by default;
 *   - every call is audited.
 */
import { config } from '../../config/deployment';
import type { AppUser } from '../../modules/platform';
import type { Check, Db } from './harness';

export type Call = (secret: string | null, op: string, query?: Record<string, string>, init?: { method?: string; body?: unknown; origin?: string; headers?: Record<string, string> }) =>
  Promise<{ status: number; headers: Headers; text: string; json: any }>;

/** Calls the real route handlers, as an HTTP client would. */
export async function outreachClient(): Promise<Call> {
  const route = await import('../../app/api/outreach/[op]/route');
  const base = 'http://localhost:3119/api/outreach';
  return async (secret, op, query = {}, init = {}) => {
    const url = `${base}/${op}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`;
    const headers: Record<string, string> = { 'user-agent': 'props-desk/1.0 (invented device)' };
    if (secret) headers.authorization = `Bearer ${secret}`;
    if (init.origin) headers.origin = init.origin;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, init.headers ?? {});
    const request = new Request(url, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const ctx = { params: Promise.resolve({ op }) };
    const res = init.method === 'OPTIONS' ? await route.OPTIONS(request, ctx) : init.method === 'POST' ? await route.POST(request, ctx) : await route.GET(request, ctx);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  };
}

export async function fixtures(db: Db) {
  const juan = (await db.one<AppUser>(`select id::text, handle, name, initials, role, email, access::text, vehicles, approves from platform.app_user where handle = 'juan'`))!;
  const fund = (await db.one<{ id: string; slug: string }>(`select id::text, slug from platform.vehicle where kind = 'fund' and phase <> 'historical' order by sort_order limit 1`))!;
  const spv = (await db.one<{ id: string; slug: string }>(`select id::text, slug from platform.vehicle where kind = 'spv' and phase <> 'historical' order by sort_order limit 1`))!;
  const user = async (handle: string, access: string, scope: string[] | null) => (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ($1, $2, 'IO', 'Invented (props)', $3, $4::platform.access_role, $5::uuid[]) on conflict (handle) do update set active = true, access = excluded.access, vehicles = excluded.vehicles
    returning id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves`, [handle, `Invented ${handle}`, `${handle}@example.invalid`, access, scope]))!;
  const { createMcpToken } = await import('../../modules/platform');
  const token = async (owner: AppUser, tools: string[], vehicles: string[] | null = null) =>
    (await createMcpToken(owner, { label: `props outreach ${owner.handle} ${tools.join("+")}`.slice(0, 80), tools, vehicles, callsPerDay: 1000, days: 30 }, db)).secret;
  const entity = async (name: string, type = 'org') => (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ($1::identity.entity_type, $2) returning entity_id::text id`, [type, name]))!.id;
  const pursuit = async (e: string, v: string, status = 'selected') => (await db.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, next_step)
    values ($1, $2, $3, $4::strategy.pursuit_status, 'INVENTED_OUTREACH_R2_NEXT') returning pursuit_id::text id`, [e, v, juan.id, status]))!.id;
  return { juan, fund, spv, user, token, entity, pursuit };
}

export async function outreachReadProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ } = await import('../../lib/outreach/scopes');
  const { STATUS_LABEL } = await import('../../modules/strategy');
  const { redactHealth, REDACTED } = await import('../../lib/redact-health');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, spv, user, token, entity, pursuit } = await fixtures(db);
  const gpFund = await user('outreach-gp-fund', 'team', [fund.id]);
  const viewer = await user('outreach-viewer', 'viewer', null);

  // An LP on both vehicles, in an open fund discussion; one only on the SPV, restricted.
  const both = await entity('Invented Outreach Both Org');
  const bothFund = await pursuit(both, fund.id, 'discussing'), bothSpv = await pursuit(both, spv.id, 'selected');
  const spvOnly = await entity('Invented Outreach SPV-only Org');
  const spvOnlyP = await pursuit(spvOnly, spv.id, 'selected');
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'INVENTED_OUTREACH_R4_REASON', $2)`, [spvOnly, juan.id]);
  await db.query(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount) values ($1, $2, $3, 'lp_commitment', 'soft', 765432.10)`, [both, fund.id, juan.id]);
  await db.query(`insert into strategy.suggestion (pursuit_id, body, data, made_by, made_at, file_hash) values
    ($1, 'x', '{"angle":"They back neurotech founders. Her mother was diagnosed with cancer last year. They like early data.","next":{"what":"INVENTED_OUTREACH_FIRST_STEP"},"confidence":"medium"}', 'Invented Strategist', now() - interval '1 day', 'outreach-props-1'),
    ($1, 'INVENTED_OUTREACH_R3_LICENSED', '{"source":"dakota","angle":"INVENTED_OUTREACH_R3_LICENSED"}', 'Invented Strategist', now(), 'outreach-props-2')`, [bothSpv]);
  // Two asks made this quarter: over the cap of one, which is advisory now.
  for (const v of [fund.id, spv.id]) {
    await db.query(`insert into coordination.ask (entity_id, vehicle_id, status, owner_id, purpose, made_at)
      values ($1, $2, 'made', $3, 'Invented ask', now() - interval '3 days')`, [both, v, juan.id]);
  }

  const wide = await token(juan, [OUTREACH_READ]);
  const fundOnly = await token(gpFund, [OUTREACH_READ]);
  const noScope = await token(juan, ['search']);
  const viewerTok = await token(viewer, [OUTREACH_READ]);

  // ── Scope ─────────────────────────────────────────────────────────────────────────────
  const vFund = await call(fundOnly, 'vehicles');
  const qSpv = await call(fundOnly, 'queue', { vehicle: spv.slug });
  const qAll = await call(fundOnly, 'queue', { vehicle: 'all', limit: '300' });
  const qOne = await call(fundOnly, 'queue', { vehicle: 'all', pursuitId: bothSpv });
  const none = await call(noScope, 'queue', { vehicle: fund.slug });
  const anon = await call(null, 'vehicles');
  const write = await call(wide, 'update', {}, { method: 'POST', body: {} });
  check('Outreach API: a vehicle-limited token reads no other vehicle; a token without the outreach scope, or no token, reads nothing; a read token cannot write',
    vFund.status === 200 && vFund.json.data.every((v: { slug: string }) => v.slug === fund.slug) && qSpv.status === 404
    && qAll.status === 200 && qAll.json.data.rows.every((r: { vehicle: string }) => r.vehicle === fund.slug) && !qAll.text.includes('Invented Outreach SPV-only Org')
    && qOne.status === 200 && qOne.json.data.rows.length === 0
    && none.status === 403 && anon.status === 401 && write.status === 403,
    `vehicles: ${vFund.json?.data?.map((v: { slug: string }) => v.slug).join(',')}; queue on the SPV: ${qSpv.status}; all: ${qAll.json?.data?.rows?.length} rows, all on the fund; another vehicle's pursuit by id: ${qOne.json?.data?.rows?.length} rows; no scope: ${none.status}; no token: ${anon.status}; a write with a read token: ${write.status}`);

  // ── Restricted values ─────────────────────────────────────────────────────────────────
  // One LP at a time: the whole demo queue is longer than a page.
  const rowsOf = async (secret: string) => {
    const all = await Promise.all([bothSpv, bothFund, spvOnlyP].map((id) => call(secret, 'queue', { vehicle: 'all', pursuitId: id })));
    return { status: all.every((r) => r.status === 200) ? 200 : all.find((r) => r.status !== 200)!.status, text: all.map((r) => r.text).join('\n'),
      json: { data: all.flatMap((r) => r.json?.data?.rows ?? []) } };
  };
  const vq = await rowsOf(viewerTok);
  const vv = await call(viewerTok, 'vehicles');
  const wq = await rowsOf(wide);
  const viewerText = vq.text + vv.text;
  check('Outreach API: restricted values never appear — no amounts, words, addresses or restriction reasons to a viewer, and licensed (Dakota) text to no token',
    vq.status === 200 && vq.json.data.length === 3 && vv.status === 200 && !viewerText.includes('765432') && !viewerText.includes('INVENTED_OUTREACH_R2_NEXT') && !viewerText.includes('INVENTED_OUTREACH_FIRST_STEP')
    && !viewerText.includes('INVENTED_OUTREACH_R4_REASON') && vv.json.data.every((v: { hard: unknown }) => v.hard === null)
    && wq.status === 200 && !wq.text.includes('INVENTED_OUTREACH_R3_LICENSED') && wq.text.includes('INVENTED_OUTREACH_R4_REASON') && wq.text.includes('765432'),
    `viewer: ${vq.json?.data?.length} rows, amounts/words/reasons ${/765432|INVENTED_OUTREACH_R2|R4_REASON/.test(viewerText) ? 'LEAKED' : 'withheld'}; Juan's token: licensed ${wq.text.includes('R3_LICENSED') ? 'LEAKED' : 'absent'}, reasons and amounts ${wq.text.includes('R4_REASON') && wq.text.includes('765432') ? 'present' : 'MISSING'}`);

  // ── Labels, checks, buckets ───────────────────────────────────────────────────────────
  type Row = { pursuitId: string; bucket: string; status: { value: string; label: string }; closeTrack: { state: string; label: string; called: unknown } | null;
    seat: unknown; strategy: { headline: string | null } | null; checks: Array<{ rule: string; ok: boolean; blocking: boolean; choices?: string[] }> };
  const row = (id: string) => (wq.json?.data as Row[] | undefined)?.find((r) => r.pursuitId === id);
  const rs = row(bothSpv), rf = row(bothFund), rr = row(spvOnlyP);
  const chk = (r: Row | undefined, rule: string) => r?.checks.find((c) => c.rule === rule);
  check('Outreach API: status, close track and SPV seat come back apart, each with Capital OS\'s own label',
    rs?.status.value === 'selected' && rs.status.label === STATUS_LABEL.selected && rf?.status.label === STATUS_LABEL.discussing
    && rf.closeTrack?.state === 'soft' && rf.closeTrack.label === 'Soft' && rf.closeTrack.called === null && rs !== undefined && 'seat' in rs,
    `SPV row: ${rs?.status.value}/${rs?.status.label}; fund row: ${rf?.status.label}, close track ${rf?.closeTrack?.state}/${rf?.closeTrack?.label}`);
  check('Outreach API: fund-before-SPV and the ask cap are advisory — they flag (with the desk\'s choices) and never hold; a blanket restriction holds',
    chk(rs, 'fund_first')?.ok === false && chk(rs, 'fund_first')?.blocking === false && chk(rs, 'fund_first')?.choices?.join() === 'mention_both,send_separately,wait'
    && chk(rs, 'ask_count')?.ok === false && chk(rs, 'ask_count')?.blocking === false && rs?.bucket !== 'held'
    && chk(rr, 'restriction')?.ok === false && chk(rr, 'restriction')?.blocking === true && rr?.bucket === 'held' && !chk(rf, 'fund_first'),
    `SPV row: fund_first ${JSON.stringify(chk(rs, 'fund_first'))}, ask_count blocking ${chk(rs, 'ask_count')?.blocking}, bucket ${rs?.bucket}; restricted row: ${rr?.bucket}`);

  // ── Redaction ─────────────────────────────────────────────────────────────────────────
  const cases: Array<[string, boolean]> = [
    ['Her mother was diagnosed with cancer last year.', true], ['He is on medical leave until March.', true], ['She is pregnant with twins.', true],
    ['His son has autism.', true], ['They mentioned a genetic test result.', true], ['He is in therapy for anxiety.', true], ['She has used a wheelchair since the accident.', true],
    ['He was hospitalized in June.', true], ['His father passed away in the spring.', true],
    ['They invest in Parkinson\'s disease therapies.', false], ['The fund backs gene therapy and cancer diagnostics companies.', false],
    ['Closing conditions are standard; tax treatment is pass-through.', false], ['A stroke of luck: they met at the conference.', false],
    ['Their portfolio includes companies working with ALS patients.', false],
  ];
  const wrong = cases.filter(([t, health]) => (redactHealth(t).redacted > 0) !== health);
  const mixed = redactHealth('They back neurotech founders. Her mother was diagnosed with cancer. She had surgery in May. They like early data.');
  const headline = rs?.strategy?.headline ?? '';
  check('Outreach API: health details are redacted, by sentence, from the text the desk receives; investment theses are not',
    wrong.length === 0 && mixed.text === `They back neurotech founders. ${REDACTED} They like early data.` && mixed.redacted === 2
    && headline.includes(REDACTED) && !headline.includes('cancer') && headline.includes('They back neurotech founders.'),
    `${cases.length - wrong.length}/${cases.length} cases right${wrong.length ? ` (wrong: ${wrong.map((w) => w[0]).join(' | ')})` : ''}; joined: "${mixed.text}"; the queue's headline: "${headline}"`);

  // ── CORS ──────────────────────────────────────────────────────────────────────────────
  const evil = await call(wide, 'vehicles', {}, { origin: 'https://evil.example' });
  const evilPre = await call(null, 'vehicles', {}, { method: 'OPTIONS', origin: 'https://evil.example' });
  const same = await call(wide, 'vehicles', {}, { origin: 'http://localhost:3119' });
  const emptyByDefault = config.outreach.corsOrigins.length === 0;
  config.outreach.corsOrigins.push('https://desk.example');
  const pre = await call(null, 'vehicles', {}, { method: 'OPTIONS', origin: 'https://desk.example' });
  const allowed = await call(wide, 'vehicles', {}, { origin: 'https://desk.example' });
  config.outreach.corsOrigins.length = 0;
  check('Outreach API: CORS refuses an origin not on the allowlist (empty by default); an allowlisted one gets exactly its origin back, never a wildcard or credentials',
    emptyByDefault && evil.status === 403 && evilPre.status === 403 && !evilPre.headers.get('access-control-allow-origin') && same.status === 200
    && pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://desk.example' && /Authorization/.test(pre.headers.get('access-control-allow-headers') ?? '')
    && !pre.headers.get('access-control-allow-credentials') && allowed.status === 200 && allowed.headers.get('access-control-allow-origin') === 'https://desk.example',
    `evil: ${evil.status}, preflight ${evilPre.status}; same origin: ${same.status}; allowlisted preflight ${pre.status} → ${pre.headers.get('access-control-allow-origin')}, credentials ${pre.headers.get('access-control-allow-credentials') ?? 'none'}`);

  // ── No call limits (Juan, 8 Oct 2026) ─────────────────────────────────────────────────────
  const { createMcpToken } = await import('../../modules/platform');
  const { OUTREACH_READ: READ } = await import('../../lib/outreach/scopes');
  const small = (await createMcpToken(juan, { label: 'props outreach no limit', tools: [READ], vehicles: null, callsPerDay: 2, days: 30 }, db)).secret;
  const runs = [await call(small, 'vehicles'), await call(small, 'vehicles'), await call(small, 'vehicles')];
  check('Outreach API: calls are not limited: a token whose stored daily figure is 2 answers a third call, with no rate headers',
    runs.every((x) => x.status === 200) && runs.every((x) => !x.headers.get('x-ratelimit-remaining-day') && !x.headers.get('retry-after')),
    runs.map((x) => x.status).join(', '));

  // ── Audit and the device ──────────────────────────────────────────────────────────────
  const audits = await db.query<{ op: string; outcome: string; via: string }>(`select detail->>'tool' op, detail->>'outcome' outcome, detail->>'via' via
    from platform.audit_log where action = 'mcp.call' and detail->>'via' = 'rest' and actor_id in ($1, $2, $3)`, [juan.id, gpFund.id, viewer.id]);
  const device = await db.one<{ from: string | null }>(`select last_used_from "from" from platform.mcp_token where user_id = $1 order by created_at desc limit 1`, [gpFund.id]);
  check('Outreach API: every REST call writes the same mcp.call audit record as MCP (via rest), refusals included; the token keeps the device it was last used from',
    audits.length >= 10 && audits.some((a) => a.op === 'outreach_queue' && a.outcome === 'refused') && audits.some((a) => a.op === 'outreach_update' && a.outcome === 'refused')
    && audits.some((a) => a.op === 'outreach_vehicles' && a.outcome === 'ok') && device?.from === 'props-desk/1.0 (invented device)',
    `${audits.length} entries: ${[...new Set(audits.map((a) => `${a.op}:${a.outcome}`))].join(', ')}; device: ${device?.from}`);
}
