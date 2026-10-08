/**
 * Fetching a private calendar address (issue 0021; Juan, 8 Oct 2026: "1 - yes" to reading calendars, read
 * only). One GET of an .ics file; nothing is ever sent to a calendar. Only `lib/connectors/ics/` fetches one.
 *
 * The address is a secret: whoever has it reads the calendar. It is never logged, never in an error, and never
 * shown back except as its host and last four characters (maskAddress).
 *
 * Only https, and only to the calendar services named here, so a pasted address cannot make the server fetch
 * anything else (its own network, a metadata service). Add a service by name when someone needs one.
 */

/** GUESS: the services a team's travel and events calendars live in. Google's is the one asked for. */
export const ICS_HOSTS: ReadonlyArray<{ host: RegExp; name: string }> = [
  { host: /^calendar\.google\.com$/, name: 'Google Calendar' },
  { host: /^(www\.)?tripit\.com$/, name: 'TripIt' },
  { host: /^outlook\.(office365|office|live)\.com$/, name: 'Outlook' },
  { host: /^p\d+-caldav\.icloud\.com$/, name: 'iCloud' },
];

/** A pasted address, checked: webcal:// read as https://, nothing but an allowed host. */
export function checkAddress(raw: string): { url: URL; service: string } | { why: string } {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try { u = new URL(s); } catch { return { why: 'That is not a calendar address. In Google Calendar: Settings → your calendar → “Secret address in iCal format”.' }; }
  if (u.protocol !== 'https:') return { why: 'A calendar address must be https.' };
  if (u.username || u.password || u.port) return { why: 'A calendar address has no user name, password or port in it.' };
  const svc = ICS_HOSTS.find((h) => h.host.test(u.hostname.toLowerCase()));
  if (!svc) return { why: `Only ${ICS_HOSTS.map((h) => h.name).join(', ')} addresses are read. Ask for another service to be added.` };
  if (s.length > 2000) return { why: 'That address is too long to be a calendar’s.' };
  return { url: u, service: svc.name };
}

/** How an address is shown: its service and the last four characters, never the rest. */
export const maskAddress = (raw: string) => {
  const c = checkAddress(raw);
  return `${'service' in c ? c.service : 'calendar'} ••••${raw.trim().slice(-4)}`;
};

export type IcsFetch = (url: URL) => Promise<{ status: number; text: () => Promise<string> }>;

/** GUESS: a year of a busy calendar is well under 5 MB; a page waits at most 8 s for one. */
const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8_000;

const httpsFetch: IcsFetch = async (url) => {
  const res = await fetch(url, { method: 'GET', redirect: 'error', headers: { accept: 'text/calendar' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

export class IcsError extends Error {
  constructor(message: string) { super(message); this.name = 'IcsError'; }
}

/** The calendar's text. Errors say what happened in words, never the address. */
export async function fetchIcs(raw: string, transport: IcsFetch = httpsFetch): Promise<string> {
  const c = checkAddress(raw);
  if ('why' in c) throw new IcsError(c.why);
  let res: Awaited<ReturnType<IcsFetch>>;
  try { res = await transport(c.url); } catch (e) {
    throw new IcsError(`${c.service} could not be reached (${e instanceof Error ? e.name : 'error'}).`);
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) throw new IcsError(`${c.service} no longer serves this address: it was reset or removed. Paste the new one in Preferences.`);
  if (res.status >= 400) throw new IcsError(`${c.service} answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new IcsError(`This calendar is larger than ${MAX_BYTES / 1e6} MB.`);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new IcsError(`${c.service} answered with something that is not a calendar.`);
  return text;
}
