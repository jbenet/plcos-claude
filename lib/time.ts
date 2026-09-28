const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type DateParts = {
  weekday?: 'short'; day?: 'numeric' | '2-digit'; month?: 'short'; year?: 'numeric' | '2-digit';
  hour?: '2-digit'; minute?: '2-digit'; timeZone?: string;
};

/**
 * "Wed 2 Sep 2026, 15:06", built from numbers so it reads the same on the server and in every
 * browser. `toLocaleDateString('en-GB', { month: 'short' })` does not: Node's ICU says "Sept" and
 * Safari's says "Sep", and Safari puts "," after a weekday and " at " before a time — a Client
 * Component that formatted a date that way failed to hydrate in Safari (issue 0118). Only the
 * numeric fields come from Intl, which also applies `timeZone` (the runtime's own zone if absent).
 */
export function formatDate(value: Date | number | string, o: DateParts): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: o.timeZone,
  }).formatToParts(date)) p[x.type] = x.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const two = (v: number) => String(v).padStart(2, '0');
  const day = [
    o.weekday && WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
    o.day && (o.day === '2-digit' ? two(d) : String(d)),
    o.month && MONTHS[m - 1],
    o.year && (o.year === '2-digit' ? two(y % 100) : String(y)),
  ].filter(Boolean).join(' ');
  const time = o.hour ? `${two(Number(p.hour) % 24)}${o.minute ? `:${two(Number(p.minute))}` : ''}` : '';
  return day && time ? `${day}, ${time}` : day || time;
}

export function ago(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return formatDate(date, { day: '2-digit', month: 'short' });
}

export function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(d: Date): string {
  return formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "Saturday 19 September" — the heading of a day, not a field in a table. */
export function longDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

/** "08:05" — shown beside a pinned number so the freeze has a time, not just a date. */
export function timeOfDay(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}
