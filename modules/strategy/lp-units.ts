import type { Db, Queryable } from '@/lib/db';
import { absorbPursuits, inserted, lockMergeTables, pursuitReferences, restoreChanges, write, type Change, type Reference, type Row } from './merge';
import { combineStatus, decideLpUnit, isPseudoOrg, INVESTING_NAME, LP_RULE, type Evidence, type Firm, type LpDecision } from './lp-unit-rules';
import { STATUS_LABEL, type PursuitStatus } from './types';

/**
 * Re-point pursuits to their LP (issues 0111, 0112; docs/23-lp-units.md). Every active person's
 * pursuit on a vehicle being raised is read against the rules in lp-unit-rules.ts:
 *   - evidence of investing on their own account keeps it, marked capacity personal;
 *   - an open affiliation with one investing organisation and no such evidence moves it to that
 *     organisation's pursuit (created when missing), carrying status, owner, history, strategy
 *     links and notes, and leaves the person as a contact on it;
 *   - anything else stays where it is, flagged for a person to decide.
 * Every decision is one journalled row in strategy.lp_repoint, reversed by compare-and-restore.
 * A reversed decision, or one a person made, is never re-applied by the rule. No status a person
 * set is lowered, and money, rungs and fit readings are never moved between people.
 */

export interface LpUnitDecisionRow {
  id: string; decision: 'moved' | 'personal' | 'review'; decidedBy: 'rule' | 'person';
  pursuitId: string; person: string; personId: string; vehicleId: string; vehicle: string;
  org: string | null; orgPursuitId: string | null; created: boolean; reason: string;
}
export interface LpUnitReport {
  examined: number; moved: number; created: number; personal: number; review: number;
  unaffiliated: number; unchanged: number; reversedBefore: number; decidedByPerson: number;
  decisions: LpUnitDecisionRow[];
}

/** Investor types whose money is the organisation's (docs/19, W1's investorType; lib/lp-heading.ts). */
const ORG_MONEY = new Set(['fund_lp_program', 'fo_staff', 'institutional', 'corporate', 'foundation']);
const HIGH_RUNGS = ['indication_given', 'commitment_accepted', 'cash_received'];
const ANGEL = /\b(angel|personal(?:ly)?|own (?:account|money|capital|behalf)|individual(?:ly)?|in (?:his|her|their) own name)\b/i;
const REPORTED = 300;

type Candidate = {
  id: string; person: string; person_name: string; vehicle: string; vehicle_name: string;
  status: PursuitStatus; human: boolean; lp_capacity: string | null; lp_review: string | null;
};
type Facts = {
  firms: Map<string, Firm[]>; personal: Map<string, Evidence[]>; foPrincipal: Set<string>; orgMoney: Set<string>;
  softHere: Set<string>; highRung: Set<string>; units: Map<string, string>;
};

const lockAll = async (tx: Queryable, refs: Reference[]) =>
  lockMergeTables(tx, refs, ['strategy.lp_repoint', 'identity.affiliation', 'pipeline.exposure']);

async function candidates(tx: Queryable, only?: string): Promise<Candidate[]> {
  return tx.query<Candidate>(`select p.pursuit_id::text id, e.entity_id::text person, e.display_name person_name,
      p.vehicle_id::text vehicle, v.name vehicle_name, p.status::text status,
      (p.status_source='us' or strategy.pursuit_has_human_status(p.pursuit_id)) human, p.lp_capacity, p.lp_review
    from strategy.active_pursuit p join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    join platform.vehicle v on v.id=p.vehicle_id
    where e.entity_type='person' and e.retired_at is null and v.phase='active' and v.kind<>'grant_rail'
      and ($1::uuid is null or p.pursuit_id=$1::uuid)
    order by v.sort_order, e.display_name, p.pursuit_id`, [only ?? null]);
}

/** Everything the rules read, for a batch of people, in a handful of queries. */
async function gather(tx: Queryable, list: Candidate[]): Promise<Facts> {
  const people = [...new Set(list.map(c => c.person))], pursuits = list.map(c => c.id);
  const aliases = `with recursive alias as (
      select entity_id, entity_id person from identity.entity where entity_id=any($1::uuid[])
      union all select e.entity_id, a.person from identity.entity e join alias a on e.merged_into=a.entity_id)`;
  const [affiliations, claims, profiles, prospects, money, rungs, units] = await Promise.all([
    tx.query<{ person: string; org: string; name: string; type: string; role: string | null; primary: boolean; source: string | null }>(
      `${aliases} select a.person::text, o.entity_id::text org, o.display_name name, o.entity_type::text type, f.role, f.is_primary "primary", f.source
        from identity.affiliation f join alias a on a.entity_id=f.person_entity
        join identity.entity o on o.entity_id=identity.canonical_entity_id(f.org_entity)
        where f.ended_on is null and o.retired_at is null and o.entity_type<>'person'
        order by a.person, f.is_primary desc, f.as_of desc nulls last`, [people]),
    tx.query<{ person: string; field: string; value: string; id: string }>(
      `${aliases} select a.person::text, c.field, c.value, c.claim_id::text id from research.claim c join alias a on a.entity_id=c.entity_id
        where c.field in ('public.investment','public.fund_lp','public.investor_type') and c.confidence<>'low'`, [people]),
    tx.query<{ person: string; t: string | null }>(
      `${aliases} select distinct on (a.person) a.person::text, n.data->'profile'->>'investorType' t from research.note n join alias a on a.entity_id=n.entity_id
        where n.kind='public_profile' order by a.person, n.created_at desc`, [people]),
    tx.query<{ person: string; org: string | null; id: string }>(
      `${aliases} select a.person::text, n.data->>'org' org, n.note_id::text id from research.note n join alias a on a.entity_id=n.entity_id
        where n.data->>'source'='prospects' and coalesce(n.data->>'entityType','person')='person'`, [people]),
    tx.query<{ person: string; vehicle: string; name: string; track: string }>(
      `${aliases} select a.person::text, x.vehicle_id::text vehicle, v.name, x.track::text track from pipeline.exposure x
        join alias a on a.entity_id=x.entity_id join platform.vehicle v on v.id=x.vehicle_id`, [people]),
    tx.query<{ id: string }>(`select distinct pursuit_id::text id from strategy.ladder_event where pursuit_id=any($1::uuid[]) and rung::text=any($2::text[])`, [pursuits, HIGH_RUNGS]),
    tx.query<{ id: string; unit: string | null }>(
      `select distinct on (s.pursuit_id) s.pursuit_id::text id, s.data->'ask'->>'unit' unit from strategy.suggestion s
        where s.pursuit_id=any($1::uuid[]) and s.status in ('proposed','accepted') order by s.pursuit_id, s.created_at desc, s.suggestion_id`, [pursuits]),
  ]);
  const orgIds = [...new Set(affiliations.map(a => a.org))];
  const [lps, monies, dakota, derived] = await Promise.all([
    tx.query<{ id: string }>(`select distinct identity.canonical_entity_id(entity_id)::text id from strategy.active_pursuit`),
    tx.query<{ id: string }>(`select distinct identity.canonical_entity_id(entity_id)::text id from pipeline.exposure
      union select distinct identity.canonical_entity_id(entity_id)::text from pipeline.capital_pool`),
    tx.query<{ id: string }>(`select distinct identity.canonical_entity_id(entity_id)::text id from identity.source_record where source='dakota'
      and identity.canonical_entity_id(entity_id)=any($1::uuid[])`, [orgIds]),
    tx.query<{ person: string; org: string }>(`select identity.canonical_entity_id(person_entity)::text person, identity.canonical_entity_id(org_entity)::text org
      from identity.affiliation where source like 'investing-organization:%' and ended_on is null`),
  ]);
  const isLp = new Set(lps.map(r => r.id)), hasMoney = new Set(monies.map(r => r.id)), inDakota = new Set(dakota.map(r => r.id));
  const researched = new Set(derived.map(r => `${r.person}:${r.org}`));
  const facts: Facts = { firms: new Map(), personal: new Map(), foPrincipal: new Set(), orgMoney: new Set(), softHere: new Set(), highRung: new Set(rungs.map(r => r.id)), units: new Map() };
  const add = (person: string, e: Evidence) => {
    const list = facts.personal.get(person) ?? [];
    if (!list.some(x => x.kind === e.kind)) list.push(e);
    facts.personal.set(person, list);
  };
  for (const p of profiles) {
    if (p.t === 'angel') add(p.person, { kind: 'profile_angel', label: 'Research profile: an angel investor' });
    if (p.t === 'fo_principal') facts.foPrincipal.add(p.person);
    if (p.t && ORG_MONEY.has(p.t)) facts.orgMoney.add(p.person);
  }
  const angel = new Map<string, number>(), lp = new Map<string, number>();
  for (const c of claims) {
    if (c.field === 'public.investor_type' && /^\s*angel\b/i.test(c.value)) add(c.person, { kind: 'profile_angel', label: 'Research profile: an angel investor', ref: `claim:${c.id}` });
    if (c.field === 'public.investment' && ANGEL.test(c.value)) angel.set(c.person, (angel.get(c.person) ?? 0) + 1);
    if (c.field === 'public.fund_lp' && ANGEL.test(c.value)) lp.set(c.person, (lp.get(c.person) ?? 0) + 1);
  }
  for (const [person, k] of angel) add(person, { kind: 'angel_deals', label: `${k} angel or personal ${k === 1 ? 'investment' : 'investments'} on record` });
  for (const [person, k] of lp) add(person, { kind: 'personal_lp', label: `${k} personal fund ${k === 1 ? 'commitment' : 'commitments'} on record` });
  for (const p of prospects) if (isPseudoOrg(p.org)) add(p.person, { kind: 'prospect_personal', label: 'A prospect row names them without a firm', ref: `note:${p.id}` });
  for (const m of money) {
    if (m.track === 'hard') add(m.person, { kind: 'signed_personally', label: `A signed commitment in their own name (${m.name})` });
    else facts.softHere.add(`${m.person}:${m.vehicle}`);
  }
  for (const u of units) if (u.unit?.trim()) facts.units.set(u.id, u.unit.trim());
  for (const a of affiliations) {
    const list = facts.firms.get(a.person) ?? [];
    const had = list.find(f => f.orgId === a.org);
    if (had) { had.primary ||= a.primary; had.role ??= a.role; continue; }
    const investing = a.type === 'family' ? 'a family office' : a.type === 'foundation' ? 'a foundation'
      : inDakota.has(a.org) ? 'an allocator on record in Dakota'
      : researched.has(`${a.person}:${a.org}`) ? 'research found that it invests'
      : hasMoney.has(a.org) ? 'money is on record in its name'
      : isLp.has(a.org) ? 'an LP we pursue'
      : INVESTING_NAME.test(a.name) ? 'its name says it manages money' : null;
    list.push({ orgId: a.org, name: a.name, type: a.type, role: a.role, primary: a.primary, investing });
    facts.firms.set(a.person, list);
  }
  // A research profile that reads their money as the organisation's makes their main firm investing.
  for (const person of facts.orgMoney) {
    const list = (facts.firms.get(person) ?? []).filter(f => !isPseudoOrg(f.name));
    const main = list.find(f => f.primary) ?? (list.length === 1 ? list[0] : undefined);
    if (main && !main.investing) main.investing = 'their research profile reads the money as the organisation’s';
  }
  return facts;
}

const decide = (c: Candidate, f: Facts): LpDecision => {
  const unit = f.units.get(c.id) ?? null;
  const firms = (f.firms.get(c.person) ?? []).map(x => ({ ...x }));
  // A strategy naming a firm as the unit that commits makes that firm investing.
  if (unit && !/^\s*personal\b/i.test(unit)) for (const x of firms) {
    const n = x.name.toLowerCase();
    if (!x.investing && n.length > 1 && unit.toLowerCase().includes(n)) x.investing = 'the strategy names it as the unit that commits';
  }
  return decideLpUnit({
    personal: f.personal.get(c.person) ?? [], firms, unit, foPrincipal: f.foPrincipal.has(c.person),
    moneyHere: f.softHere.has(`${c.person}:${c.vehicle}`), highRung: f.highRung.has(c.id),
  });
};

async function journal(tx: Queryable, c: Candidate, d: { decision: 'moved' | 'personal' | 'review'; reason: string; evidence: Evidence[] },
  by: 'rule' | 'person', actorId: string | null, changes: Change[], org: { id: string; name: string; pursuitId: string; created: boolean } | null): Promise<LpUnitDecisionRow> {
  const row = (await tx.one<{ id: string }>(`insert into strategy.lp_repoint(pursuit_id,person_entity,vehicle_id,decision,decided_by,org_entity,org_pursuit_id,
      created_org_pursuit,reason,evidence,rule,actor_id,changes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb) returning id::text`,
    [c.id, c.person, c.vehicle, d.decision, by, org?.id ?? null, org?.pursuitId ?? null, org?.created ?? false, d.reason,
      JSON.stringify(d.evidence), LP_RULE, actorId, JSON.stringify(changes)]))!;
  await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'pursuit.lp_unit','pursuit',$2,$3::jsonb)`,
    [actorId, org?.pursuitId ?? c.id, JSON.stringify({ rule: LP_RULE, decision: d.decision, decidedBy: by, repointId: row.id, personPursuitId: c.id,
      orgPursuitId: org?.pursuitId ?? null, createdOrgPursuit: org?.created ?? false, reason: d.reason })]);
  return { id: row.id, decision: d.decision, decidedBy: by, pursuitId: c.id, person: c.person_name, personId: c.person, vehicleId: c.vehicle,
    vehicle: c.vehicle_name, org: org?.name ?? null, orgPursuitId: org?.pursuitId ?? null, created: org?.created ?? false, reason: d.reason };
}

const pursuitRow = async (tx: Queryable, id: string) =>
  (await tx.one<{ row: Row }>('select to_jsonb(p) row from strategy.pursuit p where pursuit_id=$1', [id]))!.row;

/** Mark a person's pursuit: capacity personal, or a question for a person. */
async function mark(tx: Queryable, c: Candidate, d: { decision: 'personal' | 'review'; reason: string; evidence: Evidence[] },
  by: 'rule' | 'person', actorId: string | null): Promise<LpUnitDecisionRow> {
  const changes: Change[] = [];
  await write(tx, changes, 'strategy.pursuit', await pursuitRow(tx, c.id),
    d.decision === 'personal' ? { lp_capacity: 'personal', lp_review: null } : { lp_capacity: null, lp_review: d.reason });
  return journal(tx, c, d, by, actorId, changes, null);
}

const STATUS_FIELDS = ['status', 'status_source', 'status_reason', 'passed_by', 'status_set_at', 'status_set_by', 'status_said', 'closed_at', 'close_reason'] as const;

/**
 * Move a person's pursuit to an organisation's: the organisation's pursuit in this vehicle, created
 * from the person's when there is none. Returns null with a reason when statuses conflict.
 */
async function move(tx: Queryable, refs: Reference[], c: Candidate, firm: Firm, d: { reason: string; evidence: Evidence[] },
  by: 'rule' | 'person', actorId: string | null): Promise<LpUnitDecisionRow | { conflict: string }> {
  const person = await pursuitRow(tx, c.id);
  const existing = await tx.one<{ id: string; human: boolean }>(`select p.pursuit_id::text id,
      (p.status_source='us' or strategy.pursuit_has_human_status(p.pursuit_id)) human
    from strategy.active_pursuit p where identity.canonical_entity_id(p.entity_id)=$1::uuid and p.vehicle_id=$2
    order by (p.entity_id=$1::uuid) desc, p.opened_at, p.pursuit_id limit 1`, [firm.orgId, c.vehicle]);
  if (!existing && await tx.one('select 1 from strategy.pursuit where entity_id=$1 and vehicle_id=$2', [firm.orgId, c.vehicle])) {
    return { conflict: `${firm.name}'s earlier pursuit in this vehicle was merged into another; resolve it by hand.` };
  }
  const org = existing ? await pursuitRow(tx, existing.id) : null;
  const pick = combineStatus({ status: c.status, human: c.human },
    org ? { status: org.status as PursuitStatus, human: existing!.human } : null);
  if (pick.conflict) return { conflict: pick.conflict };
  const changes: Change[] = [];
  let orgId: string;
  if (!org) {
    const created = (await tx.one<{ row: Row }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,headline,plan,opened_at,status,status_source,
        status_reason,passed_by,status_set_at,status_set_by,status_said,implied,next_step,next_step_on,source,source_ref,source_as_of,stage_said,owner_said,
        closed_at,close_reason,lp_capacity)
      select $1,vehicle_id,owner_id,headline,'[]'::jsonb,opened_at,status,status_source,status_reason,passed_by,status_set_at,status_set_by,status_said,
        implied,next_step,next_step_on,source,source_ref,source_as_of,stage_said,owner_said,closed_at,close_reason,'organisation'
      from strategy.pursuit where pursuit_id=$2 returning to_jsonb(pursuit) row`, [firm.orgId, c.id]))!.row;
    await inserted(tx, changes, 'strategy.pursuit', created);
    orgId = String(created.pursuit_id);
  } else {
    orgId = String(org.pursuit_id);
    const patch: Row = {};
    if (pick.from === 'person' && org.status !== person.status) for (const k of STATUS_FIELDS) patch[k] = person[k];
    if (!org.headline && person.headline) patch.headline = person.headline;
    if (!org.next_step && person.next_step) { patch.next_step = person.next_step; patch.next_step_on = person.next_step_on; }
    if (Object.keys(patch).length) {
      await write(tx, changes, 'strategy.pursuit', org, patch);
      if (patch.status) await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'pursuit.status_set','pursuit',$2,$3::jsonb)`,
        [actorId, orgId, JSON.stringify({ from: STATUS_LABEL[org.status as PursuitStatus], to: STATUS_LABEL[person.status as PursuitStatus],
          fromId: org.status, toId: person.status, statusSource: 'rule', rule: LP_RULE,
          reason: `Carried from ${c.person_name}'s pursuit when it was re-pointed to ${firm.name} as the LP.` })]);
    }
  }
  await absorbPursuits(tx, changes, refs, orgId, [person], actorId, LP_RULE, 'losers', (row, owner) =>
    `Re-pointed to ${firm.name} as the LP (docs/23): ${c.person_name} is a contact here${firm.role ? ` (${firm.role})` : ''}. `
    + `Their pursuit ${row.pursuit_id}: owner ${owner}${row.owner_said ? ` (${row.owner_said})` : ''}, status ${row.status}. ${row.headline ?? ''}`
    + `${row.next_step ? ` Next step: ${row.next_step}${row.next_step_on ? ` (${row.next_step_on})` : ''}.` : ''}`);
  const contact = (await tx.one<{ row: Row }>(`insert into strategy.pursuit_contact(pursuit_id,person_entity,role,origin_pursuit_id,source,created_by)
    values($1,$2,$3,$4,$5,$6) returning to_jsonb(pursuit_contact) row`, [orgId, c.person, firm.role, c.id, LP_RULE, by === 'person' ? actorId : null]))!.row;
  await inserted(tx, changes, 'strategy.pursuit_contact', contact);
  return journal(tx, c, { decision: 'moved', reason: d.reason, evidence: d.evidence }, by, actorId, changes,
    { id: firm.orgId, name: firm.name, pursuitId: orgId, created: !org });
}

/** The rule pass over every person's pursuit. Idempotent: an unchanged reading writes nothing. */
export async function repointPursuitsInTransaction(tx: Queryable, actorId: string | null): Promise<LpUnitReport> {
  const refs = await pursuitReferences(tx);
  await lockAll(tx, refs);
  const report: LpUnitReport = { examined: 0, moved: 0, created: 0, personal: 0, review: 0, unaffiliated: 0, unchanged: 0, reversedBefore: 0, decidedByPerson: 0, decisions: [] };
  const list = await candidates(tx);
  const last = new Map((await tx.query<{ id: string; by: string; reversed: boolean }>(`select distinct on (pursuit_id) pursuit_id::text id, decided_by by,
      reversed_at is not null reversed from strategy.lp_repoint where pursuit_id=any($1::uuid[]) order by pursuit_id, created_at desc, id`,
    [list.map(c => c.id)])).map(r => [r.id, r]));
  const facts = await gather(tx, list);
  const note = (row: LpUnitDecisionRow) => { if (report.decisions.length < REPORTED) report.decisions.push(row); };
  for (const c of list) {
    report.examined++;
    const prior = last.get(c.id);
    // A reversal, or a person's decision, is theirs: the rule never re-applies over it.
    if (prior?.reversed) { report.reversedBefore++; continue; }
    if (prior?.by === 'person') { report.decidedByPerson++; continue; }
    const d = decide(c, facts);
    if (d.decision === 'unaffiliated') { report.unaffiliated++; continue; }
    if (d.decision === 'personal') {
      if (c.lp_capacity === 'personal' && !c.lp_review) { report.unchanged++; continue; }
      note(await mark(tx, c, d, 'rule', actorId)); report.personal++; continue;
    }
    if (d.decision === 'review') {
      if (!c.lp_capacity && c.lp_review === d.reason) { report.unchanged++; continue; }
      note(await mark(tx, c, d, 'rule', actorId)); report.review++; continue;
    }
    const moved = await move(tx, refs, c, d.firm, d, 'rule', actorId);
    if ('conflict' in moved) {
      if (!c.lp_capacity && c.lp_review === moved.conflict) { report.unchanged++; continue; }
      note(await mark(tx, c, { decision: 'review', reason: moved.conflict, evidence: [] }, 'rule', actorId)); report.review++; continue;
    }
    note(moved); report.moved++; if (moved.created) report.created++;
  }
  return report;
}
export const repointPursuits = (db: Db, actorId: string | null) => db.transaction(tx => repointPursuitsInTransaction(tx, actorId));

/**
 * A person's own answer to "who is the LP?" for one person's pursuit (the LP page): personal, or an
 * organisation they are affiliated with. Journalled and reversible like the rule's, and the rule
 * never overrides it. A status conflict is refused with its reason, nothing written.
 */
export async function decideLpUnitByPerson(db: Db, pursuitId: string, actorId: string, choice: { kind: 'personal' } | { kind: 'firm'; orgId: string }): Promise<LpUnitDecisionRow> {
  return db.transaction(async tx => {
    const refs = await pursuitReferences(tx);
    await lockAll(tx, refs);
    const [c] = await candidates(tx, pursuitId);
    if (!c) throw new Error('Only a person’s pursuit on a vehicle being raised can be re-pointed.');
    if (choice.kind === 'personal') return mark(tx, c, { decision: 'personal', reason: 'A person decided they invest here in their own capacity.', evidence: [] }, 'person', actorId);
    const firm = ((await gather(tx, [c])).firms.get(c.person) ?? []).find(f => f.orgId === choice.orgId);
    if (!firm || isPseudoOrg(firm.name)) throw new Error('That organisation is not a current affiliation of theirs.');
    const moved = await move(tx, refs, c, firm, { reason: `A person decided ${firm.name} is the LP.`, evidence: [] }, 'person', actorId);
    if ('conflict' in moved) throw new Error(moved.conflict);
    return moved;
  });
}

/** Compare-and-restore, like a merge reversal. Undo a later re-point into the same LP first. */
export async function reverseLpRepoint(db: Db, id: string, actorId: string, reason: string): Promise<boolean> {
  if (!reason.trim()) throw new Error('A reversal reason is required');
  return db.transaction(async tx => {
    await lockAll(tx, await pursuitReferences(tx));
    const row = await tx.one<{ pursuit_id: string; org_pursuit_id: string | null; changes: Change[]; reversed_at: unknown }>('select * from strategy.lp_repoint where id=$1 for update', [id]);
    if (!row) throw new Error('Re-point not found');
    if (row.reversed_at) return false;
    await restoreChanges(tx, row.changes, 'reverse the later re-points and merges into the same LP first');
    await tx.query('update strategy.lp_repoint set reversed_at=now(),reversed_by=$2,reversal_reason=$3 where id=$1', [id, actorId, reason]);
    await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'pursuit.lp_unit_reversed','pursuit',$2,$3::jsonb)`,
      [actorId, row.pursuit_id, JSON.stringify({ rule: LP_RULE, repointId: id, orgPursuitId: row.org_pursuit_id, reason })]);
    return true;
  });
}

/** The latest decisions, newest first, for the enrichment page's report and its reversals. */
export async function recentLpRepoints(limit = 200): Promise<LpUnitDecisionRow[]> {
  const { getDb } = await import('@/lib/db');
  const db = await getDb();
  return db.query<LpUnitDecisionRow>(`select r.id::text, r.decision, r.decided_by "decidedBy", r.pursuit_id::text "pursuitId", pe.display_name person,
      r.person_entity::text "personId", r.vehicle_id::text "vehicleId", v.name vehicle, oe.display_name org, r.org_pursuit_id::text "orgPursuitId",
      r.created_org_pursuit created, r.reason
    from strategy.lp_repoint r join identity.entity pe on pe.entity_id=r.person_entity join platform.vehicle v on v.id=r.vehicle_id
    left join identity.entity oe on oe.entity_id=r.org_entity where r.reversed_at is null order by r.created_at desc, r.id limit $1`, [limit]);
}
