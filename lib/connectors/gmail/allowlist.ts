/**
 * Everything this tool may ask Google (docs/25-email-drafts.md §Scope and safety).
 *
 * No Gmail scope allows drafts without sending: gmail.compose, the narrowest that can create a
 * draft, also allows users.drafts.send and users.messages.send. So "drafts only" is a property of
 * this code, the way read-only is for Affinity (docs/15): a request that is not on this list — by
 * origin, method, path and every query parameter — is refused before it leaves the machine, and
 * there is no send method in the client to call. Adding an entry is a reviewed change: it appears
 * in a diff, on Developer → Connectors, and in the properties (scripts/properties/email.ts).
 *
 * The paths and scopes are from Google's Gmail API reference (v1), not from memory of another
 * project; eventmax (Juan's earlier project) used the same scope and a two-entry allowlist.
 */

export const GMAIL_ORIGIN = 'https://gmail.googleapis.com';
/** Where the browser is sent to consent. Never fetched by the server. */
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const SCOPES = {
  /** Create, read, update and delete drafts; send messages and drafts. We use only the first part. */
  compose: 'https://www.googleapis.com/auth/gmail.compose',
  /**
   * Headers and labels, never a body or an attachment. Optional: only for replying in a thread
   * (users.threads.get and users.messages.get with format=metadata), which compose cannot read.
   */
  metadata: 'https://www.googleapis.com/auth/gmail.metadata',
} as const;
/** Scopes Google may hand back alongside ours without widening what we can do. */
export const HARMLESS_SCOPES = new Set(['openid', 'email', 'https://www.googleapis.com/auth/userinfo.email']);

export type Method = 'GET' | 'POST' | 'PUT';

export interface Endpoint {
  method: Method;
  template: string;
  /** Google's name for it. */
  name: string;
  purpose: string;
  /** The scope Google requires for it, of ours. */
  scope: keyof typeof SCOPES;
  /** Every query parameter it may carry, with the values allowed. Any other parameter is refused. */
  query?: Record<string, RegExp>;
}

/** The headers a reply needs, and nothing else. */
const THREAD_HEADERS = /^(Message-ID|References|In-Reply-To|Subject)$/;

export const ALLOWED: readonly Endpoint[] = [
  { method: 'GET', template: '/gmail/v1/users/me/profile', name: 'users.getProfile', scope: 'compose', purpose: 'Which address was connected, once, when someone connects.' },
  { method: 'POST', template: '/gmail/v1/users/me/drafts', name: 'users.drafts.create', scope: 'compose', purpose: 'Put a draft in the person’s own Drafts folder.' },
  { method: 'PUT', template: '/gmail/v1/users/me/drafts/{id}', name: 'users.drafts.update', scope: 'compose', purpose: 'Replace a draft this tool put there, after it was edited here.' },
  { method: 'GET', template: '/gmail/v1/users/me/drafts/{id}', name: 'users.drafts.get', scope: 'compose', purpose: 'Whether a draft this tool made is still a draft (not sent or deleted), headers only.', query: { format: /^(minimal|metadata)$/ } },
  { method: 'GET', template: '/gmail/v1/users/me/threads/{id}', name: 'users.threads.get', scope: 'metadata', purpose: 'For a follow-up: the Message-ID and References of the thread’s latest message. Headers only.', query: { format: /^metadata$/, metadataHeaders: THREAD_HEADERS } },
  { method: 'GET', template: '/gmail/v1/users/me/messages/{id}', name: 'users.messages.get', scope: 'metadata', purpose: 'For a reply: one message’s Message-ID, References and Subject. Headers only.', query: { format: /^metadata$/, metadataHeaders: THREAD_HEADERS } },
];

/**
 * What the allowlist exists to refuse, named so the properties try every one. Not exhaustive:
 * anything absent from ALLOWED is refused the same way.
 */
export const MUST_REFUSE: ReadonlyArray<{ method: string; path: string; why: string }> = [
  { method: 'POST', path: '/gmail/v1/users/me/drafts/send', why: 'users.drafts.send' },
  { method: 'POST', path: '/gmail/v1/users/me/messages/send', why: 'users.messages.send' },
  { method: 'POST', path: '/upload/gmail/v1/users/me/messages/send', why: 'users.messages.send, upload form' },
  { method: 'POST', path: '/upload/gmail/v1/users/me/drafts/send', why: 'users.drafts.send, upload form' },
  { method: 'POST', path: '/gmail/v1/users/me/messages', why: 'users.messages.insert' },
  { method: 'POST', path: '/gmail/v1/users/me/messages/import', why: 'users.messages.import' },
  { method: 'DELETE', path: '/gmail/v1/users/me/drafts/r123', why: 'users.drafts.delete' },
  { method: 'GET', path: '/gmail/v1/users/me/messages', why: 'users.messages.list' },
  { method: 'GET', path: '/gmail/v1/users/me/drafts', why: 'users.drafts.list' },
  { method: 'POST', path: '/gmail/v1/users/me/settings/forwardingAddresses', why: 'settings' },
  { method: 'POST', path: '/batch/gmail/v1', why: 'batch requests' },
  { method: 'GET', path: '/gmail/v1/users/someone@example.org/profile', why: 'another mailbox' },
];

/** Gmail ids are short runs of letters, digits, '-' and '_'. A verb in an id's place is not an id. */
const ID = '(?!send$|import$|batch)[A-Za-z0-9_-]{1,64}';

const compiled = ALLOWED.map((e) => ({ endpoint: e, re: new RegExp(`^${e.template.replace(/\{id\}/g, ID)}$`) }));

/** The allowlisted endpoint a request matches, or why it does not. */
export function allowedRequest(method: string, url: URL): { endpoint: Endpoint } | { refused: string } {
  if (url.origin !== GMAIL_ORIGIN) return { refused: `a request to ${url.origin}` };
  if (url.username || url.password || url.hash) return { refused: 'a URL with credentials or a fragment' };
  const m = method.toUpperCase();
  const hit = compiled.find((c) => c.endpoint.method === m && c.re.test(url.pathname));
  if (!hit) return { refused: `${m} ${url.pathname}, which is not on the allowlist` };
  const allowed = hit.endpoint.query ?? {};
  for (const [k, v] of url.searchParams) {
    const re = allowed[k];
    if (!re || !re.test(v)) return { refused: `the query parameter ${k}=${v.slice(0, 40)} on ${hit.endpoint.name}` };
  }
  return { endpoint: hit.endpoint };
}
