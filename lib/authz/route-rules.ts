import type { Action } from './index';
export const routeRules = {
  'app/api/connection-feedback/route.ts#POST': 'feedback',
  'app/api/connection-feedback/route.ts#GET': 'feedback',
  'app/api/dakota/status/route.ts#GET': 'admin',
  // Email drafts (docs/25). Each handler also checks the draft is the caller's own.
  'app/api/email/attachment/route.ts#POST': 'mutate',
  'app/api/email/attachment/route.ts#GET': 'read',
  'app/api/feedback/route.ts#POST': 'feedback',
  'app/api/feedback/route.ts#GET': 'feedback',
  'app/api/feedback/export/route.ts#GET': 'feedback',
  'app/api/identity/entity-type/route.ts#POST': 'admin',
  'app/api/identity/pursuit-merge/route.ts#POST': 'admin',
  'app/api/import-jobs/route.ts#GET': 'admin',
  // MCP (docs/26-mcp.md): a bearer token, not the cookie; each tool call is then authorized as its owner.
  'app/api/mcp/route.ts#POST': 'mcp',
  // The mail desk's outreach API (docs/27): the same bearer token with the outreach scope; each op is then
  // authorized as the token's owner, through the UI's own rules. OPTIONS answers CORS preflight only.
  'app/api/outreach/[op]/route.ts#GET': 'outreach',
  'app/api/outreach/[op]/route.ts#POST': 'outreach',
  'app/api/outreach/[op]/route.ts#OPTIONS': 'outreach',
  'app/api/profile/route.ts#GET': 'admin',
  // Cloud pull and push (docs/deploy/railway.md §6–§7): a bearer token of the endpoint's own scope, not the cookie.
  'app/api/sync/push/route.ts#POST': 'sync:push',
  'app/api/sync/snapshot/route.ts#GET': 'sync:snapshot',
  'app/api/session/route.ts#POST': 'session',
  'app/dev/shot/[...path]/route.ts#GET': 'admin',
  'app/issues/shot/[...path]/route.ts#GET': 'admin',
} as const satisfies Record<string, Action | 'mcp' | 'outreach' | 'sync:snapshot' | 'sync:push'>;
export type RouteId = keyof typeof routeRules;
