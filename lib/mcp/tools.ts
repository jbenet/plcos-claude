import { z } from 'zod';
import type { Envelope } from './envelope';
import type { Answer } from './output';
import * as reads from './reads';
import * as writes from './writes';

/**
 * The MCP tool registry (docs/26-mcp.md): the only tools the server has. Putting a tool name in a
 * prompt does not enable it (AGENTS.md); a name absent here does not exist, and a token can call only
 * the names its envelope lists. Two kinds and no third:
 *   read   reads through the authorization layer, never writes;
 *   draft  writes a draft or a feedback report, which a person reviews; never sends or accepts.
 * Sending, approving or accepting, status changes behind a ticket (rule 3), money and allocation,
 * imports and connector runs are not here at all. A property enumerates this registry and fails
 * when a tool of another kind, or with such a name, appears.
 */
export type ToolKind = 'read' | 'draft';

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  kind: ToolKind;
  description: string;
  input: S;
  run: (env: Envelope, args: z.infer<S>) => Promise<Answer>;
}

const uuid = z.string().uuid();
const vehicle = z.string().min(1).max(80).describe('A vehicle\'s slug (as in the app\'s address) or id.');
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).optional().describe(`At most this many rows (default ${dflt}).`);
const offset = z.number().int().min(0).max(100000).optional();
const statuses = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'] as const;

const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

export const TOOLS: readonly Tool[] = [
  tool({
    name: 'search', title: 'Search LPs and people', kind: 'read',
    description: 'Find people and organisations by name, with the pursuits on your vehicles (status, owner) and whether a do-not-approach restriction is on file. Use the pursuitId with lp_summary.',
    input: z.object({ query: z.string().min(2).max(100), kind: z.enum(['any', 'person', 'org']).optional(), limit: limit(50, 20) }).strict(),
    run: (env, a) => reads.search(env.principal, a),
  }),
  tool({
    name: 'lp_summary', title: 'LP summary', kind: 'read',
    description: 'One LP on one vehicle: status, evidence, contact log dates, the latest strategy, open amounts (hard and soft apart), restrictions and the top warm-intro routes. What your access does not cover is withheld and says so.',
    input: z.object({ pursuitId: uuid, routes: z.boolean().optional().describe('Include the top routes (default true; slower).') }).strict(),
    run: (env, a) => reads.lpSummary(env.principal, a),
  }),
  tool({
    name: 'routes_to', title: 'Routes to a person or organisation', kind: 'read',
    description: 'Warm-intro routes from the team and the PL network to a target, for one vehicle, ranked by evidence tier (A–D), with what was inspected.',
    input: z.object({ targetId: uuid, vehicle, limit: limit(20, 10) }).strict(),
    run: (env, a) => reads.routesTo(env.principal, a),
  }),
  tool({
    name: 'routes_through', title: 'Routes through a node', kind: 'read',
    description: 'Whom a person or organisation could introduce us to, our best route to them, and which LPs are reachable only through them. Needs access to every vehicle.',
    input: z.object({ nodeId: uuid, vehicle: vehicle.optional(), limit: limit(50, 20) }).strict(),
    run: (env, a) => reads.routesThrough(env.principal, a),
  }),
  tool({
    name: 'pipeline', title: 'Pipeline by vehicle', kind: 'read',
    description: 'A vehicle\'s LPs by status, with counts for every status, owner, next step, last touch and evidence. Page with offset.',
    input: z.object({ vehicle, status: z.enum(statuses).optional(), limit: limit(100, 50), offset }).strict(),
    run: (env, a) => reads.pipeline(env.principal, a),
  }),
  tool({
    name: 'target_lists', title: 'Target lists', kind: 'read',
    description: 'A vehicle\'s open LPs on one of the strategy lists: this year\'s close, the 2027 pipeline, not now, or none yet; highest priority first.',
    input: z.object({ vehicle, list: z.enum(['this year', '2027', 'not now', 'none']).optional(), limit: limit(100, 50), offset }).strict(),
    run: (env, a) => reads.targetLists(env.principal, a),
  }),
  tool({
    name: 'replies_owed', title: 'Replies owed', kind: 'read',
    description: 'LPs who spoke last with nothing from us since (we owe them), and LPs at Connecting with nothing from them yet (waiting on them).',
    input: z.object({ vehicle: vehicle.optional(), withinDays: z.number().int().min(1).max(365).optional(), limit: limit(100, 50) }).strict(),
    run: (env, a) => reads.repliesOwed(env.principal, a),
  }),
  tool({
    name: 'feedback_issues', title: 'Feedback issues', kind: 'read',
    description: 'Issues filed from the feedback box: the open ones by default, or one issue in full by id.',
    input: z.object({ id: z.string().regex(/^\d{4}$/).optional(), status: z.enum(['open', 'done', 'all']).optional(), limit: limit(200, 50) }).strict(),
    run: (env, a) => reads.feedbackIssues(env.principal, a),
  }),
  tool({
    name: 'changelog', title: 'Changelog', kind: 'read',
    description: 'What changed in Capital OS: the latest entries, or one entry\'s text by slug.',
    input: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(), limit: limit(100, 20) }).strict(),
    run: (env, a) => reads.changelog(env.principal, a),
  }),
  tool({
    name: 'create_email_draft', title: 'Create an email draft', kind: 'draft',
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
    name: 'file_feedback', title: 'File feedback', kind: 'draft',
    description: 'File an issue, as the feedback box does: a bug, request, question or chore, with a priority. It lands on Developer → Issues for a person to triage.',
    input: z.object({
      title: z.string().min(3).max(200), body: z.string().max(20000).optional(),
      kind: z.enum(['bug', 'request', 'question', 'chore']).optional(), priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      page: z.string().max(300).regex(/^\//).optional().describe('The app page it is about, e.g. /plc-neurotech/pipeline.'),
    }).strict(),
    run: (env, a) => writes.fileFeedback(env, a),
  }),
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const READ_TOOLS = TOOLS.filter((t) => t.kind === 'read').map((t) => t.name);
export const findTool = (name: string) => TOOLS.find((t) => t.name === name) ?? null;

/** JSON Schema for tools/list, from the same schema the call is checked against. */
export function listing(env: Envelope) {
  return TOOLS.filter((t) => env.tools.has(t.name)).map((t) => {
    const { $schema: _drop, ...inputSchema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return {
      name: t.name, title: t.title, description: t.description, inputSchema,
      annotations: { title: t.title, readOnlyHint: t.kind === 'read', destructiveHint: false, idempotentHint: t.kind === 'read', openWorldHint: false },
    };
  });
}
