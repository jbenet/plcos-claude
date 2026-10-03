import type { Action } from './index';
export const routeRules = {
  'app/api/connection-feedback/route.ts#POST': 'feedback',
  'app/api/connection-feedback/route.ts#GET': 'feedback',
  'app/api/dakota/status/route.ts#GET': 'admin',
  // Email drafts (docs/25). Each handler also checks the draft is the caller's own.
  'app/api/email/attachment/route.ts#POST': 'mutate',
  'app/api/email/attachment/route.ts#GET': 'read',
  'app/api/email/google/start/route.ts#GET': 'read',
  'app/api/email/google/callback/route.ts#GET': 'read',
  'app/api/email/google/fake-consent/route.ts#GET': 'read',
  'app/api/feedback/route.ts#POST': 'feedback',
  'app/api/feedback/route.ts#GET': 'feedback',
  'app/api/feedback/export/route.ts#GET': 'feedback',
  'app/api/identity/entity-type/route.ts#POST': 'admin',
  'app/api/identity/pursuit-merge/route.ts#POST': 'admin',
  'app/api/import-jobs/route.ts#GET': 'admin',
  'app/api/profile/route.ts#GET': 'admin',
  'app/api/session/route.ts#POST': 'session',
  'app/dev/shot/[...path]/route.ts#GET': 'admin',
  'app/issues/shot/[...path]/route.ts#GET': 'admin',
} as const satisfies Record<string, Action>;
export type RouteId = keyof typeof routeRules;
