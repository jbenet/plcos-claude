import type { Db, Queryable } from '@/lib/db';
import { appendAudit } from '@/modules/platform';

/**
 * Possible LPs from the calendar (Juan, 13 Oct 2026: "look through calendars and figure out which may be LPs based on
 * external addrs, what the invite says, or who the external addrs are").
 *
 * The calendar read (lib/calendar-sync.ts) keeps only LP meetings. A meeting with an outside guest that no LP matched
 * leaves no touchpoint, but it may be a meeting with an LP we do not hold yet. Each read proposes those as possible LPs,
 * grouped by the outside firm (the guest's firm when we hold the guest, or the firm we hold at the guest's email domain)
 * or else by the domain itself, with the reasons to think so, strongest first:
 *   - the firm, or the person when they have no firm, has investor data on record (investor type, AUM, check size);
 *   - a guest we hold has investor data on record;
 *   - the invite speaks of a fund, LPs, investing, an allocation … (a fixed word list), or names one of our vehicles;
 *   - else only that it is an outside firm or a person we hold (weak, listed last; Juan sets the rest aside as not an LP).
 * A reason names the word from the list or our vehicle's name, never the entry's own words. Nothing else is kept beyond
 * what §13 of docs/25 keeps for an LP meeting: the date, who on the team was there, what it is about; plus each guest's
 * email domain and whether we hold them. No title, description, address or outside name.
 *
 * Nothing is added without a click: "Add as LP prospect" opens a pursuit in New with the meetings as its calendar
 * touchpoints (audited, undoable while nothing else is recorded on it), "Not an LP" is remembered so the group never
 * comes back, and "Research" asks for the usual profile workflow on the firm by its public name (a request, as the
 * pipeline's own Research action makes; nothing runs).
 *
 * Stored as research notes (the schema promotion rule, AGENTS.md): kind `calendar_candidate`, one per group, replaced on
 * each read; kind `calendar_not_lp` keeps a dismissed group's key.
 */

export interface CandidateMeeting {
  /** The occurrence's hash (lib/calendar-sync.ts keyOf): the same key the calendar touchpoints use. */
  k: string;
  day: string;
  scheduledFor: string | null;
  owner: string;
  attendees: string[];
  about: string;
  aboutVehicles: string[];
  aboutBasis: string;
  groupSize: number;
}
export type CandidateReason =
  | { kind: 'investor_data'; field: string }
  | { kind: 'known_investor'; field: string }
  | { kind: 'wording'; keyword: string }
  | { kind: 'vehicle'; vehicle: string }
  /** The weak reason (Juan, 13 Oct 2026: 2 of 59 was too strict): an outside firm or person, nothing else said. */
  | { kind: 'outside'; held: boolean };
/** A reason beyond a bare outside meeting. Strong candidates are listed first. */
export const strongReason = (r: CandidateReason) => r.kind !== 'outside';
export interface CandidateGuest { domain: string; held: 'person' | 'org' | null }
export interface Candidate {
  /** `entity:<uuid>` for a firm or person we hold, `domain:<domain>` otherwise. */
  key: string;
  entityId: string | null;
  domain: string | null;
  held: 'person' | 'org' | null;
  meetings: CandidateMeeting[];
  guests: CandidateGuest[];
  reasons: CandidateReason[];
}

/** GUESS: invite wording that suggests an LP conversation. Each is stored by its label, never as the entry's text. */
const WORDING: Array<[string, RegExp]> = [
  ['fund', /(?<![\p{L}])(funds?|fundrais\w*)(?![\p{L}])/iu],
  ['LP', /(?<![\p{L}])(LPs?|limited partners?)(?![\p{L}])/u],
  ['limited partner', /(?<![\p{L}])limited partners?(?![\p{L}])/iu],
  ['investment', /(?<![\p{L}])invest(?:ing|ment|ments|or|ors)?(?![\p{L}])/iu],
  ['allocation', /(?<![\p{L}])allocat(?:e|es|ion|ions|ing)(?![\p{L}])/iu],
  ['commitment', /(?<![\p{L}])commitments?(?![\p{L}])/iu],
  ['capital call', /(?<![\p{L}])capital calls?(?![\p{L}])/iu],
  ['data room', /(?<![\p{L}])data ?rooms?(?![\p{L}])/iu],
  ['first close', /(?<![\p{L}])first close(?![\p{L}])/iu],
  ['term sheet', /(?<![\p{L}])term sheets?(?![\p{L}])/iu],
  ['side letter', /(?<![\p{L}])side letters?(?![\p{L}])/iu],
  ['family office', /(?<![\p{L}])family office(?![\p{L}])/iu],
  ['soft circle', /(?<![\p{L}])soft circl\w*(?![\p{L}])/iu],
];
export const wordingOf = (text: string) => WORDING.filter(([, re]) => re.test(text)).map(([label]) => label);

/** Claim fields that say an entity invests (lib/enrich/schema.ts). Dakota's licensed claims are left out below. */
const INVESTOR_FIELDS = `'(^|\\.)(investor_type|aum|check_size)$'`;
const FIELD_LABEL: Record<string, string> = { investor_type: 'investor type', aum: 'assets under management', check_size: 'check size' };
const fieldLabel = (f: string) => FIELD_LABEL[f.replace(/^.*\./, '')] ?? f;

/** Words for a reason, for the page. */
export function reasonText(r: CandidateReason): string {
  switch (r.kind) {
    case 'investor_data': return `Investor data on record (${fieldLabel(r.field)})`;
    case 'known_investor': return `A guest is on record as an investor (${fieldLabel(r.field)})`;
    case 'wording': return `The invite speaks of “${r.keyword}”`;
    case 'vehicle': return `The invite names ${r.vehicle}`;
    case 'outside': return r.held ? 'On file, nothing yet says they invest' : 'Outside firm, not on file';
  }
}

/** Never an LP: a portfolio company of ours, or someone using this app (lib/reconcile, lpUniverse). */
export async function notLpEntities(q: Queryable): Promise<Set<string>> {
  const { portfolio, appUsers } = await notLpKinds(q);
  return new Set([...portfolio, ...appUsers]);
}

/** The two kinds apart, so a calendar read can say which one set a meeting aside. */
export async function notLpKinds(q: Queryable): Promise<{ portfolio: Set<string>; appUsers: Set<string> }> {
  const rows = await q.query<{ id: string; kind: string }>(`select identity.canonical_entity_id(company_entity)::text id, 'portfolio' kind from network.portfolio
      union select identity.canonical_entity_id(entity_id)::text, 'app_user' from identity.source_record where source = 'app_user'`);
  return { portfolio: new Set(rows.filter((r) => r.kind === 'portfolio').map((r) => r.id)), appUsers: new Set(rows.filter((r) => r.kind === 'app_user').map((r) => r.id)) };
}

/** The investor fields on record for each entity (canonical id → the fields, sorted). */
export async function investorFields(ids: string[], q: Queryable): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  // Never Dakota's licensed records (docs/20): a reason shown to everyone must not rest on them.
  for (const r of await q.query<{ id: string; field: string }>(`select distinct identity.canonical_entity_id(c.entity_id)::text id, regexp_replace(c.field, '^.*\\.', '') field
      from research.claim c left join research.source_doc d on d.doc_id = c.source
     where c.superseded_by is null and c.field ~ ${INVESTOR_FIELDS} and identity.canonical_entity_id(c.entity_id) = any($1::uuid[])
       and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota' order by 2`, [ids])) {
    out.set(r.id, [...(out.get(r.id) ?? []), r.field]);
  }
  return out;
}

/** The keys of every group someone said is not an LP. */
export async function dismissedKeys(q: Queryable): Promise<Set<string>> {
  return new Set((await q.query<{ key: string }>(`select data->>'key' key from research.note where kind = 'calendar_not_lp'`)).map((r) => r.key));
}

const BODY = 'Possible LP from the calendar: meetings with an outside guest no LP matched. Dates, domains and reasons only.';
const insertNotes = (q: Queryable, list: Candidate[]) => list.length ? q.query(`insert into research.note (entity_id, kind, body, data)
    select x.entity_id, 'calendar_candidate', $1, x.data from jsonb_to_recordset($2::jsonb) as x(entity_id uuid, data jsonb)`,
  [BODY, JSON.stringify(list.map((c) => ({ entity_id: c.entityId, data: c })))]) : Promise.resolve([]);

/**
 * Replace the stored candidates with this read's. After a read of every calendar the whole set is replaced; otherwise
 * only the groups this read found are, so a calendar out of reach does not make its candidates vanish.
 */
export async function storeCandidates(tx: Queryable, list: Candidate[], complete: boolean): Promise<void> {
  if (complete) await tx.query(`delete from research.note where kind = 'calendar_candidate'`);
  else await tx.query(`delete from research.note where kind = 'calendar_candidate' and data->>'key' = any($1::text[])`, [list.map((c) => c.key)]);
  await insertNotes(tx, list);
}

export interface CandidateRow extends Candidate { name: string | null; entityType: string | null }

/** The stored candidates, most meetings first, with the held firm's or person's name. */
export async function listCandidates(q: Queryable): Promise<CandidateRow[]> {
  const rows = await q.query<{ data: Candidate; name: string | null; type: string | null }>(`select n.data, e.display_name name, e.entity_type::text type
      from research.note n left join identity.entity e on e.entity_id = identity.canonical_entity_id(n.entity_id)
     where n.kind = 'calendar_candidate'
       and not exists (select 1 from research.note d where d.kind = 'calendar_not_lp' and d.data->>'key' = n.data->>'key')
       -- The entity's aliases, then their pursuits by index: not canonical_entity_id() on every pursuit (15 Oct 2026: 55 → 5 ms).
       and not (n.entity_id is not null and exists (select 1 from identity.alias_pairs(array[identity.canonical_entity_id(n.entity_id)]) a
         join strategy.active_pursuit p on p.entity_id = a.entity_id))`);
  return rows.map((r) => ({ ...r.data, name: r.name, entityType: r.type }))
    .sort((a, b) => Number(b.reasons.some(strongReason)) - Number(a.reasons.some(strongReason)) || b.meetings.length - a.meetings.length || (b.meetings.at(-1)?.day ?? '').localeCompare(a.meetings.at(-1)?.day ?? '') || a.key.localeCompare(b.key));
}

async function candidateOf(q: Queryable, key: string): Promise<Candidate | null> {
  return (await q.one<{ data: Candidate }>(`select data from research.note where kind = 'calendar_candidate' and data->>'key' = $1 order by created_at desc limit 1`, [key]))?.data ?? null;
}

const KEY_RE = /^(entity:[0-9a-f-]{36}|domain:[a-z0-9.-]{3,253})$/;
export class CandidateRefused extends Error {}

/** "Not an LP": remembered for good; no later read proposes the group again. */
export async function dismissCandidate(db: Db, actor: string, key: string): Promise<void> {
  if (!KEY_RE.test(key)) throw new CandidateRefused('That possible LP is no longer listed. Reload the page.');
  await db.transaction(async (tx) => {
    const c = await candidateOf(tx, key);
    if (await tx.one(`select 1 from research.note where kind = 'calendar_not_lp' and data->>'key' = $1`, [key])) return;
    await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'calendar_not_lp', 'Not an LP: a possible LP from the calendar, set aside.', $3)`,
      [c?.entityId ?? null, actor, JSON.stringify({ key })]);
    await tx.query(`delete from research.note where kind = 'calendar_candidate' and data->>'key' = $1`, [key]);
    await appendAudit({ actorId: actor, action: 'calendar.candidate_dismissed', subjectType: c?.entityId ? 'entity' : 'source', subjectId: c?.entityId ?? undefined, detail: { key } }, tx);
  });
}

export interface AddResult { pursuitId: string; entityId: string; meetings: number; created: boolean }

/**
 * "Add as LP prospect": a pursuit in New for that vehicle, set by the person who clicked, with the candidate's meetings
 * as its calendar touchpoints (the same rows and references the calendar read writes, so the next read keeps them).
 * A group known only by its domain needs the firm's name: the firm is then held (modules/identity, by name and domain)
 * with the domain as an email-domain claim, so the next read finds the firm by it. Audited with the request key: the
 * same key again returns the same pursuit; nothing is duplicated.
 */
export async function addCandidate(db: Db, actor: string, input: { key: string; vehicleId: string; requestKey: string; firmName?: string }): Promise<AddResult> {
  if (!KEY_RE.test(input.key)) throw new CandidateRefused('That possible LP is no longer listed. Reload the page.');
  if (!input.requestKey || input.requestKey.length > 100) throw new CandidateRefused('Reload the page to obtain a request key.');
  return db.transaction(async (tx) => {
    const again = await tx.one<{ detail: { entityId: string; meetings: string[] }; subject_id: string }>(`select detail, subject_id from platform.audit_log
        where action = 'pursuit.calendar_added' and actor_id = $1 and detail->>'requestKey' = $2 limit 1`, [actor, input.requestKey]);
    if (again) return { pursuitId: again.subject_id, entityId: again.detail.entityId, meetings: again.detail.meetings.length, created: false };
    const c = await candidateOf(tx, input.key);
    if (!c || await tx.one(`select 1 from research.note where kind = 'calendar_not_lp' and data->>'key' = $1`, [input.key])) {
      throw new CandidateRefused('That possible LP is no longer listed: a later calendar read or a teammate changed it. Reload the page.');
    }
    const v = await tx.one<{ id: string; name: string; phase: string; kind: string }>(`select id::text, name, phase, kind from platform.vehicle where id = $1`, [input.vehicleId]);
    if (!v || v.phase !== 'active') throw new CandidateRefused('Choose a vehicle being raised.');
    if (v.kind === 'grant_rail') throw new CandidateRefused('The grants rail takes funders by invitation only; add a fund or an SPV.');
    let entityId = c.entityId, createdEntity = false;
    if (!entityId) {
      const name = (input.firmName ?? '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 200) throw new CandidateRefused(`Type the name of the firm at ${c.domain} first.`);
      const { resolveEntity } = await import('@/modules/identity/create');
      const made = await resolveEntity(tx, { type: 'org', name, source: 'calendar-domain', sourceId: c.domain!, domains: [c.domain!], resolvedBy: `human:${actor}` });
      entityId = made.id;
      createdEntity = made.created;
      await tx.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
          values ('calendar:guest-domain', 'Calendar guests'' email domains', 'calendar', 'calendar', current_date, 'weak',
                  'That a firm''s people write from this email domain, as a person on the team said when adding the firm from a calendar meeting.', '')
          on conflict (doc_id) do nothing`);
      if (!await tx.one(`select 1 from research.claim where identity.canonical_entity_id(entity_id) = $1 and field = 'email_domain' and lower(value) = $2 and superseded_by is null`, [entityId, c.domain])) {
        await tx.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
            values ($1, 'email_domain', $2, 'calendar:guest-domain', current_date, 'medium', $3, now())`, [entityId, c.domain, actor]);
      }
    }
    const canon = (await tx.one<{ id: string }>(`select identity.canonical_entity_id($1::uuid)::text id`, [entityId]))!.id;
    if ((await notLpEntities(tx)).has(canon)) throw new CandidateRefused('That is a portfolio company of ours or someone using this app, never an LP.');
    const pursuit = await tx.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, status_source, status_reason, status_set_at, status_set_by, source)
        values ($1, $2, $3, 'new', 'us', 'Added from the calendar as a possible LP.', now(), $3, 'calendar')
        on conflict (entity_id, vehicle_id) do nothing returning pursuit_id::text id`, [canon, v.id, actor]);
    if (!pursuit) throw new CandidateRefused(`Already in the pipeline for ${v.name}.`);
    const rows = c.meetings.map((m) => ({ entity_id: canon, held_on: m.scheduledFor ? null : m.day, scheduled_for: m.scheduledFor, owner_id: m.owner, attendees: m.attendees,
      ref: `event:${m.k}:${canon}`, about: m.about, about_vehicles: m.aboutVehicles, about_basis: m.aboutBasis, group_size: m.groupSize }));
    const made = rows.length ? await tx.query<{ ref: string }>(`insert into meetings.meeting
        (entity_id, channel, direction, held_on, scheduled_for, owner_id, attendees, source, source_ref, about, about_vehicles, about_basis, about_by, group_size)
      select x.entity_id, 'meeting', 'both', x.held_on, x.scheduled_for, x.owner_id, x.attendees, 'calendar', x.ref, x.about, x.about_vehicles, x.about_basis, 'rule', x.group_size
        from jsonb_to_recordset($1::jsonb) as x(entity_id uuid, held_on date, scheduled_for timestamptz, owner_id uuid, attendees text[], ref text,
                                                about text, about_vehicles text[], about_basis text, group_size int)
      on conflict (source, source_ref) where source_ref is not null do nothing returning source_ref ref`, [JSON.stringify(rows)]) : [];
    await tx.query(`delete from research.note where kind = 'calendar_candidate' and data->>'key' = $1`, [input.key]);
    await appendAudit({ actorId: actor, action: 'pursuit.calendar_added', subjectType: 'pursuit', subjectId: pursuit.id,
      detail: { requestKey: input.requestKey, key: input.key, entityId: canon, createdEntity, vehicleId: v.id, to: 'New', statusSource: 'us', meetings: made.map((m) => m.ref), candidate: c } }, tx);
    return { pursuitId: pursuit.id, entityId: canon, meetings: made.length, created: true };
  });
}

/**
 * Undo "Add as LP prospect": the pursuit and the touchpoints it brought go, and the possible LP is listed again. Refused
 * once anything else is recorded on the pursuit (an update, a rung, a contact, a draft) or its status moved: then set
 * its status to Passed instead, which keeps the record.
 */
export async function undoCandidateAdd(db: Db, actor: string, pursuitId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(pursuitId)) throw new CandidateRefused('Nothing to undo.');
  try {
    await db.transaction(async (tx) => {
      const a = await tx.one<{ id: number | string; detail: { meetings: string[]; candidate: Candidate; key: string } }>(`select id, detail from platform.audit_log
          where action = 'pursuit.calendar_added' and subject_id = $1 order by at desc limit 1`, [pursuitId]);
      if (!a) throw new CandidateRefused('That pursuit was not added from the calendar.');
      const p = await tx.one<{ status: string }>(`select status::text from strategy.pursuit where pursuit_id = $1 for update`, [pursuitId]);
      if (!p) throw new CandidateRefused('Already undone.');
      if (p.status !== 'new') throw new CandidateRefused('Its status has moved since; set it to Passed instead.');
      await tx.query(`delete from meetings.meeting where source = 'calendar' and source_ref = any($1::text[])`, [a.detail.meetings]);
      await tx.query(`delete from strategy.pursuit where pursuit_id = $1`, [pursuitId]);
      if (!await tx.one(`select 1 from research.note where kind = 'calendar_candidate' and data->>'key' = $1`, [a.detail.key])) await insertNotes(tx, [a.detail.candidate]);
      await appendAudit({ actorId: actor, action: 'pursuit.calendar_added_undone', subjectType: 'pursuit', subjectId: pursuitId, detail: { key: a.detail.key, meetings: a.detail.meetings } }, tx);
    });
  } catch (e) {
    if (e instanceof CandidateRefused) throw e;
    if (/foreign key/i.test(e instanceof Error ? e.message : '')) throw new CandidateRefused('Something has been recorded on it since; set its status to Passed instead.');
    throw e;
  }
}

/**
 * "Research": the usual profile workflow (docs/workflows/w1-profile.md) asked for on the firm, by its public name only,
 * as the pipeline's Research action asks: a request saved for review, nothing scheduled or run. Only for a firm or person
 * we hold; a group known only by its domain has no name to research. The request key makes a second click a no-op.
 */
export async function researchCandidate(db: Db, actor: string, key: string, requestKey: string): Promise<{ created: boolean }> {
  if (!/^entity:[0-9a-f-]{36}$/.test(key)) throw new CandidateRefused('Only a firm or person we hold can be researched by name; add the firm first.');
  if (!requestKey || requestKey.length > 100) throw new CandidateRefused('Reload the page to obtain a request key.');
  return db.transaction(async (tx) => {
    const entityId = key.slice('entity:'.length);
    if (await tx.one(`select 1 from research.note where kind = 'workflow_request' and data->>'requestKey' = $1`, [requestKey])) return { created: false };
    if (await tx.one(`select 1 from research.note where kind = 'workflow_request' and identity.canonical_entity_id(entity_id) = identity.canonical_entity_id($1::uuid)
        and data->>'workflow' = 'research' and data->>'execution' = 'not_started'`, [entityId])) return { created: false };
    await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'workflow_request', $3, $4)`,
      [entityId, actor, 'Workflow request: research. Awaiting review; not scheduled or running.\nA possible LP from the calendar: profile the firm by its public name only.',
        JSON.stringify({ workflow: 'research', status: 'requested', execution: 'not_started', from: 'calendar_candidate', key, requestKey, publicNameOnly: true })]);
    await appendAudit({ actorId: actor, action: 'calendar.candidate_research', subjectType: 'entity', subjectId: entityId, detail: { key, requestKey } }, tx);
    return { created: true };
  });
}

export interface RecentAdd { pursuitId: string; name: string; vehicle: string; at: Date; meetings: number }

/** Added from the calendar in the last fortnight and still in New, newest first: the page offers Undo on each. */
export async function recentAdds(q: Queryable, vehicleId: string | null): Promise<RecentAdd[]> {
  const rows = await q.query<{ id: string; name: string; vehicle: string; at: Date; n: number }>(`select p.pursuit_id::text id, e.display_name name, v.name vehicle, a.at,
        jsonb_array_length(a.detail->'meetings')::int n
      from platform.audit_log a join strategy.pursuit p on p.pursuit_id::text = a.subject_id and p.status = 'new'
      join identity.entity e on e.entity_id = p.entity_id join platform.vehicle v on v.id = p.vehicle_id
     where a.action = 'pursuit.calendar_added' and a.at > now() - interval '14 days' and ($1::uuid is null or p.vehicle_id = $1::uuid)
     order by a.at desc limit 20`, [vehicleId]);
  return rows.map((r) => ({ pursuitId: r.id, name: r.name, vehicle: r.vehicle, at: new Date(r.at), meetings: r.n }));
}

/** When the calendar was last read, and whether the latest read failed: the section says so rather than look fresh. */
export async function lastCalendarRead(q: Queryable): Promise<{ at: Date | null; failed: boolean }> {
  const ok = await q.one<{ at: Date }>(`select finished_at at from sources.sync_run where source = 'calendar' and status = 'ok' order by id desc limit 1`);
  const latest = await q.one<{ status: string }>(`select status from sources.sync_run where source = 'calendar' and status <> 'running' order by id desc limit 1`);
  return { at: ok?.at ? new Date(ok.at) : null, failed: latest?.status === 'failed' };
}
