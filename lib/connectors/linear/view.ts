import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import { readManifests, type Manifest } from './replica';

/**
 * What Developer → Linear shows (docs/24-linear.md): the sync's state and what is in the replica,
 * counted by team, project and state. Reads our database and the manifests; never Linear.
 */

export const OPEN = ['backlog', 'unstarted', 'started', 'triage'];
export const DONE = ['completed'];

export interface TeamCount { id: string; key: string | null; name: string | null; issues: number; open: number; done: number; canceled: number; projects: number; lastUpdated: Date | null }
export interface ProjectRow {
  id: string; name: string | null; teams: string; statusName: string | null; statusType: string | null; lead: string | null; leadOurs: boolean;
  start: string | null; target: string | null; issues: number; open: number; done: number; milestones: number; url: string | null;
}
export interface VehicleReading { slug: string; name: string; projects: number; issues: number; open: number; terms: string[] }
export interface LinearOverview {
  totals: Record<'teams' | 'members' | 'states' | 'labels' | 'projects' | 'milestones' | 'cycles' | 'issues' | 'comments', number>;
  teams: TeamCount[];
  projects: ProjectRow[];
  states: Array<{ type: string; issues: number }>;
  ours: { members: number; matched: number; openAssigned: number; openUnassigned: number; openAssignedElsewhere: number };
  fill: Record<'assignee' | 'project' | 'due' | 'estimate' | 'labels' | 'parent' | 'cycle' | 'milestone', number>;
  vehicles: VehicleReading[];
  lpTitles: { issues: number; lps: number };
  newest: Date | null; oldest: Date | null;
}

const n = (x: unknown) => Number(x ?? 0);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words that name a vehicle in a project or issue title: its name, the name without its wrapper, its slug, its aliases. */
export function vehicleTerms(v: { slug: string; name: string; aliases: string[] | null }): string[] {
  const core = v.name.replace(/^PLC\s+/i, '').replace(/^SPV\s*[—–-]\s*/i, '').replace(/\s+SPV$/i, '').replace(/\s+I$/, '').trim();
  const slug = v.slug.replace(/^spv-/, '').replace(/-/g, ' ');
  const all = [v.name, core, slug, ...(v.aliases ?? [])].map((t) => t.trim()).filter((t) => t.length >= 4 || /^[A-Z0-9]{3,}$/.test(t));
  return [...new Set(all.map((t) => t.toLowerCase()))];
}
export const termsPattern = (terms: string[]) => terms.length ? `\\m(${terms.map(esc).join('|')})\\M` : null;

export async function linearOverview(db: Queryable): Promise<LinearOverview> {
  // Scope reads as well as writes so a legacy workspace replica cannot leak into this page
  // while the live operator is waiting to run its first purge and re-map.
  const scopedQuery = <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const scope = `with scoped_team as (select * from linear.team where key = any($${params.length + 1}::text[])),
      scoped_issue as (select * from linear.issue where team_id in (select id from scoped_team)),
      scoped_project as (select * from linear.project where team_ids && array(select id from scoped_team)),
      scoped_comment as (select * from linear.comment where issue_id in (select id from scoped_issue)),
      scoped_state as (select * from linear.state where team_id in (select id from scoped_team)),
      scoped_label as (select * from linear.label where team_id in (select id from scoped_team)),
      scoped_cycle as (select * from linear.cycle where team_id in (select id from scoped_team)),
      scoped_milestone as (select * from linear.milestone where project_id in (select id from scoped_project)),
      scoped_member as (select * from linear.member where id in (
        select assignee_id from scoped_issue union select creator_id from scoped_issue
        union select lead_id from scoped_project union select user_id from scoped_comment))`;
    return db.query<T>(`${scope}${/^with\s/i.test(sql) ? ', ' + sql.replace(/^with\s+/i, '') : ' ' + sql}`, [...params, config.linear.teams]);
  };

  const open = `(select id from scoped_state where type = any($1::text[]))`;
  const [totals] = await scopedQuery<Record<string, string>>(`select
    (select count(*) from scoped_team) teams, (select count(*) from scoped_member) members, (select count(*) from scoped_state) states,
    (select count(*) from scoped_label) labels, (select count(*) from scoped_project where archived_at is null) projects,
    (select count(*) from scoped_milestone) milestones, (select count(*) from scoped_cycle) cycles,
    (select count(*) from scoped_issue where archived_at is null) issues, (select count(*) from scoped_comment) comments`);
  const teams = await scopedQuery<Record<string, unknown>>(`select t.id, t.key, t.name,
      count(i.id) issues, count(i.id) filter (where s.type = any($1::text[])) open, count(i.id) filter (where s.type = 'completed') done,
      count(i.id) filter (where s.type in ('canceled','duplicate')) canceled,
      (select count(*) from scoped_project p where t.id = any(p.team_ids) and p.archived_at is null) projects, max(i.updated_at) last
    from scoped_team t left join scoped_issue i on i.team_id = t.id and i.archived_at is null left join scoped_state s on s.id = i.state_id
    where t.archived_at is null group by t.id, t.key, t.name order by count(i.id) desc, t.name`, [OPEN]);
  const projects = await scopedQuery<Record<string, unknown>>(`select p.id, p.name, p.url, p.status_name, p.status_type, p.start_date::text start, p.target_date::text target,
      m.name lead, (u.id is not null) lead_ours,
      (select string_agg(coalesce(t.key, '?'), ', ' order by t.key) from scoped_team t where t.id = any(p.team_ids)) teams,
      count(i.id) issues, count(i.id) filter (where s.type = any($1::text[])) open, count(i.id) filter (where s.type = 'completed') done,
      (select count(*) from scoped_milestone ms where ms.project_id = p.id and ms.archived_at is null) milestones
    from scoped_project p left join scoped_member m on m.id = p.lead_id
    left join platform.app_user u on m.email is not null and lower(u.email) = lower(m.email)
    left join scoped_issue i on i.project_id = p.id and i.archived_at is null left join scoped_state s on s.id = i.state_id
    where p.archived_at is null group by p.id, p.name, p.url, p.status_name, p.status_type, p.start_date, p.target_date, p.team_ids, m.name, u.id
    order by case p.status_type when 'started' then 0 when 'planned' then 1 when 'backlog' then 2 else 3 end, count(i.id) filter (where s.type = any($1::text[])) desc, p.name`, [OPEN]);
  const states = await scopedQuery<{ type: string; issues: string }>(`select coalesce(s.type, 'unknown') type, count(*) issues
    from scoped_issue i left join scoped_state s on s.id = i.state_id where i.archived_at is null group by 1 order by 2 desc`);
  const [ours] = await scopedQuery<Record<string, string>>(`with ours as (select m.id from scoped_member m join platform.app_user u on lower(u.email) = lower(m.email))
    select (select count(*) from scoped_member where archived_at is null) members, (select count(*) from ours) matched,
      count(*) filter (where i.assignee_id in (select id from ours)) open_ours,
      count(*) filter (where i.assignee_id is null) open_none,
      count(*) filter (where i.assignee_id is not null and i.assignee_id not in (select id from ours)) open_else
    from scoped_issue i where i.archived_at is null and i.state_id in ${open}`, [OPEN]);
  const [fill] = await scopedQuery<Record<string, string>>(`select count(*) filter (where assignee_id is not null) assignee, count(*) filter (where project_id is not null) project,
      count(*) filter (where due_date is not null) due, count(*) filter (where estimate is not null) estimate,
      count(*) filter (where cardinality(coalesce(label_ids, '{}')) > 0) labels, count(*) filter (where parent_id is not null) parent,
      count(*) filter (where cycle_id is not null) cycle, count(*) filter (where milestone_id is not null) milestone,
      min(created_at) oldest, max(updated_at) newest
    from scoped_issue where archived_at is null`);
  const vehicles: VehicleReading[] = [];
  for (const v of await scopedQuery<{ slug: string; name: string; aliases: string[] | null }>(`select slug, name, aliases from platform.vehicle where phase <> 'historical' and kind::text <> 'grant_rail' order by sort_order`)) {
    const terms = vehicleTerms(v), re = termsPattern(terms);
    if (!re) continue;
    const [r] = await scopedQuery<Record<string, string>>(`with ps as (select id from scoped_project where archived_at is null and name ~* $1)
      select (select count(*) from ps) projects, count(i.id) issues, count(i.id) filter (where s.type = any($2::text[])) open
      from scoped_issue i left join scoped_state s on s.id = i.state_id
      where i.archived_at is null and (i.project_id in (select id from ps) or i.title ~* $1)`, [re, OPEN]);
    vehicles.push({ slug: v.slug, name: v.name, projects: n(r?.projects), issues: n(r?.issues), open: n(r?.open), terms });
  }
  // An LP named in an issue title: a name match, counted, never a link (docs/24-linear.md §4).
  const [lp] = await scopedQuery<Record<string, string>>(`with lps as (
      select distinct e.entity_id, lower(e.display_name) name from strategy.active_pursuit p join identity.entity e on e.entity_id = p.entity_id
      where length(e.display_name) >= 5 and p.status::text <> 'passed')
    select count(distinct i.id) issues, count(distinct l.entity_id) lps from scoped_issue i join lps l on position(l.name in lower(i.title)) > 0
    where i.archived_at is null`);
  return {
    totals: Object.fromEntries(Object.entries(totals ?? {}).map(([k, v]) => [k, n(v)])) as LinearOverview['totals'],
    teams: teams.map((t) => ({ id: String(t.id), key: t.key as string | null, name: t.name as string | null, issues: n(t.issues), open: n(t.open), done: n(t.done),
      canceled: n(t.canceled), projects: n(t.projects), lastUpdated: t.last ? new Date(t.last as string) : null })),
    projects: projects.map((p) => ({ id: String(p.id), name: p.name as string | null, teams: (p.teams as string | null) ?? '', statusName: p.status_name as string | null,
      statusType: p.status_type as string | null, lead: p.lead as string | null, leadOurs: Boolean(p.lead_ours), start: p.start as string | null, target: p.target as string | null,
      issues: n(p.issues), open: n(p.open), done: n(p.done), milestones: n(p.milestones), url: p.url as string | null })),
    states: states.map((s) => ({ type: s.type, issues: n(s.issues) })),
    ours: { members: n(ours?.members), matched: n(ours?.matched), openAssigned: n(ours?.open_ours), openUnassigned: n(ours?.open_none), openAssignedElsewhere: n(ours?.open_else) },
    fill: { assignee: n(fill?.assignee), project: n(fill?.project), due: n(fill?.due), estimate: n(fill?.estimate), labels: n(fill?.labels), parent: n(fill?.parent), cycle: n(fill?.cycle), milestone: n(fill?.milestone) },
    vehicles, lpTitles: { issues: n(lp?.issues), lps: n(lp?.lps) },
    newest: fill?.newest ? new Date(fill.newest) : null, oldest: fill?.oldest ? new Date(fill.oldest) : null,
  };
}

export interface SyncState {
  manifests: number; last: (Manifest & { name: string }) | null; lastComplete: (Manifest & { name: string }) | null;
  source: { status: string; lastSyncAt: Date | null; detail: string | null } | null;
  files: number;
}

export async function linearSyncState(db: Queryable, rawDir: string): Promise<SyncState> {
  const ms = await readManifests(rawDir);
  const src = await db.one<{ status: string; last_sync_at: Date | string | null; detail: string | null }>(`select status::text, last_sync_at, detail from platform.source_sync where source = 'linear'`);
  const files = await db.one<{ n: string }>('select count(*) n from linear.replica');
  return {
    manifests: ms.length, last: ms.at(-1) ?? null, lastComplete: ms.filter((m) => m.complete).at(-1) ?? null,
    source: src ? { status: src.status, lastSyncAt: src.last_sync_at ? new Date(src.last_sync_at) : null, detail: src.detail } : null,
    files: n(files?.n),
  };
}
