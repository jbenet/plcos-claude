/** W3 LP-unit regression: invented fixtures only, no external records or files. */
import { randomUUID } from 'node:crypto';
import { withDb } from '../../lib/db';
import { connectionPaths, type Network, type TeamMember, type WarehouseGraph } from '../../lib/enrich/connect';
import { connectionCoverage } from '../../lib/enrich/connection-summary';
import { researchSet, type Candidate } from '../../lib/enrich/candidates';
import { planRoutes, planRoutesLive } from '../../modules/network/service';
import { strategyRouteSummaries } from '../../modules/network/strategy-summary';
import { lpContactsFor } from '../../modules/strategy';
import type { Check, Db } from './harness';

const person = (key: string, name: string): Candidate => ({ key, name, type: 'person', org: null, role: null,
  location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
  contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
    lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
    meetingDates: [], recent: [], outreachShared: 0 } });

export function lpUnitPathProperties(check: Check) {
  const contact = person('11111111-1111-4111-8111-111111111111', 'Invented Mira Branch');
  contact.contact.recent = [{ on: '2026-09-20', channel: 'meeting', direction: null, about: ['general'], with: ['Invented Rowan Vale'] }];
  const firm: Candidate = { ...person('22222222-2222-4222-8222-222222222222', 'Invented Orchard Capital'), type: 'org',
    contacts: [{ ...contact, contactRole: 'Partner' }] };
  const net: Network = { orgs: [], backers: [], backer_people: [] };
  const team: TeamMember[] = [{ handle: 'invented-rowan', name: 'Invented Rowan Vale', roles: [], prior: [], education: [] }];
  const run = (cs: Candidate[]) => connectionPaths(cs, new Map(), net, team, [], new Date('2026-09-27T00:00:00Z'));
  const baseline = run([contact]);
  const firms = run([firm]);
  const warm = firms.paths.filter(p => p.lp === firm.key && p.other.handle === team[0]!.handle);
  check('W3 LP unit: a contact-only person restores the firm’s warm path with role and evidence',
    warm.length === 1 && warm[0]!.viaContact?.key === contact.key && warm[0]!.viaContact?.role === 'Partner'
      && /via.*Partner/i.test(warm[0]!.basis) && warm[0]!.tier === baseline.paths[0]!.tier,
    'A named direct meeting reaches an organisation through its partner; contact-only people need no personal pursuit.');
  const dual = run([firm, contact]);
  check('W3 LP unit: personal LP output is unchanged when the person also speaks for a firm',
    JSON.stringify(dual.paths.filter(p => p.lp === contact.key)) === JSON.stringify(baseline.paths),
    'Compared every field of the person’s original paths, retaining evidence and tier.');
  const duplicated = run([{ ...firm, contacts: [firm.contacts![0]!, firm.contacts![0]!] }, contact]);
  const coverage = connectionCoverage(duplicated.paths, duplicated.lpKeys);
  check('W3 LP unit: repeated contact membership never double-counts the person or firm LP',
    JSON.stringify(duplicated.paths) === JSON.stringify(dual.paths) && coverage.total === 2 && coverage.reached === 2 && coverage.warm === 2,
    'An individual LP and its firm are two committing units, each counted once despite duplicate contact membership.');
  const weak = { ...person('33333333-3333-4333-8333-333333333333', 'Invented Weak Contact'), enriched: { 'Relationship Tier': 'Close' } };
  const weakBaseline = run([weak]).paths;
  const weakFirm = run([{ ...firm, contacts: [{ ...weak, contactRole: 'Associate' }] }]).paths.filter(p => p.lp === firm.key);
  check('W3 LP unit: contact affiliation never upgrades a weak relationship tier',
    weakFirm.length > 0 && weakFirm.every(p => p.tier === 'C') && weakBaseline.every(p => p.tier === 'C'),
    'An unrecorded relationship holder remains tier C when attributed to the LP firm.');
  for (const tier of ['A', 'B', 'C', 'D'] as const) {
    const graph: WarehouseGraph = {
      people: [
        { key: 'invented-source', name: team[0]!.name, teamKey: team[0]!.handle, org: null, emailDomain: null,
          roles: [], warehouseIds: {}, source: 'invented warehouse', as_of: '2026-09-20', confidence: 'high', last_verified_by: 'fixture' },
        { key: 'invented-contact', name: contact.name, org: firm.name, emailDomain: null,
          roles: ['Partner'], warehouseIds: {}, source: 'invented warehouse', as_of: '2026-09-20', confidence: 'high', last_verified_by: 'fixture' },
      ],
      matches: [{ lpKey: contact.key, personKey: 'invented-contact', score: 1, status: 'confident', basis: ['invented exact identity'] }],
      ties: [{ key: `invented-${tier}`, from: 'invented-source', to: 'invented-contact', tier,
        kind: tier === 'A' ? 'repeated_contact' : tier === 'B' ? 'acquaintance' : 'proximity',
        firstSeen: '2026-09-01', lastSeen: '2026-09-20', source: 'invented warehouse', rowIds: ['invented-row'], count: 8 }],
    };
    const found = connectionPaths([firm, contact], new Map(), net, team, [], new Date('2026-09-27T00:00:00Z'), graph).paths;
    const original = found.find(p => p.lp === contact.key && p.warehouse);
    const projected = found.filter(p => p.lp === firm.key && p.warehouse);
    check(`W3 LP unit: warehouse tier ${tier} and personal match survive firm projection exactly once`,
      !!original && projected.length === 1 && projected[0]!.tier === original.tier && projected[0]!.tier >= tier
        && JSON.stringify(projected[0]!.warehouse) === JSON.stringify(original.warehouse)
        && projected[0]!.warehouse!.match.lpKey === contact.key && projected[0]!.viaContact?.key === contact.key,
      'Projection retains ordered pairwise evidence and the person match; it never rematches warehouse identity to the firm.');
  }
  const blockedFirm = run([{ ...firm, restrictions: [{ scope: 'blanket', connector: null, channel: null }] }]);
  const blockedContact = run([{ ...firm, contacts: [{ ...firm.contacts![0]!, restrictions: [{ scope: 'blanket', connector: null, channel: null }] }] }]);
  check('W3 LP unit: a firm or contact prohibition cannot be bypassed through contact projection',
    !blockedFirm.paths.some(p => p.lp === firm.key && p.viaContact) && !blockedContact.paths.some(p => p.lp === firm.key && p.viaContact),
    'Restrictions on either the committing unit or the human endpoint prevent a projected approach.');
}

export async function lpUnitPathDatabaseProperties(check: Check, db: Db) {
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const [firm, primary, explicit, board, adviser, investor, secondary, former, origin] = ids as [string,string,string,string,string,string,string,string,string];
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string }>("select id::text from platform.vehicle where kind='fund' and phase='active' order by sort_order limit 1"))!.id;
  const handle = `invented-lp-unit-${randomUUID()}`;
  try {
    await db.query(`insert into platform.app_user(handle,name,initials,role,email) values($1,'Invented Unit Source','IU','fixture','fixture@example.org')`, [handle]);
    for (const [i, id] of ids.entries()) await db.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,$2,$3)`,
      [id, i === 0 ? 'org' : 'person', `Invented Unit Path ${i} ${handle}`]);
    const pursuit = (await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'selected') returning pursuit_id::text id`, [firm, vehicle, actor]))!.id;
    await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,lp_capacity) values($1,$2,$3,'selected','personal')`, [primary, vehicle, actor]);
    for (const [id, kind, role, main, ended] of [
      [primary, 'decision_maker', 'Partner', true, null], [board, 'board', 'Board member', true, null],
      [adviser, 'adviser', 'Advisor', true, null], [investor, 'contact', 'Investor', true, null],
      [secondary, 'staff', 'Partner', false, null], [former, 'staff', 'Partner', true, '2026-01-01'],
    ] as const) await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,ended_on,as_of)
      values($1,$2,$3::identity.affil_kind,$4,$5,$6::date,'2026-09-01')`, [id, firm, kind, role, main, ended]);
    for (const [id, role] of [[explicit, 'Decision-maker'], [primary, 'Partner']]) await db.query(`insert into strategy.pursuit_contact(pursuit_id,person_entity,role,origin_pursuit_id,source)
      values($1,$2,$3,$4,'invented-fixture')`, [pursuit, id, role, randomUUID()]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('app_user',$1,$2,'invented-fixture')`, [handle, origin]);
    await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
      values($1,$2,'colleague','B',$3::jsonb,'2026-09-01')`, [origin, primary, JSON.stringify([{ note: 'Invented worked-together evidence', tie: { kind: 'worked_together' } }])]);
    // An old personal meeting must survive both LP-unit projection and the eight-touch preview.
    await db.query(`insert into meetings.meeting(entity_id,owner_id,kind,channel,held_on,attendees,source)
      values($1,$2,'intro','meeting','2020-01-02',array['fixture@example.org'],'us')`, [explicit, actor]);
    // Dated from yesterday back, in JS: the database's current_date is UTC and can already be tomorrow
    // in local time (20:00–24:00 in New York), which put one email in the future and failed this (29 Sep).
    for (let i = 0; i < 9; i++) await db.query(`insert into meetings.meeting(entity_id,owner_id,channel,held_on,attendees,source,direction)
      values($1,$2,'email',$3::date,array['Invented Other Correspondent'],'affinity','theirs')`,
      [explicit, actor, new Date(Date.now() - (i + 2) * 86_400_000).toISOString().slice(0, 10)]);
    await withDb(db, async () => {
      const contacts = (await lpContactsFor([firm])).get(firm) ?? [];
      check('LP unit contacts: active primary representatives and pursuit contacts form one deduplicated set',
        contacts.length === 2 && contacts.some(c => c.entityId === primary) && contacts.some(c => c.entityId === explicit),
        'Board, adviser, investor, secondary and former roles excluded; duplicate explicit/primary partner retained once.');
      const exported = await researchSet();
      const org = exported.find(c => c.key === firm);
      const history = org?.contacts?.find(c => c.key === explicit)?.contact;
      check('W3 export: complete named history survives the preview limit and LP-unit re-pointing',
        history?.records?.length === 10 && history.recent.length === 8
          && history.records.some(r => r.on === '2020-01-02' && r.source === 'us'
            && !r.group && r.with.includes('Invented Unit Source'))
          && history.records.filter(r => r.source === 'affinity').length === 9,
        'Both local meetings and imported email remain attributable to the contact after its pursuit moves to the firm.');
      const historicalPaths = org ? connectionPaths([org], new Map(), { orgs: [], backers: [], backer_people: [] },
        [{ handle, name: 'Invented Unit Source', roles: [], prior: [], education: [] }], [], new Date()).paths : [];
      check('W3 export: an old named meeting reaches the firm after eight newer unrelated touches',
        historicalPaths.some(p => p.lp === firm && p.other.handle === handle && p.viaContact?.key === explicit
          && p.tie?.lastInteraction === '2020-01-02' && p.tier <= 'B'),
        'The route uses the complete contact history, not the preview or raise window, without crediting the pursuit owner.');
      check('W3 export: firm contact keys and roles are present without inventing personal LP pursuits',
        org?.contacts?.length === 2 && org.contacts.some(c => c.key === primary && c.contactRole === 'Partner')
          && org.contacts.some(c => c.key === explicit && c.pursuits.length === 0)
          && exported.filter(c => c.key === primary).length === 1 && !exported.some(c => c.key === explicit),
        'A dual-capacity person keeps its individual row; contact-only counterparts stay nested under the LP unit.');
      const individual = await planRoutes(handle, primary, 3, 'fund', 'team', undefined, { vehicleId: vehicle });
      const cached = await planRoutes(handle, firm, 3, 'fund', 'team', undefined, { vehicleId: vehicle });
      const live = await planRoutesLive(handle, firm, 3, 'fund', 'team', undefined, vehicle);
      const baseline = individual?.routes.find(r => r.verdict === 'recommend');
      check('LP unit routes: cached and live searches reach a warm contact without an artificial weak firm hop',
        !!baseline && [cached, live].every(s => s?.routes.some(r => r.verdict === 'recommend'
          && r.viaContact?.entityId === primary && r.weakestTier === baseline.weakestTier && r.hops.length === baseline.hops.length)),
        'Firm routes retain the person endpoint evidence and tier, with separate contact-role metadata.');
      const summaries = await strategyRouteSummaries([firm, primary], 'fund');
      const personalSummary = summaries.get(primary);
      check('LP unit summaries: firm and contact cache rows count one evidenced chain while preserving individual counts',
        !!personalSummary && personalSummary.count > 0 && summaries.get(firm)?.count === personalSummary.count
          && summaries.get(firm)?.tier === personalSummary.tier && summaries.get(firm)?.path.includes('via Partner') === true,
        'The same path stored under both the personal LP and its firm is one firm route, with the contact role.');
      await db.query(`update network.route_cache set search=jsonb_set(search,'{routes}',(search->'routes') || (search->'routes'))
        where target_id=any($1::uuid[]) and vehicle_kind='fund'`, [[firm, primary]]);
      const repeated = await strategyRouteSummaries([firm, primary], 'fund');
      check('LP unit summaries: duplicate firm projections deduplicate without changing original personal summary semantics',
        !!personalSummary && repeated.get(firm)?.count === personalSummary.count
          && repeated.get(primary)?.count === personalSummary.count * 2 && repeated.get(primary)?.tier === personalSummary.tier,
        'Firm chains count once across both snapshots; an individual retains its original stored-candidate count.');

      // Remove both independent bases for the warm contact, leaving only an unconnected explicit counterpart.
      await db.query('delete from strategy.pursuit_contact where pursuit_id=$1 and person_entity=$2', [pursuit, primary]);
      await db.query('update identity.affiliation set is_primary=false where person_entity=$1 and org_entity=$2', [primary, firm]);
      const removed = await planRoutes(handle, firm, 3, 'fund', 'team', undefined, { vehicleId: vehicle });
      const afterRemoval = await strategyRouteSummaries([firm, primary], 'fund');
      check('LP unit routes: removing a contact invalidates warm cached firm paths and stored summaries',
        !!removed && !removed.routes.some(r => r.viaContact?.entityId === primary)
          && afterRemoval.get(firm)?.count === 0 && (afterRemoval.get(primary)?.count ?? 0) > 0,
        'An old projected organisation snapshot cannot retain a removed member; personal LP paths remain available.');
      // The preceding read caches an empty search. Membership itself must invalidate it, without editing an edge.
      await db.query(`insert into strategy.pursuit_contact(pursuit_id,person_entity,role,origin_pursuit_id,source)
        values($1,$2,'Partner',$3,'invented-fixture')`, [pursuit, primary, randomUUID()]);
      const added = await planRoutes(handle, firm, 3, 'fund', 'team', undefined, { vehicleId: vehicle });
      check('LP unit routes: adding a contact invalidates an empty cached firm search without a graph edit',
        !!baseline && !!added?.routes.some(r => r.viaContact?.entityId === primary
          && r.verdict === 'recommend' && r.weakestTier === baseline.weakestTier),
        'The pre-existing personal edge becomes visible through the new pursuit-contact membership immediately.');
      await db.query(`insert into coordination.restriction(entity_id,scope,instruction) values($1,'blanket','Invented firm prohibition')`, [firm]);
      const blocked = await planRoutes(handle, firm, 3, 'fund', 'team', undefined, { vehicleId: vehicle });
      check('LP unit routes: adding a firm restriction invalidates usable contact routes immediately',
        !!blocked && blocked.routes.every(r => r.verdict !== 'recommend'), 'Warm cached paths cannot bypass the firm’s current restriction.');
    });
  } finally {
    await db.query('delete from meetings.meeting where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from coordination.restriction where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit_contact where person_entity=any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.affiliation where person_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from platform.app_user where handle=$1', [handle]);
  }
}
