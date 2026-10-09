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
  // The feedback signal's read link (lib/feedback-signal): its own signature, not the cookie.
  'app/api/feedback/signal/route.ts#GET': 'feedback',
  'app/api/identity/entity-type/route.ts#POST': 'admin',
  'app/api/identity/pursuit-merge/route.ts#POST': 'admin',
  'app/api/import-jobs/route.ts#GET': 'admin',
  // MCP (docs/26-mcp.md): a bearer token, not the cookie; each tool call is then authorized as its owner.
  'app/api/mcp/route.ts#POST': 'mcp',
  // The mail desk's outreach API (docs/27): the same bearer token with the outreach scope; each op is then
  // authorized as the token's owner, through the UI's own rules. OPTIONS answers CORS preflight only.
  'app/api/outreach/[op]/route.ts#GET': 'outreach',
  'app/api/outreach/[op]/route.ts#POST': 'outreach',
  'app/api/outreach/[op]/route.ts#DELETE': 'outreach',
  'app/api/outreach/[op]/route.ts#OPTIONS': 'outreach',
  'app/api/profile/route.ts#GET': 'admin',
  // Cloud pull and push (docs/deploy/railway.md §6–§7): a bearer token of the endpoint's own scope, not the cookie.
  'app/api/sync/push/route.ts#POST': 'sync:push',
  // The state of an import a push queued, to the person who pushed it (lib/sync/push.ts, pushStatus).
  'app/api/sync/push/route.ts#GET': 'sync:push',
  'app/api/sync/snapshot/route.ts#GET': 'sync:snapshot',
  // The workflow ledger in the cloud (lib/sync/runs.ts): a Mac run's begin and finish, with a push token.
  'app/api/sync/runs/route.ts#POST': 'sync:push',
  // A vehicle added by an Admin's token (lib/sync/vehicles.ts), the Settings → Vehicles form's own checks.
  'app/api/sync/vehicles/route.ts#POST': 'sync:admin',
  // An Admin's token moves a vehicle's raise window (setRaiseWindow); nothing else about a vehicle changes.
  'app/api/sync/vehicles/route.ts#PATCH': 'sync:admin',
  // An Admin's token queues a research export or a findings import and reads any job's state (lib/sync/jobs.ts).
  'app/api/sync/jobs/route.ts#POST': 'sync:admin',
  'app/api/sync/jobs/route.ts#GET': 'sync:admin',
  // An Admin's token reads the feedback queue and sets an issue's status (lib/sync/feedback.ts).
  'app/api/sync/feedback/route.ts#GET': 'sync:admin',
  'app/api/sync/feedback/route.ts#POST': 'sync:admin',
  // A record's local type by an Admin's token (lib/sync/entity-type.ts, issue 0063).
  'app/api/sync/entity-type/route.ts#GET': 'sync:admin',
  'app/api/sync/entity-type/route.ts#POST': 'sync:admin',
  'app/api/session/route.ts#POST': 'session',
  // Google sign-in and first-run setup (docs/deploy/railway.md §3): nobody is signed in yet. Each handler
  // checks for itself (the signed state cookie, the setup code); a POST must come from this origin.
  'app/auth/google/route.ts#GET': 'public',
  'app/auth/google/callback/route.ts#GET': 'public',
  'app/auth/signout/route.ts#POST': 'public',
  'app/setup/submit/route.ts#POST': 'public',
  'app/dev/shot/[...path]/route.ts#GET': 'admin',
  'app/issues/shot/[...path]/route.ts#GET': 'admin',
} as const satisfies Record<string, Action | 'mcp' | 'outreach' | 'sync:snapshot' | 'sync:push' | 'sync:admin' | 'public'>;
export type RouteId = keyof typeof routeRules;
