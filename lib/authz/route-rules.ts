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
  'app/api/session/route.ts#POST': 'session',
  // Google sign-in and first-run setup (docs/deploy/railway.md §3): nobody is signed in yet. Each handler
  // checks for itself (the signed state cookie, the setup code); a POST must come from this origin.
  'app/auth/google/route.ts#GET': 'public',
  'app/auth/google/callback/route.ts#GET': 'public',
  'app/auth/signout/route.ts#POST': 'public',
  'app/setup/submit/route.ts#POST': 'public',
  'app/dev/shot/[...path]/route.ts#GET': 'admin',
  'app/issues/shot/[...path]/route.ts#GET': 'admin',
} as const satisfies Record<string, Action | 'mcp' | 'outreach' | 'public'>;
export type RouteId = keyof typeof routeRules;
