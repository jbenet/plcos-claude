import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import type { AppUser, McpToken } from '@/modules/platform';

/**
 * The work envelope of an MCP token (AGENTS.md, Agent rules; docs/26-mcp.md §Safety). The token's
 * row holds it: which tools, which vehicles, how many calls a day, until when. Every call is checked
 * against it before the tool runs, and refused with the reason when it falls outside.
 *
 *   task                 "MCP client acting for <owner>"; the client's own task is not ours to know
 *   scope                the owner's vehicles, narrowed by the token's (never widened)
 *   allowed_evidence     what the owner may read, through lib/authz — nothing more
 *   allowed_commands     the token's tools, each one registered in lib/mcp/tools.ts
 *   budget               calls a minute (config) and a day (the token)
 *   deadline             the token's expiry
 *   output_schema        each tool's answer, marked as data
 *   acceptance_criteria  none: tools only read or draft; a person accepts in the app
 *   escalation_owner     the token's owner
 *
 * Autonomy (Juan, 5 Oct 2026; modules/governance/autonomy.ts). A token acts for its owner interactively — a
 * person clicked — unless it, or the call, is flagged autonomous: the token carries AUTONOMOUS_MARK in its
 * list, or the call says `_meta.autonomous: true` (MCP) or `X-Autonomous: 1` (REST). A call can only add
 * the flag, never take it off a token that carries it. Only an autonomous call needs a SEND or INTRO_ASK
 * ticket; without an approved one it is refused.
 */
export const AUTONOMOUS_MARK = 'mode:autonomous';

export interface Envelope {
  tokenId: string;
  /** The token's name: the client behind it ("juanmail", "Juan's iPad mail desk"), as its owner named it. */
  label: string;
  owner: AppUser;
  /** The principal every check uses: the owner, narrowed to the token's vehicles. */
  principal: AppUser;
  tools: ReadonlySet<string>;
  callsPerDay: number;
  expiresAt: Date;
  /** No person in the loop for this call: the token is marked autonomous, or the call says so. */
  autonomous: boolean;
  /** How this call arrived (set by runTool): an MCP answer must fit the response limit, a REST one need not. */
  via?: 'mcp' | 'rest';
}

/**
 * The owner narrowed by the token. A token never widens: its vehicles intersect the owner's and it
 * can approve nothing. And it never acts as an Admin: an Admin's token is a Team member on all of the
 * owner's vehicles (or the token's). Two reasons. The licensed Dakota values (R3) are Admin-only, and
 * Dakota data never goes into a prompt to any agent (docs/agent-rules/real-data.md), which is where
 * every MCP answer goes. And the policy lets an Admin through before it looks at vehicles
 * (lib/authz/index.ts), so an Admin token limited to some vehicles would not be limited.
 */
export function narrowedPrincipal(owner: AppUser, vehicles: string[] | null): AppUser {
  const access = owner.access === 'admin' ? 'team' : owner.access;
  if (vehicles === null) return { ...owner, access, approves: [] };
  const allowed = owner.vehicles === null ? vehicles : vehicles.filter((v) => owner.vehicles!.includes(v));
  return { ...owner, access, vehicles: [...new Set(allowed)], approves: [] };
}

export function envelopeFor(token: McpToken, owner: AppUser): Envelope {
  return {
    tokenId: token.tokenId, label: token.label, owner, principal: narrowedPrincipal(owner, token.vehicles),
    tools: new Set(token.tools), callsPerDay: token.callsPerDay, expiresAt: new Date(token.expiresAt),
    autonomous: token.tools.includes(AUTONOMOUS_MARK),
  };
}

// ── Rate ─────────────────────────────────────────────────────────────────────────────
// No call limits (Juan, 8 Oct 2026: "remove token limits for PLCOS -- re-implement them only after we find a need for
// them"). A token is checked for its tools and its expiry; config.mcp.callsPerMinute and a token's calls_per_day are
// kept, unused, for when a limit is wanted again. Every call is still audited.

export async function admitCall(env: Envelope, tool: string, _q: Queryable, now = Date.now(), permitted = env.tools.has(tool)): Promise<string | null> {
  if (!permitted) return `"${tool}" is not in this token's envelope. Allowed: ${[...env.tools].sort().join(', ') || 'nothing'}.`;
  if (env.expiresAt.getTime() <= now) return 'This token has expired. Make a new one in Preferences.';
  return null;
}

/** For the properties: forget the in-memory windows. */
export function resetWindows() { /* no windows: calls are not limited */ }

// ── What the audit entry keeps ──────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Arguments that are a fixed choice (a vehicle's slug, a status), never typed words. */
const CHOICES = new Set(['vehicle', 'status', 'kind', 'purpose', 'priority', 'list', 'mode', 'bucket', 'choice', 'direction']);
/** Ids, choices, numbers and booleans as given; any other text only as its length, so words never reach the log. */
export function auditArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {}).slice(0, 20)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = UUID.test(v) || (CHOICES.has(k) && /^[a-z0-9 _-]{1,40}$/i.test(v)) ? v : { chars: v.length };
    // A short list of ids (pursuitIds, ticketIds) is ids as given; any other list only its type.
    else if (Array.isArray(v) && v.length && v.length <= 10 && v.every((x) => typeof x === 'string' && UUID.test(x))) out[k] = v;
    else if (v != null) out[k] = { type: Array.isArray(v) ? 'array' : typeof v };
  }
  return out;
}
