/**
 * MCP access (docs/26-mcp.md), through the real route handler and the SDK client, on invented data.
 *   - the registry has only read and draft tools: nothing sends, accepts, approves, changes a status
 *     behind a ticket, moves money, imports or runs a connector; an unknown name does not exist;
 *   - a token scoped to one vehicle cannot read another vehicle's LPs, by any tool;
 *   - restricted values (R1 amounts, R2 words, R4 reasons) never appear to those without them, and R3
 *     (licensed Dakota) to no token at all, since Dakota data never goes into an agent's prompt;
 *   - a revoked or expired token fails, and its refusal is logged; a cross-site Origin is refused;
 *   - every call writes an audit entry with the tool and no typed words; budgets and rate limits refuse;
 *   - answers are marked as data and kept under the size limit; the draft tool writes a draft only.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../../config/deployment';
import { actAs } from '../../lib/auth/acting';
import { currentUser } from '../../lib/auth';
import { DATA_NOTICE, oneLine, render } from '../../lib/mcp/output';
import { auditArgs, narrowedPrincipal, resetWindows } from '../../lib/mcp/envelope';
import { READ_TOOLS, TOOLS, TOOL_NAMES } from '../../lib/mcp/tools';
import { createMcpToken, revokeMcpToken, type AppUser } from '../../modules/platform';
import type { Check, Db } from './harness';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };

/**
 * Names no tool may have: each is an act a person does in the app, behind a ticket or a click. A connector run is
 * named by its system (Affinity, Linear, Dakota, Polaris, Gmail, mailguard, DocSend) or by running, syncing or
 * importing. "connector" alone is a person on a warm route (docs/27 §4b), so a read of them may say so
 * (5 Oct 2026: the old blanket rule forced one connector's targets into top_connectors).
 */
const FORBIDDEN = /approv|accept|decid|reject|status|stage|ladder|rung|money|wire|alloc|harden|close|import|sync|translat|affinity|linear|dakota|polaris|gmail|mailguard|docsend|run_|_run|workflow|move|merge|delete|discard|revoke/i;
/** Named for a send or a ticket: allowed only to a tool whose policy says a person approves first (docs/26 §3). */
const SEND_OR_TICKET = /send|ticket/i;
/** Service calls that send, decide or move money; none may be reachable from lib/mcp or lib/outreach. */
const FORBIDDEN_CALLS = ['moveDraft', 'discardDraft', 'decideTicket', 'decide(', 'decideMany', 'setPursuitStatus', 'requestLadderAdvance', 'recordWire',
  'requestHarden', 'harden(', 'recordCash', 'reviseSoft', 'recordSignature', 'recordClosing', 'recordAdvance', 'recordClimb', 'closeTrackAction', 'runWorkflow',
  'importFindings', 'syncLinear', 'translate', 'checkedClient', 'mailguardClient', 'connectMailguard', 'connectKey', 'decideSuggestion', 'adjudicate',
  'proposeSend', 'makeAsk', 'applyApprovedTicket', 'recordSend('];
const RISKS = ['read', 'propose', 'write-guarded', 'send-adjacent'];

export async function mcpProperties(check: Check, db: Db) {
  // Issue 0141: a timeline row is one short line, without rule preambles or raw ids.
  const lines = [oneLine("Added by rule on Juan's instruction (26 Sep): Backs neurotech funds; capacity $1M–$5M (guess)"),
    oneLine('Merged pursuit 3f1af527-ac4c-43a6-bb32-01430e9b5a7e. Owner: Invented Owner. Status: new.'),
    oneLine('juan-prospects-2026-09-26: an invented reason'), oneLine('First line.\nSecond line.'), oneLine('word '.repeat(80))];
  check('MCP: a timeline note reads as one short line, with no rule preamble, raw id or second line (0141)',
    lines[0] === 'Backs neurotech funds; capacity $1M–$5M (guess)' && lines[1] === 'Merged a duplicate pursuit. Owner: Invented Owner. Status: new.'
      && lines[2] === 'an invented reason' && lines[3] === 'First line.' && lines[4]!.length <= 141 && lines[4]!.endsWith('…'),
    JSON.stringify(lines.slice(0, 4)));
  resetWindows();
  const { POST } = await import('../../app/api/mcp/route');
  const url = 'http://localhost:3119/api/mcp';
  const handler = (request: Request) => POST(request);
  const connect = async (secret: string) => {
    const client = new Client({ name: 'props', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
      fetch: (u, init) => handler(new Request(u, init)), requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }));
    return client;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => r.content.map((x) => x.text).join('\n');
  const json = (r: Result) => JSON.parse(text(r)) as { about: string; data: any; truncated: unknown };

  // ── The registry ──────────────────────────────────────────────────────────────────────
  const badNames = TOOLS.filter((t) => FORBIDDEN.test(t.name) || !RISKS.includes(t.policy.risk)
    || (SEND_OR_TICKET.test(t.name) && !(t.policy.approval && t.policy.ticket !== 'none'))
    // A send-adjacent tool records; one that links our own sends fails closed for an agent (5 Oct 2026: 'agent-only').
    || (t.policy.risk === 'send-adjacent' && (t.policy.ticket === 'opens' || (/send|link/.test(t.name) && !['requires-approved', 'agent-only'].includes(t.policy.ticket))))
    || (t.policy.risk !== 'read' && t.policy.risk !== 'propose' && !t.policy.scopes.length));
  const reach: string[] = [];
  for (const dir of ['lib/mcp', 'lib/outreach']) {
    for (const f of await readdir(join(process.cwd(), dir))) {
      const src = await readFile(join(process.cwd(), dir, f), 'utf8');
      for (const name of FORBIDDEN_CALLS) if (src.includes(name)) reach.push(`${dir}/${f}: ${name}`);
    }
  }
  check('MCP: every tool has a policy (read, propose, write-guarded, send-adjacent); none is named for, or reaches, a send, a ticket decision, a status-by-ticket or money act',
    badNames.length === 0 && reach.length === 0 && new Set(TOOLS.map((t) => t.name)).size === TOOLS.length
    && TOOLS.filter((t) => t.policy.risk === 'propose' && !t.policy.scopes.length).map((t) => t.name).sort().join(',') === 'create_email_draft,file_feedback'
    && TOOLS.filter((t) => t.policy.risk !== 'read').every((t) => t.policy.risk === 'propose' ? t.policy.approval : t.policy.scopes.length > 0),
    `${TOOLS.length} tools: ${RISKS.map((r) => `${TOOLS.filter((t) => t.policy.risk === r).length} ${r}`).join(', ')}; ${badNames.map((t) => t.name).join(', ') || 'no bad names'}; ${reach.join(', ') || 'no acting service reachable from lib/mcp or lib/outreach'}`);

  // ── Fixtures: two vehicles, an LP on both, one only on the second, users and tokens ──────
  const vehicles = await db.query<{ id: string; slug: string }>(`select id::text, slug from platform.vehicle where phase <> 'historical' and kind <> 'grant_rail' order by sort_order limit 2`);
  const [A, B] = vehicles as [{ id: string; slug: string }, { id: string; slug: string }];
  const juan = (await db.one<AppUser>(`select id::text, handle, name, initials, role, email, access::text, vehicles, approves from platform.app_user where handle = 'juan'`))!;
  const user = async (handle: string, access: string, scope: string[] | null) => (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ($1, $2, 'IM', 'Invented (props)', $3, $4::platform.access_role, $5::uuid[]) on conflict (handle) do update set active = true, access = excluded.access, vehicles = excluded.vehicles
    returning id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves`, [handle, `Invented ${handle}`, `${handle}@example.invalid`, access, scope]))!;
  const gpA = await user('mcp-gp-a', 'team', [A.id]);
  const gpAll = await user('mcp-gp-all', 'team', null);
  const viewer = await user('mcp-viewer', 'viewer', null);
  const entity = async (name: string) => (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ('org', $1) returning entity_id::text id`, [name]))!.id;
  const both = await entity('Invented MCP Both Org');
  const onlyB = await entity('Invented MCP Outside Org');
  const pursuit = async (e: string, v: string) => (await db.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, next_step)
    values ($1, $2, $3, 'selected', 'INVENTED_MCP_R2_NEXT') returning pursuit_id::text id`, [e, v, juan.id]))!.id;
  const onA = await pursuit(both, A.id), onB = await pursuit(both, B.id), outside = await pursuit(onlyB, B.id);
  await db.query(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount) values ($1, $2, $3, 'lp_commitment', 'soft', 876543.21)`, [both, A.id, juan.id]);
  await db.query(`insert into strategy.suggestion (pursuit_id, body, data, made_by, made_at, file_hash) values
    ($1, 'INVENTED_MCP_R2_STRATEGY', '{"list":"this year","angle":"INVENTED_MCP_R2_ANGLE"}', 'Invented Strategist', now() - interval '1 day', 'mcp-props-1'),
    ($1, 'INVENTED_MCP_R3_LICENSED', '{"source":"dakota"}', 'Invented Strategist', now(), 'mcp-props-2'),
    ($2, 'INVENTED_MCP_OUTSIDE_STRATEGY', '{}', 'Invented Strategist', now(), 'mcp-props-3')`, [onA, outside]);
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'INVENTED_MCP_R4_REASON', $2)`, [both, juan.id]);
  const token = async (owner: AppUser, tools: readonly string[], vehicles: string[] | null = null, callsPerDay = 1000) =>
    (await createMcpToken(owner, { label: `props ${owner.handle}`, tools: [...tools], vehicles, callsPerDay, days: 30 }, db)).secret;

  // ── Scope: a token for vehicle A cannot read B's LPs, by any tool ──────────────────────
  const scoped = await connect(await token(gpA, TOOL_NAMES));
  const sA = await call(scoped, 'search', { query: 'Invented MCP' });
  const pB = await call(scoped, 'pipeline', { vehicle: B.slug });
  const lB = await call(scoped, 'lp_summary', { pursuitId: outside, routes: false });
  const lBoth = await call(scoped, 'lp_summary', { pursuitId: onB, routes: false });
  const tB = await call(scoped, 'target_lists', { vehicle: B.slug });
  const rB = await call(scoped, 'routes_to', { targetId: onlyB, vehicle: B.slug });
  const rT = await call(scoped, 'routes_through', { nodeId: onlyB });
  const oB = await call(scoped, 'replies_owed', { vehicle: B.slug });
  const dB = await call(scoped, 'create_email_draft', { purpose: 'first_message', pursuitId: outside });
  const lA = await call(scoped, 'lp_summary', { pursuitId: onA, routes: false });
  const scopedText = [sA, pB, lB, lBoth, tB, rB, rT, oB, dB, lA].map(text).join('\n');
  check('MCP: a token scoped to one vehicle cannot read another vehicle\'s LPs through any tool',
    !sA.isError && !text(sA).includes('Invented MCP Outside Org') && json(sA).data.some((r: any) => r.entityId === both)
    && [pB, lB, lBoth, tB, rB, rT, oB, dB].every((r) => r.isError)
    && !scopedText.includes('INVENTED_MCP_OUTSIDE_STRATEGY') && !lA.isError && json(lA).data.pursuitId === onA,
    'search hides the B-only LP; pipeline, LP summary, target lists, routes, replies owed and drafting on B refused; A reads');
  // A wide user's token narrowed to A is as narrow as gpA; an Admin's narrowed token reads as a GP there.
  const narrowed = await connect(await token(gpAll, READ_TOOLS, [A.id]));
  const adminNarrow = await connect(await token(juan, READ_TOOLS, [A.id]));
  const nB = await call(narrowed, 'pipeline', { vehicle: B.slug }), aB = await call(adminNarrow, 'pipeline', { vehicle: B.slug });
  const aA = await call(adminNarrow, 'lp_summary', { pursuitId: onA, routes: false });
  check('MCP: a token narrows its owner\'s vehicles and never widens them; an Admin\'s token is a GP, limited when its vehicles are',
    nB.isError === true && aB.isError === true && !aA.isError && !text(aA).includes('INVENTED_MCP_R3_LICENSED')
    && narrowedPrincipal(gpA, [A.id, B.id]).vehicles!.join() === A.id && narrowedPrincipal(juan, [A.id]).access === 'team' && narrowedPrincipal(juan, null).access === 'team',
    'B refused for both narrowed tokens; the intersection drops a vehicle the owner lacks');

  // ── Restricted values ─────────────────────────────────────────────────────────────────
  const v = await connect(await token(viewer, READ_TOOLS));
  const viewerText = [
    await call(v, 'lp_summary', { pursuitId: onA, routes: false }), await call(v, 'pipeline', { vehicle: A.slug }),
    await call(v, 'search', { query: 'Invented MCP' }), await call(v, 'target_lists', { vehicle: A.slug }), await call(v, 'replies_owed', {}),
  ].map(text).join('\n');
  const admin = await connect(await token(juan, READ_TOOLS));
  const adminText = text(await call(admin, 'lp_summary', { pursuitId: onA, routes: false }));
  const gpText = text(lA);
  const sentinels = ['876543', 'INVENTED_MCP_R2_STRATEGY', 'INVENTED_MCP_R2_NEXT', 'INVENTED_MCP_R4_REASON', 'INVENTED_MCP_R3_LICENSED'];
  check('MCP: restricted values never appear — a Viewer gets no amounts, words or reasons; licensed (Dakota) values reach no token, an Admin\'s included',
    sentinels.every((s) => !viewerText.includes(s)) && viewerText.includes('Withheld')
    && !gpText.includes('INVENTED_MCP_R3_LICENSED') && ['876543', 'INVENTED_MCP_R2_STRATEGY', 'INVENTED_MCP_R4_REASON'].every((s) => gpText.includes(s))
    && !adminText.includes('INVENTED_MCP_R3_LICENSED') && adminText.includes('INVENTED_MCP_R2_STRATEGY') && adminText.includes('INVENTED_MCP_R4_REASON'),
    'the sentinels are reachable (the GP in scope reads R1/R2/R4) and absent where the policy withholds them; an Admin token reads as a GP, so R3 stays home');

  // ── No act: unknown tools do not exist, and reading changes nothing ─────────────────────
  const before = await db.one<{ s: string }>(`select concat_ws(':', (select count(*) from strategy.pursuit_update), (select count(*) from governance.approval_ticket where decision is not null),
    (select count(*) from email.draft where status = 'in_gmail'), (select string_agg(status::text, ',' order by pursuit_id) from strategy.pursuit)) s`);
  const fake = await Promise.all(['send_email', 'move_draft_to_gmail', 'approve_ticket', 'set_pursuit_status', 'record_wire', 'run_import'].map((n) => call(admin, n, {})));
  const listed = (await admin.listTools()).tools;
  const afterRead = await db.one<{ s: string }>(`select concat_ws(':', (select count(*) from strategy.pursuit_update), (select count(*) from governance.approval_ticket where decision is not null),
    (select count(*) from email.draft where status = 'in_gmail'), (select string_agg(status::text, ',' order by pursuit_id) from strategy.pursuit)) s`);
  check('MCP: no tool can send, accept or change a gated status — the server has no such tool, and a read-only token lists no draft tool',
    fake.every((r) => r.isError && text(r).includes('There is no tool')) && before?.s === afterRead?.s
    && listed.length === READ_TOOLS.length && listed.every((t) => t.annotations?.readOnlyHint === true && !FORBIDDEN.test(t.name)),
    `${fake.length} invented act names refused; statuses, decisions and Gmail moves unchanged; ${listed.length} tools listed to a read token`);

  // ── The draft tool writes a draft, as its owner, and nothing more ─────────────────────
  const drafted = await call(scoped, 'create_email_draft', { purpose: 'first_message', pursuitId: onA, subject: 'Invented subject', body: 'Invented body.' });
  const draftId = drafted.isError ? null : json(drafted).data.draftId as string;
  const draft = draftId ? await db.one<{ owner: string; status: string; subject: string }>('select owner_id::text owner, status, subject from email.draft where draft_id = $1', [draftId]) : null;
  const viaRead = await call(v, 'create_email_draft', { purpose: 'first_message', pursuitId: onA });
  const feedback = await call(scoped, 'file_feedback', { title: 'Invented feedback from props' });
  check('MCP: the draft tool saves a draft for its owner (not moved, not sent); a read token cannot draft; feedback follows the box\'s rule',
    draft?.owner === gpA.id && draft.status === 'editing' && draft.subject === 'Invented subject' && viaRead.isError === true
    && text(viaRead).includes('not in this token\'s envelope') && feedback.isError === true && text(feedback).includes('live app'),
    `draft ${draft?.status ?? 'missing'}; read token refused; feedback refused on a branch server, as the box is`);

  // ── Revoked, expired, cross-site, no token ─────────────────────────────────────────────
  const secret = await token(gpAll, READ_TOOLS);
  const live = await connect(secret);
  const okBefore = !(await call(live, 'changelog', { limit: 1 })).isError;
  const id = (await db.one<{ id: string }>(`select token_id::text id from platform.mcp_token where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [secret]))!.id;
  await revokeMcpToken(gpAll, id, db);
  const after = await call(live, 'changelog', { limit: 1 }).then(() => 'answered', (e: unknown) => String(e));
  const raw = (headers: Record<string, string>) => handler(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
  const revoked = await raw({ authorization: `Bearer ${secret}` });
  const expiring = await token(gpAll, READ_TOOLS);
  await db.query(`update platform.mcp_token set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [expiring]);
  const expired = await raw({ authorization: `Bearer ${expiring}` });
  const crossSite = await raw({ authorization: `Bearer ${await token(gpAll, READ_TOOLS)}`, origin: 'https://evil.example' });
  const none = await raw({});
  const refusals = await db.one<{ n: number }>(`select count(*)::int n from platform.audit_log where action = 'mcp.refused' and subject_id = $1 and detail->>'reason' = 'revoked'`, [id]);
  check('MCP: a revoked or expired token fails and the refusal is logged; a cross-site Origin and a missing token are refused',
    okBefore && after !== 'answered' && revoked.status === 401 && expired.status === 401 && crossSite.status === 403 && none.status === 401
    && (none.headers.get('www-authenticate') ?? '').startsWith('Bearer') && (refusals?.n ?? 0) >= 1,
    `revoked ${revoked.status}, expired ${expired.status}, cross-site ${crossSite.status}, none ${none.status}; ${refusals?.n} refusal entries`);

  // ── Audit, budgets, rate ────────────────────────────────────────────────────────────────
  const audited = await db.query<{ tool: string; outcome: string; args: Record<string, unknown> }>(`select detail->>'tool' tool, detail->>'outcome' outcome, detail->'args' args
    from platform.audit_log a join platform.mcp_token t on t.token_id::text = a.subject_id where a.action = 'mcp.call' and t.user_id = $1 order by a.id`, [gpA.id]);
  const searchArgs = audited.find((a) => a.tool === 'search')?.args;
  check('MCP: every call writes an audit entry with the tool and outcome, and keeps no typed words',
    audited.length === 12 && audited.filter((a) => a.outcome === 'refused').length === 9 && audited.some((a) => a.tool === 'create_email_draft' && a.outcome === 'ok')
    && JSON.stringify(searchArgs) === JSON.stringify({ query: { chars: 'Invented MCP'.length } })
    && JSON.stringify(auditArgs({ pursuitId: onA, vehicle: 'plc-neurotech', body: 'Dear Ana' })) === JSON.stringify({ pursuitId: onA, vehicle: 'plc-neurotech', body: { chars: 8 } }),
    `${audited.length} entries for the scoped token's ${audited.length} calls; search query kept as its length`);
  const budget = await connect(await token(gpAll, READ_TOOLS, null, 2));
  const spent = [await call(budget, 'changelog', { limit: 1 }), await call(budget, 'changelog', { limit: 1 }), await call(budget, 'changelog', { limit: 1 })];
  const perMinute = config.mcp.callsPerMinute;
  (config.mcp as { callsPerMinute: number }).callsPerMinute = 2;
  const rate = await connect(await token(gpAll, READ_TOOLS));
  const fast = [await call(rate, 'changelog', { limit: 1 }), await call(rate, 'changelog', { limit: 1 }), await call(rate, 'changelog', { limit: 1 })];
  (config.mcp as { callsPerMinute: number }).callsPerMinute = perMinute;
  // Juan, 8 Oct 2026: "remove token limits for PLCOS -- re-implement them only after we find a need for them".
  check('MCP: calls are not limited: a token\'s stored daily figure and the per-minute setting refuse nothing',
    spent.every((r) => !r.isError) && fast.every((r) => !r.isError),
    `three calls on a token whose calls_per_day is 2: ${spent.map((r) => (r.isError ? 'refused' : 'ok')).join(', ')}; three at a per-minute setting of 2: ${fast.map((r) => (r.isError ? 'refused' : 'ok')).join(', ')}`);

  // ── Marked as data, kept small; acting as the token's owner ────────────────────────────
  const big = render('pipeline', { data: { rows: Array.from({ length: 5000 }, (_, i) => ({ i, note: 'x'.repeat(200) })), long: 'y'.repeat(9000) } }, 20_000);
  const parsed = JSON.parse(big.text) as { about: string; truncated: string; data: { rows: unknown[]; long: string } };
  const seen = await actAs({ ...gpA }, async () => (await currentUser()).handle);
  check('MCP: answers are marked as data and fit the size limit; inside a call, the app\'s current user is the token\'s owner',
    json(lA).about === DATA_NOTICE && big.bytes <= 20_000 && parsed.about === DATA_NOTICE && parsed.data.rows.length < 5000
    && typeof parsed.truncated === 'string' && parsed.data.long.length < 9000 && seen === 'mcp-gp-a',
    `${big.bytes} bytes after cutting ${5000 - parsed.data.rows.length} rows; currentUser() = ${seen}`);

  for (const c of [scoped, narrowed, adminNarrow, v, admin, live, budget, rate]) await c.close().catch(() => undefined);
  // Leave the invented users inactive: the audit log is append-only and references them.
  await db.query(`update platform.app_user set active = false where handle in ('mcp-gp-a', 'mcp-gp-all', 'mcp-viewer')`);
  await db.query(`update platform.mcp_token set revoked_at = coalesce(revoked_at, now())`);
}
