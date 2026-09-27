import type { ActivityData, ActivityPoint, ActivitySource, OriginCount } from './types';
/** Every source a row may be recorded under. 'sec' stays recordable so old log lines still read. */
export const sources: ActivitySource[] = ['affinity', 'warehouse', 'dakota', 'linear', 'intake', 'search', 'fetch', 'sec', 'agents'];
/** The sources shown (issue 0106): EDGAR is internet reading, not a database of its own, so its
 *  rows fold into page fetches as the 'edgar' segment and sec.gov shows among the hosts. */
export const shown: ActivitySource[] = ['affinity', 'warehouse', 'dakota', 'linear', 'intake', 'search', 'fetch', 'agents'];
export const labels = ['Affinity', 'PL data warehouse', 'Dakota', 'Linear', 'Intake files', 'Internet search', 'Page fetches', 'Agents'];
/** One short phrase per source (issues 0107–0108); the page explains estimates once, not per row. */
export const notes: Partial<Record<ActivitySource, string>> = {
  affinity: 'Read-only API sync', warehouse: 'Read-only BigQuery queries', dakota: 'Read-only bulk pull', linear: 'Read-only GraphQL sync',
  intake: 'Files dropped for import', search: 'Web searches for research', fetch: 'Public pages read for research, EDGAR included',
  agents: 'Workflow runs: model calls and items written',
};
/** SEC rows read as page fetches, segment 'edgar' (a segment of its own, so an unknown SEC figure
 *  never nulls a known fetch figure on the same day). */
export function foldSec(p: ActivityPoint): ActivityPoint {
  return p.source === 'sec' ? { ...p, source: 'fetch', segment: 'edgar' } : p;
}
/** A basis made of '; '-separated clauses, each kept once, in first-seen order. Merging the same
 *  basis twice leaves it unchanged, so repeated merges can no longer grow it (issue 0107). */
export function tidyBasis(...bases: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  for (const b of bases) for (const part of (b ?? '').split(/;\s+|\n+/)) {
    const clause = part.trim().replace(/[;.]+$/, '').trim();
    if (clause) seen.add(clause);
  }
  return seen.size ? `${[...seen].join('; ')}.` : undefined;
}
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
  const allowed = ['lists', 'notes', 'meetings', 'persons', 'organizations', 'opportunities', 'relationships', 'fields', 'list-entries', 'field-values', 'interactions', 'account', 'contact', 'fund', 'authentication', 'count', 'graph', 'queries', 'files', 'imports', 'findings', 'prospects', 'portfolio', 'init', 'users', 'rate-limit', 'investment', 'investment_strategy', 'other', 'research', 'review', 'teams', 'states', 'labels', 'projects', 'milestones', 'cycles', 'issues', 'comments'];
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}
/** A point is a leaf, never an additional total. Null contaminates a sum: missing is not zero. */
export function aggregate(points: ActivityPoint[], origins: OriginCount[], asOf: string): ActivityData {
  const groups = new Map<string, ActivityPoint>();
  for (const raw of points) {
    const p = foldSec(raw);
    const key = JSON.stringify([p.day, p.source, p.segment, p.estimated]);
    const previous = groups.get(key);
    if (!previous) { groups.set(key, { ...p, ...(p.basis ? { basis: tidyBasis(p.basis) } : {}) }); continue; }
    for (const k of ['requests', 'bytesIn', 'bytesOut', 'records'] as const) previous[k] = previous[k] === null || p[k] === null ? null : previous[k]! + p[k]!;
    if (p.basis) previous.basis = tidyBasis(previous.basis, p.basis);
  }
  const os = new Map<string, OriginCount>();
  for (const o of origins) {
    const key = JSON.stringify([o.day, o.origin, o.estimated]);
    const previous = os.get(key);
    if (previous) previous.requests += o.requests; else os.set(key, { ...o });
  }
  const result = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source) || (a.segment ?? '').localeCompare(b.segment ?? ''));
  return { points: result, origins: [...os.values()].sort((a,b) => a.day.localeCompare(b.day) || a.origin.localeCompare(b.origin)), asOf,
    sources: shown.map((id, i) => ({ id, label: labels[i], state: result.some(p => p.source === id) ? (id === 'intake' ? 'files' : ['affinity','warehouse','dakota','linear'].includes(id) ? 'read-only' : 'connected') : 'planned',
      lastAt: result.filter(p => p.source === id).at(-1)?.day ? `${result.filter(p => p.source === id).at(-1)!.day}T00:00:00.000Z` : null,
      note: notes[id] ?? '' })) };
}
