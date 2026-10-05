import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import type { Envelope } from './envelope';
import { auditArgs } from './envelope';
import type { Answer } from './output';

/**
 * One structured audit record per MCP or outreach call (Juan, 4 Oct 2026: "we will need to make sure all the
 * actions are logged for audits, feedback, improvement, etc."). It extends the existing `mcp.call` row in
 * platform.audit_log — no second log — whether the call came over MCP or the REST wrapper:
 *
 *   actor_id    the token's owner           subject_id  the token
 *   detail      via (mcp | rest), client (the token's name: "juanmail", "Juan's iPad mail desk"), tool, risk,
 *               scopes, outcome (ok, refused, rate_limited, invalid, error), reason, ms, bytes, truncated,
 *               inputHash (SHA-256 of the arguments as sent), args (ids and fixed choices as given, any other
 *               text only as its length), affected (pursuit, ticket, draft, send… ids in the arguments or the
 *               answer), idempotencyKey, correlationId (a client's id for a chain of calls).
 *
 * Refusals are logged like the rest. Nothing is deleted: retention is "keep everything" for now (docs/26 §4).
 */

export interface CallMeta {
  via: 'mcp' | 'rest'; correlationId: string | null; origin?: string | null;
  /** The call says no person is in the loop (`_meta.autonomous: true`, or `X-Autonomous: 1`): it can only add autonomy. */
  autonomous?: boolean;
}

/** A client's autonomy flag: true only for an explicit true (or "1"/"true" in a header). */
export const autonomousOf = (v: unknown): boolean => v === true || v === 'true' || v === '1';

const KEY = /^[\w.:-]{1,100}$/;
export const correlationOf = (v: unknown): string | null => (typeof v === 'string' && KEY.test(v) ? v : null);

/** SHA-256 of the arguments as sent, keys sorted: the same input hashes the same; the input itself is not kept. */
export function inputHash(args: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(sort(args ?? {}))).digest('hex');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDS = ['pursuitId', 'ticketId', 'draftId', 'sendId', 'askId', 'overlapId', 'updateId', 'entityId', 'claimId', 'indicationId', 'touchpointId', 'conflictCaseId', 'connectorId', 'assetId', 'linkId'];

/** The ids a call touched, from its arguments and the top of its answer. */
export function affectedIds(args: Record<string, unknown>, answer: Answer | null): Record<string, string> {
  const out: Record<string, string> = {};
  const data = answer?.data && typeof answer.data === 'object' && !Array.isArray(answer.data) ? answer.data as Record<string, unknown> : {};
  const applied = data.applied && typeof data.applied === 'object' ? data.applied as Record<string, unknown> : {};
  for (const src of [args ?? {}, data, applied]) {
    for (const k of IDS) if (typeof src[k] === 'string' && UUID.test(src[k] as string) && !out[k]) out[k] = src[k] as string;
  }
  return out;
}

export function auditDetail(env: Envelope, a: {
  tool: string; risk: string | null; scopes: readonly string[]; meta: CallMeta; outcome: string; reason: string | null;
  ms: number; bytes: number; truncated: boolean; args: Record<string, unknown>; answer: Answer | null;
}) {
  return {
    via: a.meta.via, client: env.label, tool: a.tool.slice(0, 60), risk: a.risk, scopes: [...a.scopes],
    outcome: a.outcome, reason: a.reason?.slice(0, 300) ?? null, ms: a.ms, bytes: a.bytes, truncated: a.truncated,
    inputHash: inputHash(a.args), args: auditArgs(a.args), affected: affectedIds(a.args, a.answer),
    idempotencyKey: correlationOf(a.args?.idempotencyKey), correlationId: a.meta.correlationId, origin: a.meta.origin ?? null,
    autonomous: env.autonomous || a.meta.autonomous === true,
  };
}

// ── audit_recent: a person's own calls ──────────────────────────────────────────────────

export async function auditRecent(env: Envelope, a: { tool?: string; outcome?: string; correlationId?: string; token?: 'this' | 'any'; limit?: number }): Promise<Answer> {
  const db = await getDb();
  const rows = await db.query<{ id: string; at: Date | string; token: string; detail: Record<string, unknown> }>(`select a.id::text, a.at, a.subject_id::text token, a.detail
    from platform.audit_log a
    where a.action = 'mcp.call' and a.actor_id = $1 and ($2::text is null or a.subject_id = $2::text)
      and ($3::text is null or a.detail->>'tool' = $3) and ($4::text is null or a.detail->>'outcome' = $4)
      and ($5::text is null or a.detail->>'correlationId' = $5)
    order by a.at desc, a.id desc limit $6`,
  [env.owner.id, (a.token ?? 'this') === 'this' ? env.tokenId : null, a.tool ?? null, a.outcome ?? null, a.correlationId ?? null, a.limit ?? 50]);
  return {
    data: rows.map((r) => ({
      callId: r.id, at: new Date(r.at).toISOString(), token: r.token, client: r.detail.client ?? null, via: r.detail.via ?? 'mcp',
      tool: r.detail.tool, outcome: r.detail.outcome, reason: r.detail.reason ?? null, ms: r.detail.ms ?? null,
      affected: r.detail.affected ?? {}, idempotencyKey: r.detail.idempotencyKey ?? null, correlationId: r.detail.correlationId ?? null,
      autonomous: r.detail.autonomous === true,
    })),
    coverage: { corpus: `Your own calls${(a.token ?? 'this') === 'this' ? ' with this token' : ', with any of your tokens'}, from the audit log.`,
      note: 'Arguments are kept as ids and lengths, never words. To report a problem with a call, file_feedback with its callId.' },
  };
}
