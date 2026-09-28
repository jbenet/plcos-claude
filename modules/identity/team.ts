import type { Db, Queryable } from '@/lib/db';
import { normalizeIdentityName } from './resolution';

export interface TeamRosterName { handle: string; name: string }
/** A sourced roster names an existing account by handle; names never identify an account. */
export async function syncTeamRoster(q: Queryable, roster: readonly TeamRosterName[]): Promise<number> {
  const byHandle = new Map<string, Set<string>>();
  for (const row of roster) if (row.handle?.trim() && row.name?.trim()) {
    const names = byHandle.get(row.handle) ?? new Set<string>();
    names.add(row.name.trim()); byHandle.set(row.handle, names);
  }
  let changed = 0;
  for (const [handle, names] of byHandle) {
    if (names.size !== 1) continue;
    const name = [...names][0]!;
    const user = await q.one<{ id: string; name: string; entity_id: string | null; entity_name: string | null }>(
      `select u.id::text, u.name, e.entity_id::text, e.display_name entity_name
       from platform.app_user u left join identity.source_record s on s.source='app_user' and s.source_id=u.handle
       left join identity.entity e on e.entity_id=s.entity_id and e.entity_type='person' and e.retired_at is null
       where u.handle=$1 and u.active for update of u`, [handle]);
    if (!user || (user.name === name && (!user.entity_id || user.entity_name === name))) continue;
    await q.query('update platform.app_user set name=$2 where id=$1 and name is distinct from $2', [user.id, name]);
    if (user.entity_id) await q.query('update identity.entity set display_name=$2 where entity_id=$1 and display_name is distinct from $2', [user.entity_id, name]);
    await q.query(`insert into platform.audit_log(action,subject_type,subject_id,detail)
      values('identity.team_roster_updated','app_user',$1,$2::jsonb)`, [user.id, JSON.stringify({
      source: 'enrich/us/team.json', handle, name, previousName: user.name,
      entityId: user.entity_id, previousEntityName: user.entity_name,
    })]);
    changed++;
  }
  return changed;
}

export interface TeamAlias { id: string; name: string; alias: string }
/** Labels project only known identity aliases. Ambiguous aliases remain unchanged. */
export function teamLabelProjector(rows: readonly TeamAlias[]) {
  const aliases = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const key = normalizeIdentityName(row.alias);
    if (!key) continue;
    const people = aliases.get(key) ?? new Map<string, string>();
    people.set(row.id, row.name); aliases.set(key, people);
  }
  return (labels: readonly string[]) => [...new Set(labels.filter(Boolean).map(label => {
    const matches = aliases.get(normalizeIdentityName(label));
    return matches?.size === 1 ? [...matches.values()][0]! : label;
  }))];
}

const labelCache = new WeakMap<Queryable, { revision: string; value: Promise<ReturnType<typeof teamLabelProjector>> }>();
export async function teamLabels(q: Queryable) {
  const revision = (await q.one<{ revision: string }>('select revision::text from network.route_revision where singleton'))!.revision;
  const previous = labelCache.get(q);
  if (previous?.revision === revision) return previous.value;
  const value = readTeamLabels(q);
  labelCache.set(q, { revision, value });
  try { return await value; }
  catch (error) { if (labelCache.get(q)?.value === value) labelCache.delete(q); throw error; }
}

async function readTeamLabels(q: Queryable) {
  const rows = await q.query<TeamAlias>(`with recursive team as (
    select u.id::text, u.name, u.email, identity.canonical_entity_id(s.entity_id) root
    from platform.app_user u left join identity.source_record s on s.source='app_user' and s.source_id=u.handle
    where u.active
  ), aliases as (
    select t.id,t.name,e.entity_id,e.display_name,array[e.entity_id] seen from team t
      join identity.entity e on e.entity_id=t.root and e.retired_at is null
    union all select a.id,a.name,e.entity_id,e.display_name,a.seen || e.entity_id from aliases a
      join identity.entity e on e.merged_into=a.entity_id and e.retired_at is null
      where not e.entity_id=any(a.seen)
  ) select id,name,name alias from team
  union all select id,name,email from team where email is not null
  union all select id,name,display_name from aliases
  union all select t.id,t.name,a.detail->>'previousName' from team t join platform.audit_log a
    on a.subject_id::text=t.id and a.subject_type='app_user' and a.action='identity.team_roster_updated'
  union all select t.id,t.name,a.detail->>'previousEntityName' from team t join platform.audit_log a
    on a.subject_id::text=t.id and a.subject_type='app_user' and a.action='identity.team_roster_updated'`);
  return teamLabelProjector(rows.filter(row => typeof row.alias === 'string'));
}

/** Caller passes settled local inputs and its existing server handle; no database or files opened here. */
export async function repairTeamIdentities(db: Db, input: import('@/modules/network/nodes').NetworkNodeInput, progress?: (stage: string, count: number) => void) {
  const rosterUpdated = await db.transaction(q => syncTeamRoster(q, input.team));
  const { identityEvidence } = await import('./resolution-input');
  const { resolveIdentities } = await import('./resolution');
  return { rosterUpdated, ...await resolveIdentities(db, identityEvidence(input), progress, { teamHandles: input.team.map(t => t.handle), names: input.team.map(t => t.name) }) };
}
