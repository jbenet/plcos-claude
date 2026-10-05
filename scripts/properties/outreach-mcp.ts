/**
 * The outreach tools over MCP (docs/27: MCP is juanmail's primary interface), through the real /api/mcp handler and
 * the SDK client, on invented data:
 *   - a token sees and calls the outreach tools only with the outreach scope; write tools need outreach:write;
 *   - every call writes one structured mcp.call record: via, client, tool, risk, scopes, input hash, outcome, reason,
 *     latency, affected ids, idempotency key, correlation id; refusals included;
 *   - audit_recent answers only the caller's own calls, filtered by correlation id;
 *   - the queue's updatedSince answers only what changed since the cursor;
 *   - outreach_record_send refuses without an approved ticket.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Check, Db } from './harness';
import { fixtures } from './outreach-api';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };

export async function outreachMcpProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { READ_TOOLS } = await import('../../lib/mcp/tools');
  const { POST } = await import('../../app/api/mcp/route');
  resetWindows();
  const { juan, fund, user, token, entity, pursuit } = await fixtures(db);
  const connect = async (secret: string) => {
    const client = new Client({ name: 'props-juanmail', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3119/api/mcp'), {
      fetch: (u, init) => POST(new Request(u, init)), requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }));
    return client;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown>, correlationId?: string) => {
    const r = (await c.callTool({ name, arguments: args, ...(correlationId ? { _meta: { correlationId } } : {}) })) as Result;
    const text = r.content.map((x) => x.text).join('\n');
    let data: any = null;
    try { data = JSON.parse(text).data; } catch { /* a refusal is plain text */ }
    return { error: r.isError ? text : null, data };
  };

  const plain = await connect(await token(juan, [...READ_TOOLS]));
  const reader = await connect(await token(juan, [...READ_TOOLS, OUTREACH_READ]));
  const writer = await connect(await token(juan, [...READ_TOOLS, OUTREACH_READ, OUTREACH_WRITE]));
  const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);
  const [plainTools, readerTools, writerTools] = [await names(plain), await names(reader), await names(writer)];
  const lp = await entity('Invented Outreach MCP Org');
  const p = await pursuit(lp, fund.id, 'selected');
  const plainQueue = await call(plain, 'outreach_queue', { vehicle: 'all', pursuitId: p });
  const readerUpdate = await call(reader, 'outreach_update', { pursuitId: p, words: 'Invented.', idempotencyKey: 'props-mcp-refused-1' });
  check('Outreach over MCP: the outreach tools exist for a token only with the outreach scope, and writes only with outreach:write',
    !plainTools.some((t) => t.startsWith('outreach_')) && readerTools.includes('outreach_queue') && !readerTools.includes('outreach_update')
    && writerTools.includes('outreach_update') && writerTools.includes('outreach_record_send')
    && /outreach:read/.test(plainQueue.error ?? '') && /outreach:write/.test(readerUpdate.error ?? ''),
    `plain: ${plainTools.filter((t) => t.startsWith('outreach_')).length} outreach tools; read scope: ${readerTools.filter((t) => t.startsWith('outreach_')).join(',')}; `
    + `write scope adds ${writerTools.filter((t) => !readerTools.includes(t)).join(',')}; refusals: ${plainQueue.error?.slice(0, 50)} / ${readerUpdate.error?.slice(0, 50)}`);

  // ── One structured record per call, with the chain's correlation id ───────────────────
  const chain = 'props-chain-1';
  const first = await call(writer, 'outreach_queue', { vehicle: 'all', pursuitId: p }, chain);
  const cursor = first.data?.cursor as string;
  const upd = await call(writer, 'outreach_update', { pursuitId: p, words: 'Invented: they replied.', applied: { nextStep: { step: 'Invented next' } }, idempotencyKey: 'props-mcp-u1' }, chain);
  const early = await call(writer, 'outreach_record_send', { ticketId: '00000000-0000-4000-8000-000000000000', pursuitId: p, recipients: ['x@invented.example'], gmailMessageId: 'props-m1', sentAt: new Date().toISOString() }, chain);
  const records = await db.query<{ d: Record<string, any> }>(`select detail d from platform.audit_log where action = 'mcp.call' and detail->>'correlationId' = $1 order by id`, [chain]);
  const u = records.find((r) => r.d.tool === 'outreach_update')?.d;
  const e = records.find((r) => r.d.tool === 'outreach_record_send')?.d;
  check('Outreach over MCP: every call writes one structured record — via, client, tool, risk, scopes, input hash, outcome and reason, latency, affected ids, idempotency key, correlation id; refusals too',
    records.length === 3 && !upd.error && u?.via === 'mcp' && typeof u.client === 'string' && u.risk === 'write-guarded' && u.scopes?.[0] === OUTREACH_WRITE
    && /^[0-9a-f]{64}$/.test(u.inputHash) && u.outcome === 'ok' && typeof u.ms === 'number' && u.affected?.pursuitId === p && typeof u.affected?.updateId === 'string'
    && u.idempotencyKey === 'props-mcp-u1' && !JSON.stringify(u.args).includes('they replied')
    && Boolean(early.error) && e?.outcome === 'refused' && typeof e.reason === 'string' && e.risk === 'send-adjacent',
    `${records.length} records in the chain; update: ${JSON.stringify({ via: u?.via, risk: u?.risk, outcome: u?.outcome, affected: Object.keys(u?.affected ?? {}), key: u?.idempotencyKey })}; early send: ${e?.outcome} (${String(e?.reason).slice(0, 60)})`);

  // ── audit_recent: one's own, by correlation id ────────────────────────────────────────
  const other = await user('outreach-mcp-other', 'team', null);
  const otherClient = await connect(await token(other, [...READ_TOOLS, OUTREACH_READ]));
  await call(otherClient, 'outreach_vehicles', {}, chain);
  const mine = await call(writer, 'audit_recent', { correlationId: chain });
  const theirs = await call(otherClient, 'audit_recent', { correlationId: chain });
  check('Outreach over MCP: audit_recent answers only the caller\'s own calls, and finds a chain by its correlation id',
    mine.data?.length === 3 && mine.data.every((r: { tool: string }) => r.tool !== 'outreach_vehicles') && theirs.data?.length === 1 && theirs.data[0].tool === 'outreach_vehicles',
    `mine: ${mine.data?.map((r: { tool: string }) => r.tool).join(',')}; the other person's: ${theirs.data?.map((r: { tool: string }) => r.tool).join(',')}`);

  // ── updatedSince: only what changed since the cursor ──────────────────────────────────
  const quiet = await pursuit(await entity('Invented Outreach Quiet Org'), fund.id, 'selected');
  const sinceAll = await call(writer, 'outreach_queue', { vehicle: fund.slug, updatedSince: cursor, limit: 300 });
  const ids = (sinceAll.data?.rows ?? []).map((r: { pursuitId: string }) => r.pursuitId);
  const after = await call(writer, 'outreach_queue', { vehicle: fund.slug, updatedSince: new Date(Date.now() + 60_000).toISOString() });
  check('Outreach over MCP: the queue with updatedSince answers only rows changed since the cursor, each with when',
    typeof cursor === 'string' && ids.includes(p) && ids.includes(quiet) && sinceAll.data.rows.every((r: { updatedAt: string }) => r.updatedAt >= cursor)
    && after.data?.rows?.length === 0 && after.data.total === 0,
    `since the cursor: ${ids.length} rows (the updated LP ${ids.includes(p) ? 'in' : 'MISSING'}, a new one ${ids.includes(quiet) ? 'in' : 'MISSING'}); since a minute ahead: ${after.data?.total}`);
  for (const c of [plain, reader, writer, otherClient]) await c.close();
}
