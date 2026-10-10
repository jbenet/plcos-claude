/**
 * Is a mailguard key drafts-only? Read from its own `GET /api/v1/me` answer, never by trying it
 * (docs/25 §12.2; Juan, 3 Oct 2026: "error when connecting it if it lets you send").
 *
 * Pure and fail-closed: anything this function does not recognise is a refusal. It runs when a key is
 * pasted (a refused key is not stored), at server start, before every move, and daily.
 */

/** Mailguard's capabilities (src/lib/policy/types.ts, read 3 Oct 2026; the calendar's from v0.9, DESIGN §5.8, read 8 Oct 2026). */
export const KNOWN_CAPABILITIES = [
  'read.metadata', 'read.body', 'read.attachments', 'draft', 'send',
  'organize.labels', 'organize.inbox', 'organize.read', 'organize.star', 'organize.spam', 'organize.trash',
  'labels.manage',
  'calendar.freebusy', 'calendar.read', 'calendar.read.details',
  'calendar.write.staged', 'calendar.write', 'calendar.edit', 'calendar.invite', 'calendar.respond',
] as const;
/** What a grant may name besides a capability. */
const WILDCARDS = ['*', 'read.*', 'organize.*', 'calendar.*'];
/** Capabilities that put mail in someone else's inbox. Mailguard has one; a new one would be unknown, so refused. */
export const SENDING = ['send'];
/**
 * Capabilities that email someone through the calendar: an invitation, or an answer to one, which Google mails to
 * the organizer (calendar-requirements.md §5; Juan approved reading calendars only, 8 Oct 2026, issue 0021).
 */
export const NOTIFYING = ['calendar.invite', 'calendar.respond'];
/** What drafting needs, threading a follow-up needs, and reading the calendar needs. Anything else is shown as more than needed. */
export const NEEDED = ['draft', 'read.metadata', 'calendar.freebusy', 'calendar.read', 'calendar.read.details'];

export const CAN_SEND = 'This token can send email. Make a drafts-only token in mailguard.';
export const CAN_NOTIFY = 'This token can email people through the calendar (invitations or answers to them). Take calendar.invite and calendar.respond off its tool in mailguard; reading the calendar needs only calendar.read.';

export type RefusalCode = 'can_send' | 'tool_grants_send' | 'can_notify' | 'unknown_capability' | 'no_draft' | 'expired' | 'malformed';

/**
 * Whether the calendar can be read with this key (mailguard v0.9 `GET /me` → `calendar`): `ok` when mailguard's
 * Google connection includes the calendar and the key holds calendar.read; `details` when it may also read
 * descriptions. `unsupported` is a mailguard without a calendar.
 */
export type CalendarAccess = { state: 'ok'; details: boolean } | { state: 'unsupported' | 'off' | 'reconnect' | 'no_read'; details: false };

export type Verdict =
  | { ok: true; mailbox: string; tool: string; capabilities: string[]; canThread: boolean; extras: string[]; calendar: CalendarAccess }
  | { ok: false; code: RefusalCode; reason: string; mailbox: string | null; tool: string | null; capabilities: string[] };

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

export function draftOnlyVerdict(answer: unknown, now = Date.now()): Verdict {
  const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
  const mailbox = typeof a.mailbox === 'string' && /^[^\s@]+@[^\s@]+$/.test(a.mailbox) ? a.mailbox.toLowerCase() : null;
  const tool = typeof a.tool === 'string' ? a.tool.slice(0, 200) : null;
  const capabilities = isStrings(a.capabilities) ? a.capabilities : [];
  const no = (code: RefusalCode, reason: string): Verdict => ({ ok: false, code, reason, mailbox, tool, capabilities });

  if (!mailbox || tool === null || !isStrings(a.capabilities) || !Array.isArray(a.layers)) {
    return no('malformed', 'Mailguard’s answer about this token was not in the shape expected, so its permissions are unknown. Refused.');
  }
  // Sending first: the clearest reason wins when there are several.
  if (capabilities.some((c) => SENDING.includes(c))) return no('can_send', CAN_SEND);
  if (capabilities.some((c) => NOTIFYING.includes(c)) || a.can_notify_others === true) return no('can_notify', CAN_NOTIFY);
  const unknown = capabilities.filter((c) => !(KNOWN_CAPABILITIES as readonly string[]).includes(c));
  if (unknown.length) return no('unknown_capability', `This token has a permission this tool does not know (${unknown.slice(0, 3).join(', ').slice(0, 80)}), so it might send. Refused; make a drafts-only token in mailguard.`);

  const layers = a.layers as unknown[];
  let toolLayer: Record<string, unknown> | null = null;
  for (const l of layers) {
    const layer = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const policy = (layer.policy && typeof layer.policy === 'object' ? layer.policy : null) as Record<string, unknown> | null;
    if (typeof layer.layer !== 'string' || !policy) return no('malformed', 'Mailguard’s answer about this token had a policy layer that could not be read. Refused.');
    const grant = policy.grant ?? [];
    if (!isStrings(grant)) return no('malformed', 'Mailguard’s answer about this token had a grant that could not be read. Refused.');
    const odd = grant.filter((g) => !WILDCARDS.includes(g) && !(KNOWN_CAPABILITIES as readonly string[]).includes(g));
    if (odd.length) return no('unknown_capability', `A ${layer.layer} policy on this token grants something this tool does not know (${odd.slice(0, 3).join(', ').slice(0, 80)}). Refused; make a drafts-only token in mailguard.`);
    if (layer.layer === 'tool') toolLayer = policy;
  }
  if (!toolLayer) return no('malformed', 'Mailguard’s answer did not include the token’s own policy, so its permissions are unknown. Refused.');
  // The token's own policy must not grant sending: then only another layer stops it, and that layer can be widened.
  const own = toolLayer.grant as string[];
  if (own.includes('send') || own.includes('*')) return no('tool_grants_send', `${CAN_SEND} (Its own policy grants ${own.includes('*') ? 'everything' : 'send'}; only another policy stops it today.)`);
  const notifies = own.filter((g) => g === 'calendar.*' || NOTIFYING.includes(g));
  if (notifies.length) return no('can_notify', `${CAN_NOTIFY} (Its own policy grants ${notifies[0]}; only another policy stops it today.)`);
  const expires = toolLayer.expiresAt;
  if (expires !== undefined && (typeof expires !== 'string' || !(Date.parse(expires) > now))) return no('expired', 'This token’s policy has expired in mailguard. Make a new drafts-only token there.');
  if (!capabilities.includes('draft')) return no('no_draft', 'This token cannot make drafts. Give its tool the draft permission in mailguard (and read.metadata, for follow-ups).');

  return { ok: true, mailbox, tool, capabilities, canThread: capabilities.includes('read.metadata'), extras: capabilities.filter((c) => !NEEDED.includes(c)), calendar: calendarAccess(a.calendar, capabilities) };
}

function calendarAccess(said: unknown, capabilities: string[]): CalendarAccess {
  if (said === 'off' || said === 'reconnect') return { state: said, details: false };
  if (said !== 'ok') return { state: 'unsupported', details: false };
  if (!capabilities.includes('calendar.read') && !capabilities.includes('calendar.read.details')) return { state: 'no_read', details: false };
  return { state: 'ok', details: capabilities.includes('calendar.read.details') };
}

/** The mailbox's domain, for logs and reports: never the address. */
export const domainOf = (mailbox: string | null) => (mailbox?.split('@')[1] ?? 'unknown');

/** What a calendar line says when mailguard's calendar cannot be read (issue 0021), in words. */
export const CALENDAR_NOT_READ: Record<Exclude<CalendarAccess['state'], 'ok'>, string> = {
  unsupported: 'not read: this mailguard has no calendar yet (it arrives in mailguard v0.9).',
  off: 'not read: mailguard’s policy does not include the calendar.',
  reconnect: 'not read yet: choose “Add calendar” in mailguard’s Settings and reconnect Google once.',
  no_read: 'not read: give this tool calendar.read in mailguard to see your meetings next to LPs.',
};
