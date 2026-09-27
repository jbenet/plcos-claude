import type { ActivityData, ActivityPoint, ActivitySource, OriginCount } from './types';
export const sources: ActivitySource[] = ['affinity', 'warehouse', 'dakota', 'intake', 'search', 'fetch', 'sec', 'agents'];
export const labels = ['Affinity', 'PL data warehouse', 'Dakota', 'Intake files', 'Internet search', 'Page fetches', 'SEC', 'Agents'];
export const quantity = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export function utcDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(T|$)/.test(v) || !Number.isFinite(Date.parse(v))) return null;
  return new Date(v).toISOString().slice(0, 10);
}
/** Never retain paths, credentials, query strings, fragments, email addresses or IPs. */
export function host(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ? h : null;
  } catch { return null; }
}
export function segment(source: ActivitySource, value: unknown): string | null {
  if (source === 'agents') return typeof value === 'string' && /^W\d+[a-z]?$/i.test(value) ? value : null;
  const allowed = ['lists', 'notes', 'meetings', 'persons', 'organizations', 'opportunities', 'relationships', 'fields', 'list-entries', 'field-values', 'interactions', 'account', 'contact', 'fund', 'authentication', 'count', 'graph', 'queries', 'files', 'imports', 'findings', 'prospects', 'portfolio', 'init', 'users', 'rate-limit', 'investment', 'investment_strategy', 'other', 'research', 'review'];
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}
/** A point is a leaf, never an additional total. Null contaminates a sum: missing is not zero. */
export function aggregate(points: ActivityPoint[], origins: OriginCount[], asOf: string): ActivityData {
  const groups = new Map<string, ActivityPoint>();
  for (const p of points) {
    const key = JSON.stringify([p.day, p.source, p.segment, p.estimated]);
    const previous = groups.get(key);
    if (!previous) { groups.set(key, { ...p }); continue; }
    for (const k of ['requests', 'bytesIn', 'bytesOut', 'records'] as const) previous[k] = previous[k] === null || p[k] === null ? null : previous[k]! + p[k]!;
    if (p.basis && !previous.basis?.split('; ').includes(p.basis)) previous.basis = [previous.basis, p.basis].filter(Boolean).join('; ');
  }
  const os = new Map<string, OriginCount>();
  for (const o of origins) {
    const key = JSON.stringify([o.day, o.origin, o.estimated]);
    const previous = os.get(key);
    if (previous) previous.requests += o.requests; else os.set(key, { ...o });
  }
  const result = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source) || (a.segment ?? '').localeCompare(b.segment ?? ''));
  return { points: result, origins: [...os.values()].sort((a,b) => a.day.localeCompare(b.day) || a.origin.localeCompare(b.origin)), asOf,
    sources: sources.map((id, i) => ({ id, label: labels[i], state: result.some(p => p.source === id) ? (id === 'intake' ? 'files' : ['affinity','warehouse','dakota','sec'].includes(id) ? 'read-only' : 'connected') : 'planned',
      lastAt: result.filter(p => p.source === id).at(-1)?.day ? `${result.filter(p => p.source === id).at(-1)!.day}T00:00:00.000Z` : null,
      note: 'UTC daily activity. Null means unrecorded; estimates carry a basis. Last activity is day precision; history does not prove current connectivity.' })) };
}
