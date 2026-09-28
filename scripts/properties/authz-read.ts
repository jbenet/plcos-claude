import type { Check, Db } from './harness';
import type { Principal } from '../../lib/authz';
import { scopedReadData } from '../../lib/authz/read/scoped-data';
import { redactAffiliations, redactSpv, redactStats } from '../../lib/authz/read/r3';
import { projectRoutes, scopedStrategyData } from '../../lib/authz/read/sections-data';
import { redactLicensedRoutes } from '../../lib/authz/read/network';
import { resolveSpv, type SpvEvidence } from '../../modules/strategy';
import type { Affiliation } from '../../modules/identity';
import type { RouteSearch } from '../../modules/network';
import type { StatsData } from '../../lib/lp-stats/data';

export async function authzReadProperties(check: Check, db: Db) {
  const viewer: Principal = { access: 'viewer', vehicles: null };
  const gp: Principal = { access: 'gp', vehicles: null };
  const admin: Principal = { access: 'admin', vehicles: null };
  const owner = (await db.one<{ id: string }>(`select id::text from platform.app_user where handle='juan'`))!.id;
  const vehicles = await db.query<{ id: string }>(`select id::text from platform.vehicle order by sort_order limit 2`);
  const [a, b] = vehicles.map(v => v.id);
  const entity = (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name) values('org','Invented Authz Read Fixture') returning entity_id::text id`))!.id;
  const ids: string[] = [];
  for (const vehicle of [a!, b!]) ids.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'new') returning pursuit_id::text id`, [entity,vehicle,owner]))!.id);
  const note = (await db.one<{ id: string }>(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context','INVENTED_R2_INSIDE',jsonb_build_object('vehicleId',$3::text)) returning note_id::text id`, [entity,owner,a]))!.id;
  const licensedNote = (await db.one<{ id: string }>(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context','INVENTED_R3_CONTEXT',jsonb_build_object('vehicleId',$3::text,'source','dakota')) returning note_id::text id`, [entity,owner,a]))!.id;
  const outsideNote = (await db.one<{ id: string }>(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context','INVENTED_R2_OUTSIDE',jsonb_build_object('vehicleId',$3::text)) returning note_id::text id`, [entity,owner,b]))!.id;
  const restriction = (await db.one<{ id: string }>(`insert into coordination.restriction(entity_id,scope,instruction,recorded_by) values($1,'blanket','INVENTED_R4_REASON',$2) returning restriction_id::text id`, [entity,owner]))!.id;
  const exposure = (await db.one<{ id: string }>(`insert into pipeline.exposure(entity_id,vehicle_id,owner_id,instrument,track,amount) values($1,$2,$3,'lp_commitment','soft',876543.21) returning exposure_id::text id`, [entity,a,owner]))!.id;
  await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity','company:918273645',$1,'rule:fixture')`, [entity]);
  await db.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values('affinity','note','authz-read-note','authz-read-note',$1)`, [JSON.stringify({ id: 'authz-read-note', creator: { firstName: 'Invented', lastName: 'Affinity Author' }, createdAt: '2026-01-02T00:00:00Z', companiesPreview: { data: [{ id: 918273645 }] }, content: { html: 'INVENTED_R2_AFFINITY_BODY' } })]);
  const suggestionIds: string[] = [];
  for (const [i,pursuit] of ids.entries()) suggestionIds.push((await db.one<{ id: string }>(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash) values($1,$2,'{}','Invented Strategist',now(),$3) returning suggestion_id::text id`, [pursuit, i ? 'INVENTED_STRATEGY_OUTSIDE' : 'INVENTED_STRATEGY_INSIDE', `authz-read-${i}`]))!.id);
  try {
    const view = await scopedReadData(viewer, db), serialized = JSON.stringify(view);
    check('Authz reads: Viewer projection retains identities, note metadata and restrictions without R1/R2/R4 values',
      view.rows.some(row => row.entityId === entity && row.restricted) && view.notes.some(n => n.id === note && n.author) && view.notes.some(n => n.id === 'affinity:authz-read-note' && n.author === 'Invented Affinity Author')
      && !serialized.includes('876543.21') && !serialized.includes('INVENTED_R2_') && !serialized.includes('INVENTED_R4_REASON')
      && !view.statuses.length && !view.bodies.length && !view.details.length,
      'real loader queried invented exposures, context and target restriction; restricted values never enter the DTO');
    const viewerStrategies = await scopedStrategyData(viewer, db);
    const gpStrategies = await scopedStrategyData({ ...gp, vehicles: [a!] }, db);
    check('Authz reads: strategy projection retains proposal metadata and limits narrative to GP vehicle scope',
      viewerStrategies.some(s => s.id === suggestionIds[0] && s.author === 'Invented Strategist')
      && !JSON.stringify(viewerStrategies).includes('INVENTED_STRATEGY_')
      && JSON.stringify(gpStrategies).includes('INVENTED_STRATEGY_INSIDE') && !JSON.stringify(gpStrategies).includes('INVENTED_STRATEGY_OUTSIDE'),
      'Viewer receives proposal existence/author/date/status; GP can inspect its own strategy narrative only');
    const scoped = await scopedReadData({ ...gp, vehicles: [a!] }, db), text = JSON.stringify(scoped);
    check('Authz reads: scoped GP sees allowed amounts, words, restrictions and status controls but not another vehicle’s note',
      scoped.rows.some(r => r.id === ids[0]) && !scoped.rows.some(r => r.id === ids[1])
      && text.includes('876543.21') && text.includes('INVENTED_R2_INSIDE') && text.includes('INVENTED_R4_REASON')
      && !text.includes('INVENTED_R3_CONTEXT') && !text.includes('INVENTED_R2_OUTSIDE') && scoped.statuses.some(r => r.id === ids[0]) && !scoped.statuses.some(r => r.id === ids[1])
      && scoped.overlaps.some(r => r.entityId === entity && r.restricted) && scoped.outsideScope > 0,
      'outside-vehicle presence remains visible as vehicle/owner/restriction metadata');
  } finally {
    await db.query('delete from strategy.suggestion where suggestion_id=any($1::uuid[])', [suggestionIds]);
    await db.query("delete from sources.raw_record where source='affinity' and kind='note' and source_id='authz-read-note'");
    await db.query("delete from identity.source_record where source='affinity' and source_id='company:918273645'");
    await db.query('delete from pipeline.exposure where exposure_id=$1', [exposure]);
    await db.query('delete from coordination.restriction where restriction_id=$1', [restriction]);
    await db.query('delete from research.note where note_id=any($1::uuid[])', [[note,outsideNote,licensedNote]]);
    await db.query('delete from strategy.pursuit where pursuit_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=$1', [entity]);
  }

  const licensed = { kind: 'dakota', stance: 'does', minDeals: 23, label: 'INVENTED_R3_SPV', quote: null, source: 'dakota', url: null, asOf: '2026-01-01', confidence: 'medium', lastVerifiedBy: 'fixture' } as SpvEvidence;
  const reading = resolveSpv([licensed]);
  const affiliation = { source: 'dakota', personName: 'Invented Person', orgName: 'Invented Firm', role: 'INVENTED_R3_ROLE' } as Affiliation;
  const stats = { facts: [{ checkBasis: 'dakota', check: 'large', checkText: 'INVENTED_R3_TICKET', typeBasis: 'dakota', type: 'sfo', countryBasis: 'dakota', country: 'INVENTED_R3_COUNTRY', context: 'INVENTED_R3_CONTACT', spv: 'many' }], vehicles: [], asOf: '2026-01-01', onHistory: 0 } as unknown as StatsData;
  const before = JSON.stringify({ reading, affiliation, stats });
  const sanitized = JSON.stringify({ reading: redactSpv(gp, reading), affiliations: redactAffiliations(gp, [affiliation]), stats: redactStats(gp, stats) });
  check('Authz reads: non-admin R3 projection removes licensed capacity, affiliation and derived SPV evidence without changing caches',
    !sanitized.includes('INVENTED_R3_') && redactSpv(gp, reading).stance === 'unknown'
    && JSON.stringify({ reading, affiliation, stats }) === before
    && redactStats(admin, stats) === stats && redactAffiliations(admin, [affiliation])[0] === affiliation,
    'non-admin projections are new objects; Admin/raw inputs retain the original licensed fixture');
  const routes = { routes: [{ hops: [{ toName: 'Invented Person', toEntity: 'person', edge: { evidence: [{ source: 'dakota', note: 'INVENTED_R3_ROUTE' }] } }], viaContact: { entityId: 'person', name: 'Invented Person', role: 'INVENTED_R3_TITLE' } }], graph: { nodes: [{ entityId: 'person', name: 'Invented Person', source: false, target: true }], links: [] }, restrictions: [{ instruction: 'Do not approach' }] } as unknown as RouteSearch;
  routes.targetName = 'Invented Target'; routes.fromName = 'Invented Team'; routes.coverage = { edges: 12, maxHops: 3, from: new Date('2026-01-01'), to: new Date('2026-01-02'), notInspected: [] };
  routes.restrictions[0]!.instruction = 'INVENTED_R4_ROUTE';
  const safeViewer = projectRoutes(viewer, 'a', routes), safeGp = projectRoutes({ ...gp, vehicles: ['a'] }, 'a', routes);
  check('Authz reads: focused route projection removes evidence bodies and reasons for Viewer while keeping full graph coverage',
    !JSON.stringify(safeViewer).includes('INVENTED_R3_') && !JSON.stringify(safeViewer).includes('INVENTED_R4_ROUTE')
    && safeViewer?.restrictionCount === 1 && safeViewer.coverage.edges === 12 && safeViewer.routes.length === routes.routes.length
    && safeGp?.restrictionReasons[0] === 'INVENTED_R4_ROUTE' && projectRoutes({ ...gp, vehicles: ['b'] }, 'a', routes) === null,
    'route names/tier/verdict and corpus dates remain; scope denies a foreign vehicle without narrowing the search graph');
  const prior = JSON.stringify(routes), safe = redactLicensedRoutes(routes);
  check('Authz reads: route display redacts licensed evidence without changing graph, target restrictions or route eligibility',
    !JSON.stringify(safe).includes('INVENTED_R3_') && safe.graph === routes.graph && safe.restrictions === routes.restrictions
    && safe.routes.length === routes.routes.length && JSON.stringify(routes) === prior,
    'full graph/route planning is preserved; only display evidence and contact title change');
}
