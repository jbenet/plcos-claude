import { connectionPersonKey, type Path } from './connect';
import type { Finding } from './schema';
import { tieDetailsProblems } from '@/modules/network';

export interface LocatedRecord { file: string; index: number; value: unknown }
export interface ConnectionProblem { file: string; index: number; problems: string[]; conflictingKeys?: string[]; dropped?: { facts: number[]; connections: number[] } }
const object = (x: unknown): Record<string, any> | null => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : null;
const text = (x: unknown): x is string => typeof x === 'string' && Boolean(x.trim());
export const isEntityKey = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

/** Validate untrusted JSON before any SQL. Database failures are never converted to skips. */
export function pathProblems(value: unknown): string[] {
  const p = object(value);
  if (!p) return ['path must be an object'];
  const problems: string[] = [];
  if (!isEntityKey(p.lp)) problems.push('lp must be an entity UUID');
  if (!['met', 'corresponded', 'colleague', 'advisor', 'coinvestor', 'portfolio', 'alumni', 'board', 'same_firm', 'other'].includes(p.kind)) problems.push('unknown path kind');
  if (!['A', 'B', 'C', 'D'].includes(p.tier)) problems.push('unknown path tier');
  if (!text(p.basis)) problems.push('path needs a basis');
  const other = object(p.other);
  if (!other || !text(other.name) || !['team', 'ours', 'backer', 'lp'].includes(other.type)) problems.push('invalid other endpoint');
  if (other?.entityType !== undefined && !['person', 'org'].includes(other.entityType)) problems.push('invalid other.entityType');
  if (other?.person && other.entityType && (other.person.entityType ?? 'person') !== other.entityType) problems.push('other.entityType conflicts with connector descriptor');
  if (other?.key !== undefined && !isEntityKey(other.key)) problems.push('other.key must be an entity UUID');
  if (p.viaContact !== undefined) {
    const c = object(p.viaContact);
    if (!c || !isEntityKey(c.key) || !text(c.name) || !text(c.role) || c.key === p.lp) problems.push('invalid viaContact');
  }
  if (p.tie !== undefined) problems.push(...tieDetailsProblems(p.tie));
  for (const [label, key, value] of [['lpPerson', p.lp, p.lpPerson], ['other.person', other?.key, other?.person]] as const) {
    if (value === undefined) continue;
    const d = object(value);
    if (!d || !text(d.name) || !text(d.source) || !isEntityKey(d.key) || (d.entityType !== undefined && !['person', 'org'].includes(d.entityType))) {
      problems.push(`${label}: invalid connector descriptor`); continue;
    }
    if (d.key !== key) problems.push(`${label}: connector descriptor does not match its endpoint`);
    if (d.key !== connectionPersonKey(d.name, d.source)) problems.push(`${label}: invalid connector identity source`);
  }
  return problems;
}

// Collision keys retain organization words. The looser `norm` remains for matching only.
const collisionName = (s: string) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Exact normalized names only, never a guess from company-like words. Reports locations,
 * not names, so diagnostics are safe to paste outside the private research files.
 */
export function connectionIdentityProblems(findings: LocatedRecord[], paths: LocatedRecord[], knownOrgs: string[] = []): ConnectionProblem[] {
  type Use = { record: LocatedRecord; at: string; type: 'person' | 'org'; explicitTarget?: boolean; key?: string };
  const names = new Map<string, Use[]>();
  const result = new Map<LocatedRecord, string[]>();
  const keys = new Map<LocatedRecord, Set<string>>();
  const dropped = new Map<LocatedRecord, { facts: number[]; connections: number[] }>();
  const add = (name: unknown, use: Use) => {
    if (!text(name) || !collisionName(name)) return;
    const uses = names.get(collisionName(name)) ?? []; uses.push(use); names.set(collisionName(name), uses);
  };
  const report = (use: Use, message: string) => {
    // Finding identities and canonical organizations are context, never disposable items.
    if (use.at === 'identity' || use.at === 'identity.canonical.org') return;
    const item = /^(fact|connection) (\d+)$/.exec(use.at);
    if (item) {
      const indices = dropped.get(use.record) ?? { facts: [], connections: [] };
      const list = item[1] === 'fact' ? indices.facts : indices.connections;
      if (!list.includes(Number(item[2]))) list.push(Number(item[2]));
      dropped.set(use.record, indices);
    }
    const messages = result.get(use.record) ?? [];
    const problem = `${use.at}: ${message}`;
    if (!messages.includes(problem)) messages.push(problem);
    result.set(use.record, messages);
    if (use.key) keys.set(use.record, new Set([...(keys.get(use.record) ?? []), use.key]));
  };
  const external = new Set(knownOrgs.filter(text).map(collisionName));
  for (const record of findings) {
    const f = object(record.value); if (!f) continue;
    for (const name of [f.name, f.identity?.canonical?.name]) add(name, { record, at: 'identity', type: text(name) && external.has(collisionName(name)) ? 'org' : 'person' });
    add(f.identity?.canonical?.org, { record, at: 'identity.canonical.org', type: 'org' });
    for (const [i, fact] of (Array.isArray(f.facts) ? f.facts : []).entries()) {
      for (const name of [fact?.detail?.company, fact?.detail?.org, fact?.detail?.organization, fact?.detail?.firm, fact?.detail?.fund, ...(Array.isArray(fact?.detail?.companies) ? fact.detail.companies : [])]) add(name, { record, at: `fact ${i}`, type: 'org' });
    }
    for (const [i, c] of (Array.isArray(f.connections) ? f.connections : []).entries()) {
      // Firm scope describes whose tie this is; it does not imply the target is an org.
      if (['person', 'org'].includes(c?.toType)) add(c.to, { record, at: `connection ${i}`, type: c.toType, explicitTarget: true });
    }
  }
  for (const record of paths) {
    const p = object(record.value); if (!p) continue;
    for (const [at, d] of [['lpPerson', p.lpPerson], ['other.person', p.other?.person]] as const) {
      if (object(d) && ['person', 'org'].includes(d.entityType ?? 'person')) add(d.name, { record, at, type: d.entityType ?? 'person', key: d.key });
    }
    if (!p.other?.person && text(p.other?.name) && (['person', 'org'].includes(p.other.entityType) || ['ours', 'team', 'lp'].includes(p.other?.type))) add(p.other.name, { record, at: 'other', type: p.other.entityType ?? (p.other.type === 'ours' || external.has(collisionName(p.other.name ?? '')) ? 'org' : 'person'), key: p.other.key });
  }
  for (const [name, mentions] of names) {
    // A finding has no explicit subject type. Its default person/roster type must not
    // overrule its own explicitly typed target or canonical organization of that name.
    const uses = mentions.filter(use => use.at !== 'identity' || !mentions.some(other =>
      other.record === use.record && other.type !== use.type
      && (other.explicitTarget || other.at === 'identity.canonical.org')));
    const orgs = uses.filter((u) => u.type === 'org');
    const people = uses.filter((u) => u.type === 'person');
    if ((!orgs.length && !external.has(name)) || !people.length) continue;
    for (const use of uses) {
      if (!orgs.length && use.explicitTarget && mentions.some(other =>
        other.record === use.record && other.at === 'identity' && other.type === 'org')) continue;
      // A fact's org-shaped detail cannot invalidate an explicitly typed target or path.
      const opposites = (use.type === 'person' ? orgs : people).filter(other =>
        use.at.startsWith('fact ') || !other.at.startsWith('fact '));
      if (!opposites.length && (use.type === 'org' || !external.has(name))) continue;
      const opposite = opposites[0];
      const where = opposite ? `${opposite.record.file} index ${opposite.record.index} ${opposite.at}` : 'known organization roster';
      report(use, `${use.explicitTarget ? `toType ${use.type} conflicts with target identity` : 'same name used as both person and org'} (${where})`);
    }
  }
  return [...result].map(([record, problems]) => ({ file: record.file, index: record.index, problems, conflictingKeys: [...(keys.get(record) ?? [])], dropped: dropped.get(record) }));
}

/** Drop only indexed collision items; leave the source finding and its identity untouched. */
export function dropConflictingItems(finding: Finding, issue?: ConnectionProblem): Finding {
  if (!issue?.dropped) return finding;
  const { facts, connections } = issue.dropped;
  return { ...finding, facts: finding.facts.filter((_, i) => !facts.includes(i)),
    ...(finding.connections ? { connections: finding.connections.filter((_, i) => !connections.includes(i)) } : {}) };
}

/** Preserve physical JSONL indices, including blank lines, in all skip diagnostics. */
export function readPathRecords(text: string, file = 'connections.jsonl'): { records: LocatedRecord[]; allRecords: LocatedRecord[]; skipped: ConnectionProblem[] } {
  const records: LocatedRecord[] = [], allRecords: LocatedRecord[] = [], skipped: ConnectionProblem[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { skipped.push({ file, index, problems: ['not JSON'] }); continue; }
    allRecords.push({ file, index, value });
    const problems = pathProblems(value);
    if (problems.length) skipped.push({ file, index, problems });
    else records.push({ file, index, value: value as Path });
  }
  return { records, allRecords, skipped };
}
