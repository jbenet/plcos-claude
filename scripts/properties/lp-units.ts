/**
 * LP units (issues 0111, 0112; docs/23-lp-units.md), on invented identities only: the re-point
 * rules, no person-set status lowered, idempotence, reversal, and one grouping for both tables.
 */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { pipelineData } from '../../lib/pipeline-data';
import { EMPTY, filtersFrom, matches, rankRows, unitsFrom, type PipelineRow } from '../../components/strategy/pipeline-model';
import {
  combineStatus, decideLpUnit, decideLpUnitByPerson, isPseudoOrg, repointPursuits, reverseLpRepoint, STATUSES,
  type LpFacts, type LpFirm, type PursuitStatus,
} from '../../modules/strategy';
import type { Check } from './harness';

const LIVE: PursuitStatus[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'];

export function lpUnitRuleProperties(check: Check) {
  const firm = (o: Partial<LpFirm> = {}): LpFirm => ({ orgId: 'o1', name: 'Invented Allocator Capital', type: 'org', role: 'Partner', primary: true, investing: 'an LP we pursue', ...o });
  const facts = (o: Partial<LpFacts> = {}): LpFacts => ({ personal: [], firms: [], unit: null, foPrincipal: false, moneyHere: false, highRung: false, ...o });
  const angel = { kind: 'profile_angel' as const, label: 'Invented angel profile' };
  const d = decideLpUnit;
  check('0111 re-point rule: evidence of investing personally keeps a person as an individual LP, whatever their firm',
    d(facts({ personal: [angel], firms: [firm()] })).decision === 'personal'
      && d(facts({ firms: [firm({ name: 'Personal investing', investing: null })] })).decision === 'personal'
      && d(facts({ unit: 'personal', firms: [firm()] })).decision === 'personal'
      && d(facts({ foPrincipal: true })).decision === 'personal',
    'An angel profile, a listing under "Personal", a strategy naming their own account, or a family office with no entity of its own.');
  const moved = d(facts({ firms: [firm()] }));
  check('0111 re-point rule: an investing firm and no personal evidence moves the pursuit to the firm',
    moved.decision === 'moved' && moved.firm.orgId === 'o1'
      && d(facts({ foPrincipal: true, firms: [firm({ type: 'family', name: 'Invented Family Office' })] })).decision === 'moved',
    'A family office principal whose office is on record commits through the office.');
  const two = [firm({ orgId: 'a', name: 'Invented Alpha Ventures', primary: false }), firm({ orgId: 'b', name: 'Invented Beta Fund', primary: false })];
  const pickUnit = d(facts({ firms: two, unit: 'Invented Beta Fund' }));
  const pickPrimary = d(facts({ firms: [two[0]!, { ...two[1]!, primary: true }] }));
  check('0111 re-point rule: several investing firms need the strategy’s unit or a primary one, else a person decides',
    d(facts({ firms: two })).decision === 'review' && pickUnit.decision === 'moved' && pickUnit.firm.orgId === 'b'
      && pickPrimary.decision === 'moved' && pickPrimary.firm.orgId === 'b',
    'The strategy’s named unit wins, then the primary affiliation; two equal firms are a question.');
  check('0111 re-point rule: a firm nothing says invests, or money or a number on this pursuit, is a question for a person',
    d(facts({ firms: [firm({ name: 'Invented Robotics', investing: null })] })).decision === 'review'
      && d(facts({ firms: [firm()], moneyHere: true })).decision === 'review'
      && d(facts({ firms: [firm()], highRung: true })).decision === 'review',
    'Money is never moved between names, and a company is not an LP because someone works there.');
  check('0111 re-point rule: no organisation on record leaves a person where they are',
    d(facts()).decision === 'unaffiliated' && d(facts({ firms: [firm({ name: 'Personal' })] })).decision === 'personal',
    'Nothing to move to; a pseudo-organisation is evidence, not a firm.');
  check('0111 "Personal" is not a firm',
    ['Personal', 'personal investing', 'Personal capacity', 'Individual', 'Self', 'N/A', 'angel investor'].every(isPseudoOrg)
      && !['Invented NFDG', 'Personal Genome Fund', 'Invented Capital'].some(isPseudoOrg),
    'Capacity names are recognised whole; an organisation whose name merely starts with a word is not.');

  // No person-set status is ever lowered, and a rule's live status is never lowered either.
  let lowered = 0, silent = 0, pairs = 0;
  const statuses = STATUSES.map((x) => x.id);
  for (const p of statuses) for (const o of [...statuses, null] as Array<PursuitStatus | null>) for (const ph of [true, false]) for (const oh of [true, false]) {
    pairs++;
    const r = combineStatus({ status: p, human: ph }, o ? { status: o, human: oh } : null);
    if (r.conflict) {
      if (!((p === 'passed' && ph && o && o !== 'passed') || (o === 'passed' && oh && p !== 'passed'))) silent++;
      continue;
    }
    const out = r.from === 'person' ? p : o!;
    const sides = [{ s: p, h: ph }, ...(o ? [{ s: o, h: oh }] : [])];
    for (const side of sides) {
      if (side.s === 'passed') { if (side.h && out !== 'passed') lowered++; continue; }
      if (out === 'passed' || LIVE.indexOf(out) < LIVE.indexOf(side.s)) lowered++;
    }
  }
  check('0111 folding a person’s pursuit into its LP never lowers a status a person set, nor a live one',
    lowered === 0 && silent === 0,
    `${pairs} combinations of seven statuses and who set them: the furthest live status wins; a person’s Passed against a live row goes to a person.`);
}

export async function lpUnitProperties(check: Check, db: Db) {
  lpUnitRuleProperties(check);
  await withDb(db, async () => {
    const actor = (await db.one<{ id: string }>("select id::text from platform.app_user where active order by handle limit 1"))!.id;
    const other = (await db.one<{ id: string }>("select id::text from platform.app_user where active and id<>$1 order by handle limit 1", [actor]))!.id;
    const fund = (await db.one<{ id: string }>("select id::text from platform.vehicle where kind='fund' and phase='active' order by sort_order limit 1"))!.id;
    const tag = randomUUID().slice(0, 6);
    const entity = async (type: string, name: string) => (await db.one<{ id: string }>(
      'insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id', [type, `${name} ${tag}`]))!.id;
    const affiliate = (person: string, org: string, role: string, kind = 'principal') => db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,as_of,certainty)
      values($1,$2,$3::identity.affil_kind,$4,true,'2026-09-01','known')`, [person, org, kind, role]);
    const pursue = async (e: string, status: PursuitStatus, human: boolean, owner = actor) => (await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_set_at,headline)
      values($1,$2,$3,$4::strategy.pursuit_status,$5,case when $5='us' then now() end,'Invented headline') returning pursuit_id::text id`, [e, fund, owner, status, human ? 'us' : 'rule']))!.id;
    const profile = (e: string, t: string) => db.query(`insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented profile',$2::jsonb)`, [e, JSON.stringify({ profile: { investorType: t } })]);
    const row = <T,>(sql: string, params: unknown[]) => db.one<T>(sql, params);
    const snapshot = async () => (await db.one<{ h: string }>(`select md5(string_agg(x, '|' order by x)) h from (
        select 'p'||to_jsonb(t)::text x from strategy.pursuit t
        union all select 'l'||to_jsonb(t)::text from strategy.ladder_event t
        union all select 's'||to_jsonb(t)::text from strategy.suggestion t
        union all select 'u'||to_jsonb(t)::text from strategy.pursuit_update t
        union all select 'o'||to_jsonb(t)::text from strategy.pursuit_owner t
        union all select 'c'||to_jsonb(t)::text from strategy.pursuit_contact t
        union all select 'm'||to_jsonb(t)::text from meetings.meeting t
        union all select 'n'||to_jsonb(t)::text from research.note t
        union all select 't'||to_jsonb(t)::text from governance.approval_ticket t) z`, []))!.h;

    // A: a joint vehicle whose two founders also invest personally (the pattern of issue 0112).
    const joint = await entity('org', 'Invented Joint Vehicle'), f1 = await entity('person', 'Invented Founder One'), f2 = await entity('person', 'Invented Founder Two');
    await affiliate(f1, joint, 'Co-founder'); await affiliate(f2, joint, 'Co-founder');
    await profile(f1, 'angel');
    await db.query(`insert into research.note(entity_id,kind,body,data) values($1,'context','Invented prospect row',$2::jsonb)`, [f2, JSON.stringify({ source: 'prospects', entityType: 'person', org: null })]);
    const jointP = await pursue(joint, 'sourcing', false), f1P = await pursue(f1, 'sourcing', false), f2P = await pursue(f2, 'new', false);
    // B: one employee, a person-set status, and history to carry.
    const alloc = await entity('org', 'Invented Allocator Capital'), staff = await entity('person', 'Invented Associate');
    await affiliate(staff, alloc, 'Associate', 'staff');
    const staffP = await pursue(staff, 'discussing', true, other);
    await db.query(`insert into strategy.ladder_event(pursuit_id,rung,evidence_kind,evidence_ref,evidence_note,recorded_by,occurred_at)
      values($1,'connector_willing','fixture','invented:lp-unit','Invented connector evidence',$2,'2026-09-01')`, [staffP, actor]);
    await db.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash) values($1,'Invented strategy','{}','fixture',now(),$2)`, [staffP, `lp-unit-${tag}`]);
    await db.query(`insert into strategy.pursuit_update(pursuit_id,body,created_by,idempotency_key) values($1,'Invented update',$2,$3)`, [staffP, actor, `lp-unit:${tag}`]);
    await db.query(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context','Invented context',$3::jsonb)`, [staff, actor, JSON.stringify({ pursuitId: staffP })]);
    await db.query(`insert into meetings.meeting(pursuit_id,entity_id,vehicle_id,kind,owner_id,summary,held_on,channel)
      values($1,$2,$3,'intro',$4,'Invented meeting','2026-09-10','meeting')`, [staffP, staff, fund, actor]);
    // C: a pure angel. D: a company nothing says invests. I: listed under "Personal investing".
    const solo = await entity('person', 'Invented Angel'); await profile(solo, 'angel'); const soloP = await pursue(solo, 'new', false);
    const robotics = await entity('org', 'Invented Robotics'), founder = await entity('person', 'Invented Robotics Founder');
    await affiliate(founder, robotics, 'Founder'); const founderP = await pursue(founder, 'sourcing', false);
    const pseudo = await entity('org', 'Personal investing'), listed = await entity('person', 'Invented Listed Person');
    await db.query(`update identity.entity set display_name='Personal investing' where entity_id=$1`, [pseudo]);
    await affiliate(listed, pseudo, 'Self'); const listedP = await pursue(listed, 'sourcing', false);
    // E–H: statuses. E: a person's lower status meets a rule's higher. G: a person's higher meets a rule's lower.
    // H: a person's Passed meets a live organisation.
    const e = await entity('org', 'Invented Echo Partners'), eP = await entity('person', 'Invented Echo Person');
    await affiliate(eP, e, 'Partner'); const eOrg = await pursue(e, 'discussing', false), ePp = await pursue(eP, 'selected', true);
    const g = await entity('org', 'Invented Gulf Capital'), gP = await entity('person', 'Invented Gulf Person');
    await affiliate(gP, g, 'Partner'); const gOrg = await pursue(g, 'sourcing', false), gPp = await pursue(gP, 'discussing', true);
    const h = await entity('org', 'Invented Harbor Fund'), hP = await entity('person', 'Invented Harbor Person');
    await affiliate(hP, h, 'Partner'); const hOrg = await pursue(h, 'sourcing', false), hPp = await pursue(hP, 'passed', true);

    const before = await snapshot();
    const run1 = await repointPursuits(db, actor);
    const after1 = await snapshot();
    const cap = (id: string) => row<{ lp_capacity: string | null; lp_review: string | null; merged_into: string | null; status: string; status_source: string }>(
      'select lp_capacity,lp_review,merged_into::text,status::text,status_source from strategy.pursuit where pursuit_id=$1', [id]);
    const staffRow = (await cap(staffP))!;
    const orgP = staffRow.merged_into;
    const org = orgP ? (await row<{ entity_id: string; status: string; status_source: string; owner_id: string }>('select entity_id::text,status::text,status_source,owner_id::text from strategy.pursuit where pursuit_id=$1', [orgP])) : null;
    const on = async (table: string, where = 'pursuit_id=$1') => Number((await row<{ n: string }>(`select count(*)::text n from ${table} where ${where}`, [orgP]))!.n);
    check('0111 migration: a person at an investing firm moves to the firm’s pursuit, created with their status, owner and history',
      !!orgP && org?.entity_id === alloc && org.status === 'discussing' && org.status_source === 'us' && org.owner_id === other
        && await on('strategy.ladder_event') === 1 && await on('strategy.suggestion') === 1 && await on('meetings.meeting') === 1
        && await on('strategy.pursuit_update') === 2
        && await on('research.note', `data->>'pursuitId'=$1`) === 1,
      'The person-set Discussing, the owner, a rung, the strategy, an update, a note and a meeting all belong to the firm’s pursuit now.');
    const contact = orgP ? await row<{ person: string; role: string }>('select person_entity::text person, role from strategy.pursuit_contact where pursuit_id=$1', [orgP]) : null;
    const rows = (await pipelineData(fund)).rows;
    const orgRow = rows.find((r) => r.id === orgP);
    check('0111 migration: the person stays on the firm’s row as its contact, and their meetings still count there',
      contact?.person === staff && contact.role === 'Associate' && !!orgRow?.people.some((p) => p.id === staff && p.contact) && (orgRow?.meetings ?? 0) >= 1,
      'A contact’s touchpoints are read as the LP’s own, as they were before the move.');
    check('0111 migration: evidence keeps individuals; ambiguous ones are flagged, never moved',
      (await cap(f1P))!.lp_capacity === 'personal' && (await cap(f2P))!.lp_capacity === 'personal' && (await cap(soloP))!.lp_capacity === 'personal'
        && (await cap(listedP))!.lp_capacity === 'personal' && !(await cap(f1P))!.merged_into
        && !!(await cap(founderP))!.lp_review && !(await cap(founderP))!.merged_into && (await cap(jointP))!.status === 'sourcing',
      'Two founders with evidence, an angel and a person listed under "Personal" stay; a founder of a company that does not invest is a question.');
    const e1 = await cap(eOrg), g1 = await cap(gOrg), h1 = await cap(hOrg), hp1 = await cap(hPp);
    check('0111 migration never lowers a person-set status',
      (await cap(ePp))!.merged_into === eOrg && e1!.status === 'discussing'
        && (await cap(gPp))!.merged_into === gOrg && g1!.status === 'discussing' && g1!.status_source === 'us'
        && !hp1!.merged_into && hp1!.status === 'passed' && !!hp1!.lp_review && h1!.status === 'sourcing',
      'The furthest status stands, a person’s own is carried with its source, and a person’s Passed against a live firm is left for review.');

    // One ranked list, as both tables draw it (issue 0113), and the Firms/Individuals toggles.
    const ranked = rankRows(rows, 'score', -1);
    const organisations = ranked.filter((r) => r.isOrg), individuals = ranked.filter((r) => !r.isOrg);
    const shownWith = (units: string) => rows.filter((r) => matches(r, filtersFrom({ units }), [], Date.now())).map((r) => r.id).sort().join();
    const idsOf = (list: PipelineRow[]) => list.map((r) => r.id).sort().join();
    const firstInd = ranked.findIndex((r) => !r.isOrg), lastOrg = ranked.map((r) => r.isOrg).lastIndexOf(true);
    check('0113 one ranked list: organisations and individuals interleave by the chosen order, each row once',
      ranked.length === rows.length && new Set(ranked.map((r) => r.id)).size === rows.length
        && ranked.every((r, i) => i === 0 || rankRows([ranked[i - 1]!, r], 'score', -1)[0] === ranked[i - 1])
        && firstInd >= 0 && lastOrg >= 0,
      `${organisations.length} organisations and ${individuals.length} individuals in one order; none is held back for a section.`);
    check('0113 the Firms and Individuals toggles: both on to start, each hides only its own type, and the address round-trips them',
      EMPTY.units === 'both' && shownWith('both') === idsOf(rows) && shownWith('firms') === idsOf(organisations)
        && shownWith('individuals') === idsOf(individuals) && shownWith('none') === ''
        && filtersFrom({ units: 'bogus' }).units === 'both'
        && unitsFrom(true, true) === 'both' && unitsFrom(true, false) === 'firms' && unitsFrom(false, true) === 'individuals' && unitsFrom(false, false) === 'none',
      'An edited address falls back to both; each toggle state reads back as itself.');
    const jointRow = organisations.filter((r) => r.entityId === joint);
    check('0111 grouping: an organisation is listed once, individuals apart, and a person who invests both ways is in both places',
      jointRow.length === 1 && organisations.every((r) => r.isOrg) && individuals.every((r) => !r.isOrg)
        && new Set(organisations.map((r) => r.id)).size === organisations.length
        && [f1, f2].every((f) => jointRow[0]!.people.some((p) => p.id === f && p.individual === (f === f1 ? f1P : f2P)))
        && individuals.some((r) => r.id === f1P && r.firms.some((x) => x.id === joint && x.lpRow === jointP))
        && individuals.some((r) => r.id === f2P),
      'The firm’s row names both founders and links their individual rows; each founder’s row names the firm and links its row.');
    const listedRow = individuals.find((r) => r.id === listedP);
    check('0111 grouping: "Personal" is never a firm or a group',
      !!listedRow && listedRow.firms.length === 0 && !organisations.some((r) => isPseudoOrg(r.name)) && listedRow.lpCapacity === 'personal',
      'A person listed under a pseudo-organisation is an individual with no firm context.');

    const run2 = await repointPursuits(db, actor);
    check('0111 migration is idempotent: a second pass writes nothing',
      run2.moved + run2.personal + run2.review + run2.created === 0 && run2.unchanged > 0 && await snapshot() === after1
        && run1.moved >= 3,
      `First pass: ${run1.moved} moved, ${run1.created} created, ${run1.personal} individual, ${run1.review} to review. Second: ${run2.unchanged} unchanged.`);

    await decideLpUnitByPerson(db, founderP, actor, { kind: 'personal' });
    const run3 = await repointPursuits(db, actor);
    check('0111 a person’s decision stands over the rule',
      (await cap(founderP))!.lp_capacity === 'personal' && !(await cap(founderP))!.lp_review && run3.decidedByPerson >= 1,
      'The founder a person marked personal is skipped by later passes.');

    const ids = (await db.query<{ id: string }>('select id::text from strategy.lp_repoint where reversed_at is null order by created_at desc, id desc', [])).map((r) => r.id);
    let refused = 0;
    for (const id of ids) { try { if (!await reverseLpRepoint(db, id, actor, 'Invented reversal')) refused++; } catch { refused++; } }
    const restored = await snapshot();
    const again = await reverseLpRepoint(db, ids[0]!, actor, 'Invented retry');
    const run4 = await repointPursuits(db, actor);
    check('0111 migration reverses exactly, once, and is not re-applied',
      refused === 0 && restored === before && !again && run4.moved + run4.personal + run4.review === 0 && run4.reversedBefore >= ids.length - 1
        && await snapshot() === before,
      `${ids.length} decisions reversed newest first: pursuits, rungs, strategies, updates, owners, contacts, meetings, notes and tickets are as they were.`);
  });
}
