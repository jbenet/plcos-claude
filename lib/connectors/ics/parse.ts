/**
 * A small iCalendar (RFC 5545) reader for the Calendar page's Travel and Events lanes (issue 0021): the events
 * of a private calendar address, as start, end, title, place and status. Pure; nothing is fetched here.
 *
 * Read: VEVENT's UID, DTSTART, DTEND (or DURATION), SUMMARY, LOCATION, STATUS, RECURRENCE-ID and RRULE.
 * Times are UTC (…Z), a named zone (TZID=…, converted with the platform's zone data), floating (read as UTC),
 * or all-day dates. A repeating event (RRULE) is expanded only for the simple rules travel and conference
 * calendars use (DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL), within the window asked for;
 * anything richer (BYDAY lists, BYMONTHDAY…) keeps its first occurrence only, and says so.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  cancelled: boolean;
  /** A repeating event whose rule was not expanded: only its first occurrence is here. */
  unexpanded: boolean;
}

/** Unfold continuation lines (RFC 5545 §3.1) and split into lines. */
function lines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

interface Prop { name: string; params: Record<string, string>; value: string }

function prop(line: string): Prop | null {
  // NAME;PARAM=VALUE;PARAM="VALUE":value — a colon inside a quoted parameter is not the separator.
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();

/** The UTC offset of a zone at a moment, in minutes, from the platform's zone data; 0 for a zone it does not know. */
function offsetMinutes(zone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).reduce<Record<string, number>>((o, p) => (p.type === 'literal' ? o : { ...o, [p.type]: Number(p.value) }), {});
    return (Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - at.getTime()) / 60_000;
  } catch {
    return 0;
  }
}

/** A DATE or DATE-TIME value as a moment; null when it is not one. */
export function icsTime(value: string, params: Record<string, string> = {}): { at: Date; allDay: boolean } | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (d) return { at: new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!)), allDay: true };
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!t) return null;
  const wall = Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!, +t[4]!, +t[5]!, +t[6]!);
  if (t[7] || !params.TZID) return { at: new Date(wall), allDay: false };
  // The wall time in a zone: correct by the zone's offset there (twice, for a moment near a change).
  let at = wall - offsetMinutes(params.TZID, new Date(wall)) * 60_000;
  at = wall - offsetMinutes(params.TZID, new Date(at)) * 60_000;
  return { at: new Date(at), allDay: false };
}

/** An ISO 8601 duration (P1D, PT1H30M, P1W) in milliseconds; null when it is not one. */
function duration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m || value === 'P' || value.endsWith('T')) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** GUESS: a rule left unbounded still stops here; a travel or events calendar never needs more in a window. */
const MAX_OCCURRENCES = 500;

function expand(rule: string, start: Date, allDay: boolean, from: Date, to: Date): Date[] | null {
  const r = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), v ?? '']));
  const freq = r.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq ?? '')) return null;
  if (Object.keys(r).some((k) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST'].includes(k))) return null;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? icsTime(r.UNTIL)?.at ?? null : null;
  const out: Date[] = [];
  for (let n = 0; n < count && out.length < MAX_OCCURRENCES; n++) {
    const d = new Date(start);
    if (freq === 'DAILY') d.setUTCDate(d.getUTCDate() + n * interval);
    if (freq === 'WEEKLY') d.setUTCDate(d.getUTCDate() + n * 7 * interval);
    if (freq === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + n * interval);
    if (freq === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + n * interval);
    if (until && d.getTime() > until.getTime() + (allDay ? 86_399_999 : 0)) break;
    if (d.getTime() > to.getTime()) break;
    if (d.getTime() >= from.getTime() - 366 * 86_400_000) out.push(d);
  }
  return out;
}

/**
 * The events of an iCalendar text that touch [from, to]. A moved occurrence (RECURRENCE-ID) replaces the one its
 * series would have had; a cancelled one is kept, marked, so the lane can leave it out.
 */
export function parseIcs(text: string, window: { from: Date; to: Date }): IcsEvent[] {
  const raw: Array<Record<string, Prop>> = [];
  let cur: Record<string, Prop> | null = null;
  let depth = 0;
  for (const line of lines(text)) {
    const p = prop(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) { cur = {}; depth = 0; } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) { depth--; continue; }
      if (cur && p.value.toUpperCase() === 'VEVENT') { raw.push(cur); cur = null; }
      continue;
    }
    // Only the event's own properties: an alarm inside it has its own.
    if (cur && depth === 0 && !(p.name in cur)) cur[p.name] = p;
  }

  const out: IcsEvent[] = [];
  const moved = new Set<string>();
  for (const e of raw) if (e['RECURRENCE-ID'] && e.UID) {
    const at = icsTime(e['RECURRENCE-ID'].value, e['RECURRENCE-ID'].params);
    if (at) moved.add(`${e.UID.value}|${at.at.getTime()}`);
  }
  for (const e of raw) {
    if (!e.DTSTART) continue;
    const s = icsTime(e.DTSTART.value, e.DTSTART.params);
    if (!s) continue;
    const endAt = e.DTEND ? icsTime(e.DTEND.value, e.DTEND.params)?.at ?? null : null;
    const dur = e.DURATION ? duration(e.DURATION.value) : null;
    // An all-day event's DTEND is the day after; one with no end lasts its day.
    const length = endAt ? endAt.getTime() - s.at.getTime() : dur ?? (s.allDay ? 86_400_000 : 0);
    const uid = e.UID?.value ?? `${e.DTSTART.value}|${e.SUMMARY?.value ?? ''}`;
    const base = {
      uid, title: e.SUMMARY ? unescape(e.SUMMARY.value) : '(no title)', location: e.LOCATION ? unescape(e.LOCATION.value) || null : null,
      allDay: s.allDay, cancelled: (e.STATUS?.value ?? '').toUpperCase() === 'CANCELLED',
    };
    const starts = e.RRULE && !e['RECURRENCE-ID'] ? expand(e.RRULE.value, s.at, s.allDay, window.from, window.to) : [s.at];
    for (const at of starts ?? [s.at]) {
      if (e.RRULE && !e['RECURRENCE-ID'] && moved.has(`${uid}|${at.getTime()}`)) continue;
      const end = new Date(at.getTime() + Math.max(0, length));
      if (end.getTime() < window.from.getTime() || at.getTime() > window.to.getTime()) continue;
      out.push({ ...base, start: at, end, unexpanded: !!e.RRULE && starts === null });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
