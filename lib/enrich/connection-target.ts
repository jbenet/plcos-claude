import { norm } from './connect';
import { looksLikeOrganization } from './pl-network';
import type { Connection, Finding } from './schema';

/** Match the same trailing descriptions W3 removes, never fuzzy-match a person. */
const bareTargetName = (name: string) => name.replace(/\s*\([^()]*\)\s*$/, '').trim();
export const targetName = (name: string) => norm(bareTargetName(name));
export function targetType(name: string, organizations: Set<string>, people: Set<string>): {
  type?: 'person' | 'org'; reason: string;
} {
  const key = targetName(name);
  const org = organizations.has(key), person = people.has(key);
  if (org && person) return { reason: 'name occurs in both organization and person records' };
  if (org) return { type: 'org', reason: 'organization record' };
  if (person) return { type: 'person', reason: 'person record' };
  if (looksLikeOrganization(bareTargetName(name))) return { type: 'org', reason: 'legacy organization rule' };
  return { reason: 'no resolved target type' };
}

/** Pure, idempotent edit: preserve every existing field, including explicit target types. */
export function backfillTargetTypes(finding: Finding, organizations: Set<string>, people: Set<string>) {
  const value = structuredClone(finding);
  const changed: Array<{ index: number; type: NonNullable<Connection['toType']>; reason: string }> = [];
  const unresolved: Array<{ index: number; name: string; reason: string }> = [];
  for (const [index, c] of (value.connections ?? []).entries()) {
    if (c.toType !== undefined) continue;
    const decision = targetType(c.to, organizations, people);
    if (decision.type) { c.toType = decision.type; changed.push({ index, type: decision.type, reason: decision.reason }); }
    else unresolved.push({ index, name: c.to, reason: decision.reason });
  }
  return { value, changed, unresolved };
}
