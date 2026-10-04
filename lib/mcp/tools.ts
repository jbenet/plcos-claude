import { z } from 'zod';
import type { Envelope } from './envelope';
import type { Answer } from './output';
import * as reads from './reads';
import * as writes from './writes';
import { BUCKETS, outreachQueue, outreachVehicles } from '@/lib/outreach/reads';
import { contactInput, recordDeskSend, contacts, requestTicket, sentInput, ticketInput, update, updateInput } from '@/lib/outreach/writes';
import { OUTREACH_READ, OUTREACH_WRITE } from '@/lib/outreach/scopes';
import { auditRecent } from './audit';

/**
 * The MCP tool registry (docs/26-mcp.md): the only tools the server has. Putting a tool name in a
 * prompt does not enable it (AGENTS.md); a name absent here does not exist.
 *
 * The policy is data, one entry per tool (Juan, 4 Oct 2026: "we can evolve the MCP rules, i think we'll
 * end up with more tools wanting to do stuff"). Each tool declares:
 *   risk      read            reads through the authorization layer, never writes;
 *             propose         writes something a person reviews or approves (a draft, a feedback report, a
 *                             ticket opened for approval, an address to confirm), and decides nothing;
 *             write-guarded   changes a record through the app's own service and guards, as the boxes a person
 *                             ticked (the LP page's update box), never a ladder rung, money or a ticket decision;
 *             send-adjacent   records that something already left through an approved channel; sends nothing.
 *   scopes    the token scopes it needs beyond its name ([] = the name in the token's list is enough);
 *   ticket    'none', 'opens' (for a person to approve) or 'requires-approved' (fails closed without one);
 *   approval  whether a person approves or accepts what it does before it counts.
 * The hard rules stay properties over this registry (scripts/properties/mcp.ts): no tool sends mail, decides or
 * approves a ticket (its own or any), or moves money; none is named for those acts; none reaches a service that
 * performs them. Adding a tool: a policy entry here, a property for what it must never do, a line in docs/26 §3
 * and the changelog.
 */
export type Risk = 'read' | 'propose' | 'write-guarded' | 'send-adjacent';
export interface Policy {
  risk: Risk;
  scopes: readonly string[];
  ticket: 'none' | 'opens' | 'requires-approved';
  approval: boolean;
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  policy: Policy;
  description: string;
  input: S;
  run: (env: Envelope, args: z.infer<S>) => Promise<Answer>;
}

const READ: Policy = { risk: 'read', scopes: [], ticket: 'none', approval: false };
const DRAFT: Policy = { risk: 'propose', scopes: [], ticket: 'none', approval: true };
const OUT_READ: Policy = { risk: 'read', scopes: [OUTREACH_READ], ticket: 'none', approval: false };

const uuid = z.string().uuid();
const vehicle = z.string().min(1).max(80).describe('A vehicle\'s slug (as in the app\'s address) or id.');
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).optional().describe(`At most this many rows (default ${dflt}).`);
const offset = z.number().int().min(0).max(100000).optional();
const statuses = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'] as const;

const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

export const TOOLS: readonly Tool[] = [
  tool({
    name: 'search', title: 'Search LPs and people', policy: READ,
    description: 'Find people and organisations by name, with the pursuits on your vehicles (status, owner) and whether a do-not-approach restriction is on file. Use the pursuitId with lp_summary.',
    input: z.object({ query: z.string().min(2).max(100), kind: z.enum(['any', 'person', 'org']).optional(), limit: limit(50, 20) }).strict(),
    run: (env, a) => reads.search(env.principal, a),
  }),
  tool({
    name: 'lp_summary', title: 'LP summary', policy: READ,
    description: 'One LP on one vehicle: status, evidence, contact log dates, the latest strategy, open amounts (hard and soft apart), restrictions and the top warm-intro routes. What your access does not cover is withheld and says so.',
    input: z.object({ pursuitId: uuid, routes: z.boolean().optional().describe('Include the top routes (default true; slower).') }).strict(),
    run: (env, a) => reads.lpSummary(env.principal, a),
  }),
  tool({
    name: 'routes_to', title: 'Routes to a person or organisation', policy: READ,
    description: 'Warm-intro routes from the team and the PL network to a target, for one vehicle, ranked by evidence tier (A–D), with what was inspected.',
    input: z.object({ targetId: uuid, vehicle, limit: limit(20, 10) }).strict(),
    run: (env, a) => reads.routesTo(env.principal, a),
  }),
  tool({
    name: 'routes_through', title: 'Routes through a node', policy: READ,
    description: 'Whom a person or organisation could introduce us to, our best route to them, and which LPs are reachable only through them. Needs access to every vehicle.',
    input: z.object({ nodeId: uuid, vehicle: vehicle.optional(), limit: limit(50, 20) }).strict(),
    run: (env, a) => reads.routesThrough(env.principal, a),
  }),
  tool({
    name: 'pipeline', title: 'Pipeline by vehicle', policy: READ,
    description: 'A vehicle\'s LPs by status, with counts for every status, owner, next step, last touch and evidence. Page with offset.',
    input: z.object({ vehicle, status: z.enum(statuses).optional(), limit: limit(100, 50), offset }).strict(),
    run: (env, a) => reads.pipeline(env.principal, a),
  }),
  tool({
    name: 'target_lists', title: 'Target lists', policy: READ,
    description: 'A vehicle\'s open LPs on one of the strategy lists: this year\'s close, the 2027 pipeline, not now, or none yet; highest priority first.',
    input: z.object({ vehicle, list: z.enum(['this year', '2027', 'not now', 'none']).optional(), limit: limit(100, 50), offset }).strict(),
    run: (env, a) => reads.targetLists(env.principal, a),
  }),
  tool({
    name: 'replies_owed', title: 'Replies owed', policy: READ,
    description: 'LPs who spoke last with nothing from us since (we owe them), and LPs at Connecting with nothing from them yet (waiting on them).',
    input: z.object({ vehicle: vehicle.optional(), withinDays: z.number().int().min(1).max(365).optional(), limit: limit(100, 50) }).strict(),
    run: (env, a) => reads.repliesOwed(env.principal, a),
  }),
  tool({
    name: 'feedback_issues', title: 'Feedback issues', policy: READ,
    description: 'Issues filed from the feedback box: the open ones by default, or one issue in full by id.',
    input: z.object({ id: z.string().regex(/^\d{4}$/).optional(), status: z.enum(['open', 'done', 'all']).optional(), limit: limit(200, 50) }).strict(),
    run: (env, a) => reads.feedbackIssues(env.principal, a),
  }),
  tool({
    name: 'changelog', title: 'Changelog', policy: READ,
    description: 'What changed in Capital OS: the latest entries, or one entry\'s text by slug.',
    input: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(), limit: limit(100, 20) }).strict(),
    run: (env, a) => reads.changelog(env.principal, a),
  }),
  // The mail desk's reads (docs/27-outreach-api.md), the same service as GET /api/outreach/*.
  tool({
    name: 'outreach_vehicles', title: 'Outreach: vehicles', policy: OUT_READ,
    description: 'The fund and SPV vehicles raising now: hard, soft and indicated (three separate figures, never added), the raise window and working days left, SPV seats by stage and days to wire.',
    input: z.object({}).strict(),
    run: async (env) => outreachVehicles(env.principal),
  }),
  tool({
    name: 'outreach_queue', title: 'Outreach: the queue', policy: OUT_READ,
    description: 'The mail desk\'s queue for a vehicle (or "all"): each open LP with Capital OS\'s own status, close track and SPV seat stage (each with its label), the indication, contacts, the latest strategy, checks (restriction, accreditation, ask count, fund first, wrap; each says whether it blocks), materials and a bucket. Health details are redacted. Page with offset.',
    input: z.object({
      vehicle, bucket: z.enum(BUCKETS as [string, ...string[]]).optional(), limit: limit(300, 25), offset, pursuitId: uuid.optional(),
      updatedSince: z.string().datetime({ offset: true }).optional().describe('Only rows changed since this time: pass the previous answer\'s cursor to poll for changes.'),
    }).strict(),
    run: async (env, a) => outreachQueue(env.principal, { ...a, limit: a.limit ?? 25 } as never),
  }),
  // The mail desk's writes (docs/27). Each runs the app's own service as the token's owner; none sends or approves.
  tool({
    name: 'outreach_update', title: 'Outreach: record an update', policy: { risk: 'write-guarded', scopes: [OUTREACH_WRITE], ticket: 'none', approval: false },
    description: 'The LP page\'s update box, exactly: the words, and only the boxes the person ticked — a status, the touchpoint it describes, a next step, an indicated amount (never soft money). Once per idempotencyKey. A ladder rung is never recorded; a logged meeting may propose one for approval.',
    input: updateInput,
    run: (env, a) => update({ env }, a),
  }),
  tool({
    name: 'outreach_request_ticket', title: 'Outreach: ask for an approval', policy: { risk: 'propose', scopes: [OUTREACH_WRITE], ticket: 'opens', approval: true },
    description: 'Open a SEND (one email to named recipients) or INTRO_ASK ticket for a person to approve in Capital OS. Never approves it. A blocking check refuses before any ticket; an SPV with an open fund discussion needs coordination.choice.',
    input: ticketInput,
    run: (env, a) => requestTicket({ env }, a),
  }),
  tool({
    name: 'outreach_propose_contact', title: 'Outreach: an address confirmed in Gmail', policy: { risk: 'propose', scopes: [OUTREACH_WRITE], ticket: 'none', approval: true },
    description: 'Record an email address the person confirmed from their Gmail, with its source and date. Another source\'s address (Affinity, research) is kept, never overwritten; the answer says what was kept.',
    input: contactInput,
    run: (env, a) => contacts({ env }, a),
  }),
  tool({
    name: 'outreach_record_send', title: 'Outreach: record a send', policy: { risk: 'send-adjacent', scopes: [OUTREACH_WRITE], ticket: 'requires-approved', approval: true },
    description: 'Record that the mail desk sent the email an approved SEND ticket covers: once, with the Gmail message id and time. Refused unless the ticket is approved, unexpired, for this LP and these recipients, and unused. Sends nothing.',
    input: sentInput,
    run: (env, a) => recordDeskSend({ env }, a),
  }),
  // Your own calls (docs/26 §4): what this person's tokens did, for a client's own history.
  tool({
    name: 'audit_recent', title: 'Your recent calls', policy: READ,
    description: 'Your own recent MCP and outreach calls, newest first: tool, outcome, reason, time, the ids affected, the idempotency and correlation ids. Filter by tool, outcome or correlationId. Only your own.',
    input: z.object({
      tool: z.string().max(60).optional(), outcome: z.enum(['ok', 'refused', 'rate_limited', 'invalid', 'error']).optional(),
      correlationId: z.string().max(100).optional(), token: z.enum(['this', 'any']).optional().describe('Only this token\'s calls (default), or any of yours.'),
      limit: limit(200, 50),
    }).strict(),
    run: (env, a) => auditRecent(env, a),
  }),
  tool({
    name: 'create_email_draft', title: 'Create an email draft', policy: DRAFT,
    description: 'Write a draft email to an LP (first_message) or to a connector asking for an introduction (intro_ask). It is saved in Capital OS for its owner to review; it is not moved to Gmail and not sent. Draft-time checks (restrictions, wrap, grants, intro tickets) come back as warnings.',
    input: z.object({
      purpose: z.enum(['first_message', 'intro_ask']),
      pursuitId: uuid.optional(), vehicle: vehicle.optional(), entityId: uuid.optional(), connectorId: uuid.optional(),
      subject: z.string().max(300).optional(), body: z.string().max(20000).optional().describe('Plain text; blank lines separate paragraphs.'),
      to: z.string().max(1000).optional(),
    }).strict(),
    run: (env, a) => writes.createEmailDraft(env, a),
  }),
  tool({
    name: 'file_feedback', title: 'File feedback', policy: DRAFT,
    description: 'File an issue, as the feedback box does: a bug, request, question or chore, with a priority. It lands on Developer → Issues for a person to triage.',
    input: z.object({
      title: z.string().min(3).max(200), body: z.string().max(20000).optional(),
      kind: z.enum(['bug', 'request', 'question', 'chore']).optional(), priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      page: z.string().max(300).regex(/^\//).optional().describe('The app page it is about, e.g. /plc-neurotech/pipeline.'),
      callId: z.string().regex(/^\d{1,18}$/).optional().describe('A logged call this is about (an id from audit_recent): kept in the issue\'s context.'),
    }).strict(),
    run: (env, a) => writes.fileFeedback(env, a),
  }),
];

/** A tool is allowed when the token lists its name, or carries every scope it needs. */
export function allowed(env: Pick<Envelope, 'tools'>, t: Tool): boolean {
  return t.policy.scopes.length ? t.policy.scopes.every((s) => env.tools.has(s)) : env.tools.has(t.name);
}

/** The presets' names: the unscoped tools. A scoped tool comes with its scope, never by name. */
export const TOOL_NAMES = TOOLS.filter((t) => !t.policy.scopes.length).map((t) => t.name);
export const READ_TOOLS = TOOLS.filter((t) => !t.policy.scopes.length && t.policy.risk === 'read').map((t) => t.name);
export const findTool = (name: string) => TOOLS.find((t) => t.name === name) ?? null;

/** JSON Schema for tools/list, from the same schema the call is checked against. */
export function listing(env: Envelope) {
  return TOOLS.filter((t) => allowed(env, t)).map((t) => {
    const { $schema: _drop, ...inputSchema } = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    return {
      name: t.name, title: t.title, description: t.description, inputSchema,
      annotations: { title: t.title, readOnlyHint: t.policy.risk === 'read', destructiveHint: false, idempotentHint: t.policy.risk === 'read', openWorldHint: false },
      _meta: { policy: t.policy },
    };
  });
}
