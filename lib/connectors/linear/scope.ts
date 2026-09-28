import { ENTITIES, type Entity } from './queries';
import type { Replica, Row } from './replica';

/** Scope is resolved from the newest merged record, so a transfer out cannot be replayed back in. */
export function scopeReplicas(replicas: Replica[], teams: readonly string[]): Replica[] {
  const latest = Object.fromEntries(ENTITIES.map(e => [e, new Map<string, Row>()])) as Record<Entity, Map<string, Row>>;
  for (const r of [...replicas].sort((a,b) => a.at.localeCompare(b.at))) for (const row of r.records) {
    const old = latest[r.entity].get(row.id);
    if (!old || row.updated_at >= old.updated_at) latest[r.entity].set(row.id, { ...old, ...row });
  }
  const allowed = Object.fromEntries(ENTITIES.map(e => [e, new Set<string>()])) as Record<Entity, Set<string>>;
  const has = (e: Entity, id: unknown) => typeof id === 'string' && allowed[e].has(id);
  const select = (e: Entity, test: (r: Row) => boolean) => {
    for (const row of latest[e].values()) if (test(row)) allowed[e].add(row.id);
  };
  select('teams', r => typeof r.key === 'string' && teams.includes(r.key));
  for (const e of ['states','labels','cycles','issues'] as const) select(e, r => has('teams', r.team_id));
  select('projects', r => Array.isArray(r.team_ids) && r.team_ids.some(id => has('teams', id)));
  select('milestones', r => has('projects', r.project_id));
  select('comments', r => has('issues', r.issue_id));
  for (const [e, cols] of [['issues',['assignee_id','creator_id']], ['projects',['lead_id']], ['comments',['user_id']]] as const) {
    for (const row of latest[e].values()) if (has(e,row.id)) for (const col of cols) {
      if (typeof row[col] === 'string') allowed.users.add(row[col] as string);
    }
  }
  const refs: Partial<Record<Entity, Record<string, Entity>>> = {
    labels: { parent_id:'labels' }, projects: {lead_id:'users'}, milestones:{project_id:'projects'},
    issues:{state_id:'states',assignee_id:'users',creator_id:'users',project_id:'projects',milestone_id:'milestones',cycle_id:'cycles',parent_id:'issues'},
    comments:{issue_id:'issues',user_id:'users',parent_id:'comments'},
  };
  return replicas.map(r => ({ ...r, records:r.records.filter(row => {
    if (!has(r.entity,row.id)) return false;
    if (r.entity === 'teams' && typeof row.key === 'string' && !teams.includes(row.key)) return false;
    // Historical records explicitly belonging to another team are never retained.
    if ('team_id' in row && row.team_id !== null && !has('teams',row.team_id)) return false;
    if (r.entity === 'projects' && Array.isArray(row.team_ids) && !row.team_ids.some(id => has('teams',id))) return false;
    if (r.entity === 'comments' && 'issue_id' in row && !has('issues',row.issue_id)) return false;
    if (r.entity === 'milestones' && 'project_id' in row && !has('projects',row.project_id)) return false;
    return true;
  }).map(row => {
    const out = {...row};
    if (Array.isArray(out.team_ids)) out.team_ids = out.team_ids.filter(id => has('teams',id));
    if (Array.isArray(out.label_ids)) out.label_ids = out.label_ids.filter(id => has('labels',id));
    for (const [col,e] of Object.entries(refs[r.entity] ?? {})) if (col in out && !has(e,out[col])) out[col] = null;
    return out;
  }) }));
}
