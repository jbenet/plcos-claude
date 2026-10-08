/**
 * Everything this tool may ask mailguard (docs/25-email-drafts.md §12).
 *
 * Mailguard refuses a send for a key whose policy lacks `send`, and we only accept keys that lack it
 * (scope.ts). This list is the second wall: a request that is not on it — by origin, method, path and
 * every query parameter — is refused before it leaves the machine, and the client has no send method
 * to call. Adding an entry is a reviewed change: it shows in a diff and fails the properties
 * (scripts/properties/email.ts) unless they change too.
 *
 * The routes are from mailguard's src/lib/rest.ts (read 3 Oct 2026), not from memory; the calendar's from its
 * v0.9 DESIGN §6.1 (read 8 Oct 2026). The calendar is read only: no event is made, changed or answered here
 * (Juan, 8 Oct 2026, issue 0021).
 */

export type Method = 'GET' | 'POST' | 'PUT';

export interface Endpoint {
  method: Method;
  template: string;
  /** Mailguard's name for the action. */
  name: string;
  purpose: string;
  /** Every query parameter it may carry, with the values allowed. Any other parameter is refused. */
  query?: Record<string, RegExp>;
  /** The query parameters it must carry. Without this, every one in `query`. */
  required?: string[];
}

/** An RFC 3339 time, as Google takes timeMin and timeMax. */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export const ALLOWED: readonly Endpoint[] = [
  { method: 'GET', template: '/api/v1/me', name: 'whoami', purpose: 'Which mailbox the key acts on and what it may do — read, never used. Checked before every move.' },
  { method: 'POST', template: '/api/v1/drafts', name: 'drafts.create', purpose: 'Put a draft in the person’s own Gmail Drafts.' },
  { method: 'PUT', template: '/api/v1/drafts/{id}', name: 'drafts.update', purpose: 'Replace a draft this key made, after it was edited here. 404 when it was sent or deleted.' },
  { method: 'GET', template: '/api/v1/threads/{id}', name: 'threads.get', purpose: 'For a follow-up: the ids of the thread’s messages, to reply to the latest. Headers only.', query: { format: /^metadata$/ } },
  { method: 'GET', template: '/api/v1/calendars', name: 'calendar.calendars', purpose: 'The calendars the person can see: their own, and the shared and team ones.' },
  { method: 'GET', template: '/api/v1/calendars/{cal}/events', name: 'calendar.events.list', purpose: 'One calendar’s meetings in a time range, to put them next to LPs. Read only; never a search.',
    query: { timeMin: TIME, timeMax: TIME, pageToken: /^[A-Za-z0-9_=-]{1,1024}$/, max: /^(250|2[0-4]\d|1\d\d|[1-9]\d?)$/ }, required: ['timeMin', 'timeMax'] },
];

/**
 * What the allowlist exists to refuse, named so the properties try every one. Not exhaustive: anything
 * absent from ALLOWED is refused the same way.
 */
export const MUST_REFUSE: ReadonlyArray<{ method: string; path: string; why: string }> = [
  { method: 'POST', path: '/api/v1/messages/send', why: 'messages.send' },
  { method: 'POST', path: '/api/v1/drafts/r123/send', why: 'drafts.send' },
  { method: 'POST', path: '/api/v1/drafts/send', why: 'a send in an id’s place' },
  { method: 'PUT', path: '/api/v1/drafts/send', why: 'a send in an id’s place, as an update' },
  { method: 'DELETE', path: '/api/v1/drafts/r123', why: 'drafts.delete' },
  { method: 'GET', path: '/api/v1/drafts', why: 'drafts.list' },
  { method: 'GET', path: '/api/v1/messages', why: 'messages.list' },
  { method: 'GET', path: '/api/v1/messages/m123', why: 'messages.get (bodies)' },
  { method: 'GET', path: '/api/v1/messages/m123/attachments/a1', why: 'attachments.get' },
  { method: 'POST', path: '/api/v1/messages/m123/trash', why: 'messages.trash' },
  { method: 'POST', path: '/api/v1/messages/m123/modify', why: 'messages.modify' },
  { method: 'POST', path: '/api/v1/labels', why: 'labels.create' },
  { method: 'POST', path: '/mcp', why: 'the MCP surface' },
  { method: 'GET', path: '/api/v1/threads/t123', why: 'threads.get with bodies (no format=metadata)' },
  { method: 'POST', path: '/api/v1/calendars/primary/events', why: 'calendar.events.create' },
  { method: 'PATCH', path: '/api/v1/calendars/primary/events/e123', why: 'calendar.events.update' },
  { method: 'DELETE', path: '/api/v1/calendars/primary/events/e123', why: 'calendar.events.delete' },
  { method: 'POST', path: '/api/v1/calendars/primary/events/e123/respond', why: 'calendar.events.respond (emails the organizer)' },
  { method: 'GET', path: '/api/v1/calendars/primary/events/e123/respond', why: 'an answer, by GET' },
  { method: 'POST', path: '/api/v1/calendars/primary/events/respond', why: 'an answer in a calendar’s place' },
  { method: 'GET', path: '/api/v1/calendars/primary/events?timeMin=2026-01-01T00:00:00Z&timeMax=2026-02-01T00:00:00Z&q=x', why: 'an event search (descriptions)' },
  { method: 'GET', path: '/api/v1/calendars/primary/events', why: 'events with no time range' },
  { method: 'GET', path: '/api/v1/calendars/a%2Fb/events?timeMin=2026-01-01T00:00:00Z&timeMax=2026-02-01T00:00:00Z', why: 'a slash hidden in a calendar id' },
  { method: 'POST', path: '/api/v1/outbox', why: 'a held send or calendar change' },
];

/** Gmail ids are runs of letters, digits, '-' and '_'. A verb in an id's place is not an id. */
const ID = '(?!send$)[A-Za-z0-9_-]{1,256}';

/** Google calendar ids, as a path segment: 'primary', or an address like team@group.calendar.google.com, percent-encoded. Never an encoded slash. */
const CAL = '(?!events$|respond$)(?!.*%2[Ff])[A-Za-z0-9._@%+-]{1,512}';

const compiled = ALLOWED.map((e) => ({ endpoint: e, re: new RegExp(`^${e.template.replace(/\{id\}/g, ID).replace(/\{cal\}/g, CAL)}$`) }));

/** Is this a host we may talk to over plain http? Only this machine. */
export const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);

/** The allowlisted endpoint a request matches, or why it does not. `base` is mailguard's origin. */
export function allowedRequest(method: string, url: URL, base: URL): { endpoint: Endpoint } | { refused: string } {
  if (url.origin !== base.origin) return { refused: `a request to ${url.origin}, not mailguard` };
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) return { refused: 'plain http to a host other than this machine' };
  if (url.username || url.password || url.hash) return { refused: 'a URL with credentials or a fragment' };
  const m = method.toUpperCase();
  const hit = compiled.find((c) => c.endpoint.method === m && c.re.test(url.pathname));
  if (!hit) return { refused: `${m} ${url.pathname}, which is not on the allowlist` };
  const allowed = hit.endpoint.query ?? {};
  for (const [k, v] of url.searchParams) {
    const re = allowed[k];
    if (!re || !re.test(v)) return { refused: `the query parameter ${k}=${v.slice(0, 40)} on ${hit.endpoint.name}` };
  }
  for (const k of hit.endpoint.required ?? Object.keys(allowed)) if (!url.searchParams.has(k)) return { refused: `${hit.endpoint.name} without ${k}` };
  if (url.searchParams.getAll('timeMin').length > 1 || url.searchParams.getAll('timeMax').length > 1) return { refused: `${hit.endpoint.name} with a range given twice` };
  return { endpoint: hit.endpoint };
}

/** A mailguard key: `mg_` + the tool's 12-character id + `_` + 40 characters (mailguard src/lib/store.ts). */
export const KEY_FORMAT = /^mg_[0-9A-Za-z]{12}_[0-9A-Za-z]{40}$/;

/** Mailguard's address from config or the environment: an origin, https unless it is this machine. */
export function parseBase(raw: string | null | undefined): URL | { why: string } {
  const s = (raw ?? '').trim();
  if (!s) return { why: 'No mailguard address is set: npm run secret:store -- mailguard-url, or config.email.mailguard.url (docs/25 §12.5).' };
  let u: URL;
  try { u = new URL(s); } catch { return { why: 'The mailguard address is not a URL.' }; }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return { why: 'The mailguard address must be just its origin, like https://mail.example.com.' };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) return { why: 'The mailguard address must be https (plain http only to this machine).' };
  return new URL(u.origin);
}
