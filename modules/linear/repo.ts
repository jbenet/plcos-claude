import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { termsPattern, vehicleTerms } from '@/lib/connectors/linear/view';
import {
  OPEN_TYPES, priorityRank, STATE_ORDER,
  type Freshness, type IssueGroup, type LinearIssue, type LinkReviewVehicle, type MyLinear, type Person,
  type ProjectStatusType, type StateType, type Workstream, type Workstreams,
} from './types';

/**
 * Reads for Daily standup ("My Linear"), a vehicle's Overview ("Workstreams") and the link review
 * on Developer → Linear (docs/24-linear.md). Our replica only; nothing here reaches Linear.
 *
 * Every read is scoped to the allowed teams (`config.linear.teams`), as Developer → Linear's are,
 * so a replica that still holds another team's rows shows none of them.
 */

const n = (x: unknown) => Number(x ?? 0);
/** The allowed teams' ids, with the key list as parameter $k. */
const TEAMS = (k: number) => `(select id from linear.team where key = any($${k}::text[]))`;
const teamKeys = () => config.linear.teams;
const d = (x: unknown) => (x ? new Date(x as string) : null);

/** Initials from a name, as our roster writes them: first and last word. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0]!, last = words.length > 1 ? words.at(-1)![0]! : '';
  return (first + last).toUpperCase();
}

/** Today in the server's own calendar, YYYY-MM-DD, to compare with Linear's due dates. */
export function localToday(now = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export const addDays = (iso: string, days: number) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

// A Linear member is ours when their address is someone's email or linearEmail.
const OURS = `lower(m.email) in (lower(u.email), lower(u.linear_email))`;

const ISSUE_SELECT = `
  select i.id, i.identifier, i.title, i.url, coalesce(i.priority, 0) priority, i.due_date::text due, i.completed_at, i.updated_at,
    coalesce(s.name, 'Unknown') state_name, coalesce(s.type, 'unknown') state_type, coalesce(s.position, 0) state_pos,
    p.id project_id, p.name project_name, p.color project_color,
    m.name member_name, m.display_name member_display, ou.name our_name, ou.initials our_initials,
    coalesce((select json_agg(json_build_object('name', l.name, 'color', l.color) order by l.name)
      from linear.label l where l.id = any(i.label_ids) and l.archived_at is null and not coalesce(l.is_group, false)), '[]'::json) labels
  from linear.issue i
  left join linear.state s on s.id = i.state_id
  left join linear.project p on p.id = i.project_id
  left join linear.member m on m.id = i.assignee_id
  left join lateral (select u.name, u.initials from platform.app_user u where m.email is not null and ${OURS} order by u.created_at limit 1) ou on true`;

type IssueRow = Record<string, unknown>;

function person(name: unknown, display: unknown, ourName: unknown, ourInitials: unknown): Person | null {
  const nm = (ourName ?? name ?? display) as string | null;
  if (!nm) return null;
  return { name: nm, initials: (ourInitials as string | null) ?? initialsOf(nm), ours: Boolean(ourName) };
}

function toIssue(r: IssueRow): LinearIssue {
  const labels = (typeof r.labels === 'string' ? JSON.parse(r.labels) : r.labels) as Array<{ name: string | null; color: string | null }>;
  return {
    id: String(r.id), identifier: String(r.identifier ?? ''), title: String(r.title ?? 'Untitled'), url: (r.url as string | null) ?? null,
    priority: n(r.priority), dueDate: (r.due as string | null) ?? null,
    state: { name: String(r.state_name), type: String(r.state_type) as StateType, position: n(r.state_pos) },
    labels: (labels ?? []).filter((l) => l.name).map((l) => ({ name: l.name!, color: l.color })),
    project: r.project_id ? { id: String(r.project_id), name: String(r.project_name ?? 'Unnamed project'), color: (r.project_color as string | null) ?? null } : null,
    assignee: person(r.member_name, r.member_display, r.our_name, r.our_initials),
    completedAt: d(r.completed_at), updatedAt: d(r.updated_at) ?? new Date(0),
  };
}

async function issues(db: Queryable, where: string, params: unknown[], order: string, limit?: number): Promise<LinearIssue[]> {
  const rows = await db.query<IssueRow>(`${ISSUE_SELECT} where i.archived_at is null and i.team_id in ${TEAMS(params.length + 1)} and ${where}
    order by ${order}${limit ? ` limit ${Math.floor(limit)}` : ''}`, [...params, teamKeys()]);
  return rows.map(toIssue);
}

export async function linearFreshness(db: Queryable): Promise<Freshness> {
  const r = await db.one<{ status: string; last_sync_at: string | Date | null }>(`select status::text, last_sync_at from platform.source_sync where source = 'linear'`);
  if (!r) return { status: 'never', lastSyncAt: null };
  return { status: r.status as Freshness['status'], lastSyncAt: d(r.last_sync_at) };
}

/** Linear's own views, from the workspace part of an issue's or project's address. A guess at Linear's URL scheme. */
function workspaceBase(url: string | null): string | null {
  if (!url) return null;
  const m = /^(https:\/\/[^/]+\/[^/]+)\/(?:issue|project)\//.exec(url);
  return m ? m[1]! : null;
}

const byPriorityThenDue = (a: LinearIssue, b: LinearIssue) =>
  priorityRank(a.priority) - priorityRank(b.priority) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.updatedAt.getTime() - a.updatedAt.getTime();

/** Group issues by workflow state in Linear's order: in progress, to do, backlog, done, canceled. */
export function groupByState(list: LinearIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup & { type: StateType; pos: number }>();
  for (const i of list) {
    const key = `${i.state.type}:${i.state.name}`;
    const g = groups.get(key) ?? { key, title: i.state.name, icon: { kind: 'state', type: i.state.type }, issues: [], type: i.state.type, pos: i.state.position };
    g.issues.push(i);
    groups.set(key, g);
  }
  // Within a type, the later state first (In Review above In Progress), as Linear lists them.
  return [...groups.values()]
    .sort((a, b) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || b.pos - a.pos)
    .map(({ type: _t, pos: _p, ...g }) => ({ ...g, issues: g.issues.sort(byPriorityThenDue) }));
}

/**
 * My Linear, for the signed-in person: in progress, then due within a week or overdue, then to do.
 * Backlog is counted, not listed. The team view is every issue in progress, by assignee.
 */
export async function myLinear(userId: string, opts: { now?: Date; cap?: number } = {}): Promise<MyLinear> {
  const db = await getDb();
  const today = localToday(opts.now);
  const soon = addDays(today, 7);
  const [freshness, matched, any] = await Promise.all([
    linearFreshness(db),
    db.query<{ id: string; name: string | null; email: string }>(`select m.id, m.name, m.email from linear.member m, platform.app_user u
      where u.id = $1 and m.archived_at is null and m.email is not null and ${OURS}`, [userId]),
    db.one<{ url: string | null; n: string; key: string | null }>(`select
      (select url from linear.issue where url is not null and team_id in ${TEAMS(1)} order by updated_at desc limit 1) url,
      (select count(*) from linear.issue where archived_at is null and team_id in ${TEAMS(1)}) n,
      (select t.key from linear.team t join linear.issue i on i.team_id = t.id where i.archived_at is null and t.id in ${TEAMS(1)}
        group by t.key order by count(*) desc limit 1) key`, [teamKeys()]),
  ]);
  const ids = matched.map((m) => m.id);
  const [mineAll, teamAll] = await Promise.all([
    ids.length ? issues(db, `i.assignee_id = any($1::text[]) and coalesce(s.type, 'unknown') = any($2::text[])`, [ids, OPEN_TYPES], 'i.updated_at desc') : Promise.resolve([]),
    issues(db, `s.type = 'started'`, [], 'i.updated_at desc'),
  ]);
  const cap = opts.cap ?? 12;
  const inProgress = mineAll.filter((i) => i.state.type === 'started').sort(byPriorityThenDue);
  const dueSoon = mineAll.filter((i) => i.state.type !== 'started' && i.dueDate && i.dueDate <= soon)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || priorityRank(a.priority) - priorityRank(b.priority));
  const todo = mineAll.filter((i) => (i.state.type === 'unstarted' || i.state.type === 'triage') && !(i.dueDate && i.dueDate <= soon)).sort(byPriorityThenDue);
  const backlog = mineAll.filter((i) => i.state.type === 'backlog' && !(i.dueDate && i.dueDate <= soon)).length;

  // Cap the whole list, keeping groups in order; what is cut is counted on its group.
  let left = cap;
  const take = (g: IssueGroup): IssueGroup => {
    const kept = g.issues.slice(0, Math.max(0, left));
    left -= kept.length;
    return { ...g, issues: kept, more: g.issues.length - kept.length };
  };
  const mine = [
    take({ key: 'started', title: 'In progress', icon: { kind: 'state', type: 'started' }, issues: inProgress }),
    take({ key: 'due', title: 'Due this week or overdue', icon: { kind: 'due' }, issues: dueSoon }),
    take({ key: 'todo', title: 'Todo', icon: { kind: 'state', type: 'unstarted' }, issues: todo }),
  ].filter((g) => g.issues.length + (g.more ?? 0) > 0);

  // Team: by assignee, our team first, then others, then nobody.
  const people = new Map<string, IssueGroup>();
  for (const i of teamAll) {
    const key = i.assignee ? `${i.assignee.ours ? 0 : 1}:${i.assignee.name}` : '2:';
    const g = people.get(key) ?? { key, title: i.assignee?.name ?? 'No assignee', icon: { kind: 'person', person: i.assignee }, issues: [] };
    g.issues.push(i);
    people.set(key, g);
  }
  const team = [...people.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => ({ ...g, issues: g.issues.sort(byPriorityThenDue) }));

  const base = workspaceBase(any?.url ?? null);
  return {
    freshness, matched: matched.map((m) => ({ name: m.name ?? m.email, email: m.email })),
    mine, backlog, team, teamCount: teamAll.length,
    links: { mine: base ? `${base}/my-issues/assigned` : null, team: base && any?.key ? `${base}/team/${any.key}/active` : null },
    synced: n(any?.n) > 0,
  };
}

const PROJECT_ORDER = `case p.status_type when 'started' then 0 when 'planned' then 1 when 'paused' then 2 when 'backlog' then 3 when 'completed' then 4 else 5 end`;

/** A vehicle's Linear projects, by accepted link, with the next open issues and the latest done. */
export async function vehicleWorkstreams(vehicleId: string, opts: { upcoming?: number; done?: number } = {}): Promise<Workstreams> {
  const db = await getDb();
  const [freshness, projects, vehicle, any] = await Promise.all([
    linearFreshness(db),
    db.query<Record<string, unknown>>(`select p.id, p.name, p.url, p.color, p.status_name, p.status_type, p.start_date::text start, p.target_date::text target, p.health,
        m.name lead_name, m.display_name lead_display, ou.name our_name, ou.initials our_initials,
        count(i.id) filter (where s.type is distinct from 'canceled' and s.type is distinct from 'duplicate') total,
        count(i.id) filter (where s.type = 'completed') done,
        count(i.id) filter (where s.type = any($2::text[])) open
      from linear.link k join linear.project p on p.id = k.linear_id
      left join linear.member m on m.id = p.lead_id
      left join lateral (select u.name, u.initials from platform.app_user u where m.email is not null and ${OURS} order by u.created_at limit 1) ou on true
      left join linear.issue i on i.project_id = p.id and i.archived_at is null and i.team_id in ${TEAMS(3)}
      left join linear.state s on s.id = i.state_id
      where k.target_kind = 'vehicle' and k.target_id = $1 and k.linear_kind = 'project' and k.status = 'accepted' and p.archived_at is null
        and p.team_ids && array${TEAMS(3)}
      group by p.id, m.name, m.display_name, ou.name, ou.initials
      order by ${PROJECT_ORDER}, p.target_date nulls last, p.name`, [vehicleId, OPEN_TYPES, teamKeys()]),
    db.one<{ slug: string; name: string; aliases: string[] | null }>('select slug, name, aliases from platform.vehicle where id = $1', [vehicleId]),
    db.one<{ n: string }>(`select count(*) n from linear.issue where archived_at is null and team_id in ${TEAMS(1)}`, [teamKeys()]),
  ]);
  const ids = projects.map((p) => String(p.id));
  const upN = opts.upcoming ?? 6, doneN = opts.done ?? 4;
  const [upcoming, openCount, recentlyDone] = ids.length ? await Promise.all([
    issues(db, `i.project_id = any($1::text[]) and s.type = any($2::text[])`, [ids, ['triage', 'unstarted', 'started']],
      `i.due_date nulls last, case when coalesce(i.priority, 0) = 0 then 5 else i.priority end, case s.type when 'started' then 0 else 1 end, i.updated_at desc`, upN),
    db.one<{ n: string }>(`select count(*) n from linear.issue i join linear.state s on s.id = i.state_id
      where i.archived_at is null and i.project_id = any($1::text[]) and s.type = any($2::text[]) and i.team_id in ${TEAMS(3)}`, [ids, ['triage', 'unstarted', 'started'], teamKeys()]),
    issues(db, `i.project_id = any($1::text[]) and s.type = 'completed'`, [ids], 'i.completed_at desc nulls last', doneN),
  ]) : [[], null, []];

  let suggested = 0;
  if (vehicle) {
    const re = termsPattern(vehicleTerms(vehicle));
    if (re) {
      const r = await db.one<{ n: string }>(`select count(*) n from linear.project p where p.archived_at is null and p.name ~* $1 and p.team_ids && array${TEAMS(3)}
        and not exists (select 1 from linear.link k where k.target_kind = 'vehicle' and k.target_id = $2 and k.linear_kind = 'project' and k.linear_id = p.id)`, [re, vehicleId, teamKeys()]);
      suggested = n(r?.n);
    }
  }
  return {
    freshness,
    projects: projects.map((p): Workstream => ({
      id: String(p.id), name: String(p.name ?? 'Unnamed project'), url: (p.url as string | null) ?? null, color: (p.color as string | null) ?? null,
      status: { name: String(p.status_name ?? 'No status'), type: String(p.status_type ?? 'unknown') as ProjectStatusType },
      lead: person(p.lead_name, p.lead_display, p.our_name, p.our_initials),
      start: (p.start as string | null) ?? null, target: (p.target as string | null) ?? null,
      total: n(p.total), done: n(p.done), open: n(p.open), health: (p.health as string | null) ?? null,
    })),
    upcoming, upcomingMore: Math.max(0, n(openCount?.n) - upcoming.length), recentlyDone, suggested, synced: n(any?.n) > 0,
  };
}

/** Developer → Linear: each vehicle's linked projects, the name-based suggestions, and the rest. */
export async function linkReview(): Promise<LinkReviewVehicle[]> {
  const db = await getDb();
  const [vehicles, projects, links] = await Promise.all([
    db.query<{ id: string; slug: string; name: string; aliases: string[] | null }>(`select id, slug, name, aliases from platform.vehicle
      where phase <> 'historical' and kind::text <> 'grant_rail' order by sort_order`),
    db.query<{ id: string; name: string | null; status_name: string | null }>(`select id, name, status_name from linear.project
      where archived_at is null and team_ids && array${TEAMS(1)}
      order by ${PROJECT_ORDER.replaceAll('p.', '')}, name`, [teamKeys()]),
    db.query<{ target_id: string; linear_id: string; status: string; source: 'name' | 'person'; basis: string | null; as_of: string | Date; by: string | null }>(
      `select k.target_id, k.linear_id, k.status, k.source, k.basis, k.as_of, u.name by from linear.link k left join platform.app_user u on u.id = k.last_verified_by
       where k.target_kind = 'vehicle' and k.linear_kind = 'project'`),
  ]);
  const name = new Map(projects.map((p) => [p.id, p]));
  return vehicles.map((v) => {
    const terms = vehicleTerms(v);
    const mine = links.filter((l) => l.target_id === v.id && name.has(l.linear_id));
    const decided = new Set(mine.map((l) => l.linear_id));
    const accepted = new Set(mine.filter((l) => l.status === 'accepted').map((l) => l.linear_id));
    const suggested = projects.filter((p) => !decided.has(p.id) && p.name).flatMap((p) => {
      const hit = terms.find((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(p.name!));
      return hit ? [{ projectId: p.id, name: p.name!, statusName: p.status_name, basis: hit }] : [];
    });
    const sug = new Set(suggested.map((s) => s.projectId));
    return {
      id: v.id, slug: v.slug, name: v.name, terms,
      linked: mine.filter((l) => l.status === 'accepted').map((l) => ({ projectId: l.linear_id, name: name.get(l.linear_id)!.name ?? 'Unnamed project',
        statusName: name.get(l.linear_id)!.status_name, by: l.by, asOf: new Date(l.as_of), source: l.source, basis: l.basis })),
      suggested,
      rejected: mine.filter((l) => l.status === 'rejected').map((l) => ({ projectId: l.linear_id, name: name.get(l.linear_id)!.name ?? 'Unnamed project' })),
      others: projects.filter((p) => !accepted.has(p.id) && !sug.has(p.id)).map((p) => ({ projectId: p.id, name: p.name ?? 'Unnamed project' })),
    };
  });
}

export type LinkDecision = 'accept' | 'reject' | 'remove';

/**
 * A person links a vehicle to a Linear project, turns a suggestion down, or removes a link. Stored
 * once per pair (a double click changes nothing), audited, and never sent to Linear.
 */
export async function decideLink(actorId: string, input: { vehicleId: string; projectIds: string[]; decision: LinkDecision; source: 'name' | 'person'; basis?: string | null }): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const v = await tx.one<{ id: string }>('select id from platform.vehicle where id = $1', [input.vehicleId]);
    if (!v) throw new Error('No such vehicle.');
    let changed = 0;
    for (const pid of [...new Set(input.projectIds)]) {
      const p = await tx.one<{ id: string }>(`select id from linear.project where id = $1 and team_ids && array${TEAMS(2)}`, [pid, teamKeys()]);
      if (!p) continue;
      if (input.decision === 'remove') {
        const r = await tx.query(`delete from linear.link where target_kind = 'vehicle' and target_id = $1 and linear_kind = 'project' and linear_id = $2 returning 1`, [v.id, pid]);
        changed += r.length;
        if (!r.length) continue;
      } else {
        const status = input.decision === 'accept' ? 'accepted' : 'rejected';
        const r = await tx.query(`insert into linear.link (target_kind, target_id, linear_kind, linear_id, status, source, basis, last_verified_by)
          values ('vehicle', $1, 'project', $2, $3, $4, $5, $6)
          on conflict (target_kind, target_id, linear_kind, linear_id) do update set status = excluded.status, source = excluded.source, basis = excluded.basis,
            as_of = now(), last_verified_by = excluded.last_verified_by
          where linear.link.status is distinct from excluded.status returning 1`, [v.id, pid, status, input.source, input.basis ?? null, actorId]);
        changed += r.length;
        if (!r.length) continue;
      }
      await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1, $2, 'linear_link', $3, $4::jsonb)`,
        [actorId, `linear.link_${input.decision}`, `${v.id}:${pid}`, JSON.stringify({ vehicle: v.id, project: pid, source: input.source, basis: input.basis ?? null })]);
    }
    return changed;
  });
}

