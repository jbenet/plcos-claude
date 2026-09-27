/** Invented records only. Parent property runner supplies its isolated demo database. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { withDb } from '../lib/db';
import { planRoutes, planRoutesLive } from '../modules/network/service';
import { parsePublicHeadcount, routeIdentityGroups, routePolicyFacts } from '../modules/network/route-policy';

export async function routesPolicy0084Properties(check: Check, db: Db) {
  const ids: string[] = Array.from({ length: 9 }, () => randomUUID());
  const [person, merged, namesake, possible, organization, origin, target, targetAlias, targetPossible] = ids as [string, string, string, string, string, string, string, string, string];
  const vehicle = randomUUID(), otherVehicle = randomUUID(), user = randomUUID();
  const source = `invented-route-policy-${randomUUID()}`;
  try {
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email)
      values($1,$2,'Invented policy reviewer','IP','fixture','fixture@example.org')`, [user, source]);
    for (const id of [vehicle, otherVehicle]) await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption)
      values($1,$2,'Invented policy vehicle','fund','fixture')`, [id, `invented-${id}`]);
    for (const [i, id] of ids.entries()) await db.query(`insert into identity.entity(entity_id,entity_type,display_name)
      values($1,$2,$3)`, [id, i === 4 ? 'org' : 'person',
      ['Invented Policy Person', 'Invented Source Alias', 'Invénted Policy Person', 'Invented Possible Match', 'Invented Policy Organization',
        'Invented Policy Source', 'Invented Policy Target', 'Invénted Policy Target', 'Invented Target Possible Match'][i]]);
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2', [person, merged]);
    await db.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
      values($1,$2,.25,'[]')`, [namesake, possible].sort());
    await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
      values($1,$3,'colleague','B','[]',current_date),($2,$3,'other','C','[]',current_date)`, [person, merged, organization]);
    await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,as_of)
      values($1,$3,'staff','Invented role',current_date),($2,$3,'staff','Invented role',current_date)`, [merged, namesake, organization]);
    await db.query(`insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values($1,'Invented size source','public','https://example.org/size',current_date,'strong','Headcount','Invented source')`, [source]);
    await db.query(`insert into research.claim(entity_id,field,value,source,as_of,confidence,last_verified_by)
      values($1,'public.headcount','100–600 employees',$2,current_date,'high',$3),
        ($1,'employee_count','9000',$2,current_date,'high',null)`, [organization, source, user]);
    await withDb(db, async () => {
      const groups = await routeIdentityGroups(ids);
      check('0084 routing identity groups reject alias loops without merging records',
        [merged, namesake, possible].every((id) => groups.get(id) === groups.get(person))
          && groups.get(organization) !== groups.get(person)
          && (await db.one<{ merged_into: string | null }>('select merged_into from identity.entity where entity_id=$1', [namesake]))?.merged_into === null,
        'Canonical redirects, normalized names and active possible matches supply a safety grouping, never an identity mutation.');
      const first = await routePolicyFacts(ids);
      check('0087 organization membership counts each canonical person once across edge and affiliation evidence',
        first.organizations.get(organization)?.members === 2,
        'Two edge aliases and a matching affiliation count once; an unmerged namesake remains a distinct graph member.');
      check('0087 public headcount requires provenance and uses the upper end of a bounded range',
        first.organizations.get(organization)?.headcount === 600,
        'A larger claim with no verifier is ignored; a 100–600 range supplies 600.');
      await db.query(`insert into coordination.restriction(entity_id,scope,instruction)
        values($1,'blanket','Invented do-not-approach instruction')`, [merged]);
      const restricted = await routePolicyFacts(ids);
      check('0085 a new global restriction blocks merged and possible person aliases on warm reads',
        [person, merged, namesake, possible].every((id) => restricted.blocked.has(id)) && !restricted.blocked.has(organization),
        'Safety checks inspect live restrictions and propagate through uncertain identity matches.');
      await db.query('update coordination.restriction set expires_at=current_date-1 where entity_id=$1', [merged]);
      check('0085 expired global restrictions are released without rebuilding topology',
        (await routePolicyFacts(ids)).blocked.size === 0, 'Restriction expiry is read on every request.');
      await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_reason)
        values($1,$2,$3,'passed','do_not_contact')`, [merged, vehicle, user]);
      check('0085 a vehicle do-not-contact applies to every alias only for that vehicle',
        (await routePolicyFacts(ids, vehicle)).blocked.has(possible)
          && (await routePolicyFacts(ids, otherVehicle)).blocked.size === 0
          && (await routePolicyFacts(ids)).blocked.size === 0,
        'A vehicle-specific prohibition does not become a global prohibition or disappear behind a merged record.');
      await db.query(`update strategy.pursuit set status='selected',status_reason=null where entity_id=$1 and vehicle_id=$2`, [merged, vehicle]);
      await db.query(`update research.claim set value='700' where entity_id=$1 and field='public.headcount'`, [organization]);
      const updated = await routePolicyFacts(ids, vehicle);
      check('0085/0087 live pursuit and headcount changes bypass cached topology',
        updated.blocked.size === 0 && updated.organizations.get(organization)?.headcount === 700,
        'Removing vehicle DNC and editing a valid headcount take effect on the next read.');
      await db.query(`delete from identity.affiliation where person_entity=$1 and org_entity=$2`, [namesake, organization]);
      check('0087 member counts invalidate after affiliation changes',
        (await routePolicyFacts(ids)).organizations.get(organization)?.members === 1,
        'The topology revision changes when graph membership changes.');
      // Service integration: one known team source, one person path and one organization path.
      // The organization starts above its threshold, so it cannot hide a restricted-person bug.
      await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('app_user',$1,$2,'invented-fixture')`, [source, origin]);
      for (const [from, to] of [[origin, person], [person, target], [origin, organization], [organization, target]]) {
        await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
          values($1,$2,'colleague','B',$3::jsonb,current_date)`, [from, to,
          JSON.stringify([{ note: 'Invented worked-together evidence', tie: { kind: 'worked_together' } }])]);
      }
      const cached = (vehicleId?: string) => planRoutes(source, target, 3, 'fund', 'team', undefined, { vehicleId });
      const live = (vehicleId?: string) => planRoutesLive(source, target, 3, 'fund', 'team', undefined, vehicleId);
      const initial = await cached();
      check('0084 service fixture starts with a recommended canonical person route',
        Boolean(initial?.routes.some((r) => r.verdict === 'recommend' && r.connectorIds.includes(person))),
        'The warm-cache restriction tests start from a real, usable route.');
      await db.query(`insert into coordination.restriction(entity_id,scope,instruction)
        values($1,'blanket','Invented middle-hop prohibition')`, [merged]);
      const blockedCached = await cached(), blockedLive = await live();
      check('0085 warm cached and live planners remove prohibited middle hops and report why',
        [blockedCached, blockedLive].every((search) => Boolean(search)
          && search!.routes.every((r) => r.verdict !== 'recommend')
          && (search!.ruleCounts?.restricted ?? 0) > 0
          && search!.removedRoutes?.some((r) => r.reason === 'restricted')),
        'A restriction inserted after cache population removes the route; the oversized organization supplies no workaround.');
      await db.query('delete from coordination.restriction where entity_id=$1', [merged]);
      const restored = await cached();
      check('0085 removing a middle-hop restriction restores the warm cached route',
        Boolean(restored?.routes.some((r) => r.verdict === 'recommend' && r.connectorIds.includes(person)))
          && restored?.ruleCounts?.restricted === 0,
        'Live policy changes apply without a structural network rebuild.');
      await db.query(`update strategy.pursuit set status='passed',status_reason='do_not_contact'
        where entity_id=$1 and vehicle_id=$2`, [merged, vehicle]);
      const vehicleCached = await cached(vehicle), vehicleLive = await live(vehicle), other = await cached(otherVehicle);
      check('0085 cached selection vehicle and live vehicle argument enforce identical middle-hop DNC',
        [vehicleCached, vehicleLive].every((search) => Boolean(search)
          && search!.routes.every((r) => r.verdict !== 'recommend') && (search!.ruleCounts?.restricted ?? 0) > 0)
          && Boolean(other?.routes.some((r) => r.verdict === 'recommend' && r.connectorIds.includes(person))),
        'Vehicle DNC blocks its aliases only in the selected vehicle for both planner entry points.');
      await db.query(`update strategy.pursuit set status='selected',status_reason=null
        where entity_id=$1 and vehicle_id=$2`, [merged, vehicle]);
      const oversizedCached = await cached(), oversizedLive = await live();
      check('0087 cached and live planners suppress oversized organization hops with counts',
        [oversizedCached, oversizedLive].every((search) => Boolean(search)
          && search!.routes.every((r) => !r.connectorIds.includes(organization))
          && (search!.ruleCounts?.largeOrganizations ?? 0) > 0
          && search!.removedRoutes?.some((r) => r.reason === 'large_organization')),
        'A current public headcount above the configured threshold removes the entire middle-hop path.');
      await db.query(`update research.claim set value='100' where entity_id=$1 and field='public.headcount'`, [organization]);
      const smallCached = await cached(), smallLive = await live();
      const orgPath = (search: typeof smallCached) => search?.routes.find((r) => r.connectorIds.length === 1 && r.connectorIds[0] === organization);
      const cachedOrg = orgPath(smallCached), liveOrg = orgPath(smallLive);
      check('0087 smaller organization routes return with the same size discount in cached and live planners',
        Boolean(cachedOrg?.score && liveOrg?.score)
          && cachedOrg!.score!.value === liveOrg!.score!.value
          && cachedOrg!.score!.factors.some((f) => f.key === 'organizationSize' && f.points < 0)
          && (smallCached?.ruleCounts?.organizationPenalties ?? 0) > 0,
        'The graph cache does not preserve a removed route or lose the live size penalty.');
      await db.query(`update research.claim set value='10' where entity_id=$1 and field='public.headcount'`, [organization]);
      check('0087 a smaller current public headcount improves the warm cached organization score',
        (orgPath(await cached())?.score?.value ?? 0) > (cachedOrg?.score?.value ?? Infinity),
        'The strength discount changes monotonically with organization size.');
      for (const [from, to] of [[origin, targetAlias], [targetAlias, target], [origin, targetPossible]]) {
        await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
          values($1,$2,'colleague','B','[]',current_date)`, [from, to]);
      }
      await db.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
        values($1,$2,.25,'[]')`, [target, targetPossible].sort());
      const noLoopsCached = await cached(), noLoopsLive = await live();
      check('0084/0088 target namesakes and active possible matches never become middle hops',
        [noLoopsCached, noLoopsLive].every((search) => Boolean(search)
          && search!.routes.every((r) => !r.connectorIds.includes(targetAlias) && !r.connectorIds.includes(targetPossible))
          && (search!.ruleCounts?.repeatedPeople ?? 0) > 0),
        'Different source IDs cannot produce target-to-target paths, even without an identity merge.');
      const [pl, staff, firstHop, secondHop, distantTarget] = Array.from({ length: 5 }, () => randomUUID()) as [string, string, string, string, string];
      const distantIds = [pl, staff, firstHop, secondHop, distantTarget];
      ids.push(...distantIds);
      for (const [i, id] of distantIds.entries()) await db.query(`insert into identity.entity(entity_id,entity_type,display_name)
        values($1,$2,$3)`, [id, i === 0 ? 'org' : 'person',
        ['PL', 'Invented New PL Source', 'Invented Distant First Hop', 'Invented Distant Second Hop', 'Invented Distant Target'][i]]);
      await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('w3_person',$1,$2,'invented-fixture')`, [`${source}-pl`, pl]);
      for (const [from, to] of [[staff, firstHop], [firstHop, secondHop], [secondHop, distantTarget]]) await db.query(
        `insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
          values($1,$2,'colleague','B',$3::jsonb,current_date)`, [from, to,
          JSON.stringify([{ note: 'Invented distant relationship', tie: { kind: 'worked_together' } }])]);
      const distant = () => planRoutes(source, distantTarget, 3, 'fund', 'team');
      const emptyBefore = await distant();
      await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
        values($1,$2,'colleague','B',$3::jsonb,current_date)`, [pl, staff,
        JSON.stringify([{ note: 'Invented PL employment evidence', tie: { kind: 'worked_together', basis: 'pl_affiliation' } }])]);
      const newSource = await distant();
      check('0084 recognizing a PL staff source invalidates a cached empty target three hops away',
        emptyBefore?.routes.length === 0 && Boolean(newSource?.routes.some((r) => r.fromEntity === staff && r.hops.length === 3)),
        'A source roster change reaches beyond the ordinary two-hop incremental invalidation radius.');
      await db.query('delete from network.edge where from_entity=$1 and to_entity=$2', [pl, staff]);
      check('0084 retiring an evidence-derived PL source invalidates its cached distant routes',
        (await distant())?.routes.length === 0,
        'Removing the only PL employment evidence removes source status without retaining a previously cached route.');
    });
    check('0087 headcount parser refuses narrative, percentages, malformed counts and unbounded ranges',
      ['Founded in 2001 with 40 people', '50%', '100+', '-1', '1,23', '10 to unknown'].every((s) => parsePublicHeadcount(s) === null)
        && parsePublicHeadcount('1,000–5,000 employees') === 5000 && parsePublicHeadcount('1k to 2.5k') === 2500,
      'Only a numeric count or bounded numeric range can affect the size policy.');
  } finally {
    await db.query('delete from research.claim where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.source_doc where doc_id=$1', [source]);
    await db.query('delete from coordination.restriction where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit where vehicle_id=any($1::uuid[])', [[vehicle, otherVehicle]]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [ids]);
    await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.affiliation where person_entity=any($1::uuid[]) or org_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from platform.vehicle where id=any($1::uuid[])', [[vehicle, otherVehicle]]);
    await db.query('delete from platform.app_user where id=$1', [user]);
  }
}
