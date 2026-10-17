import type { Check, Db } from './harness';
import type { Principal } from '../../lib/authz';
import { scopedReadData } from '../../lib/authz/read/scoped-data';
import { redactAffiliations, redactSpv, redactStats } from '../../lib/authz/read/r3';
import { projectRoutes, scopedStrategyData } from '../../lib/authz/read/sections-data';
import { redactLicensedRoutes } from '../../lib/authz/read/network';
import { scoreDetailOf } from '../../lib/pipeline-data';
import { resolveSpv, type SpvEvidence } from '../../modules/strategy';
import type { Affiliation } from '../../modules/identity';
import type { RouteSearch } from '../../modules/network';
import type { StatsData } from '../../lib/lp-stats/data';

export async function authzReadProperties(check: Check, db: Db) {
  const viewer: Principal = { access: 'viewer', vehicles: null };
  const gp: Principal = { access: 'team', vehicles: null };
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
  const extraEntities: string[] = [], extraPursuits: string[] = [];
  const affinityIds = ['authz-read-note', 'authz-read-multi', 'authz-read-person', 'authz-read-empty', 'authz-read-removed'];
  const sourceIds = ['company:918273645', 'person:918273645', 'company:918273646'];
  try {
    const other = (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name) values('person','Invented Outside Viewer Person') returning entity_id::text id`))!.id;
    extraEntities.push(other);
    const alias = (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name,merged_into) values('org','Invented Viewer Alias',$1) returning entity_id::text id`, [entity]))!.id;
    extraEntities.push(alias);
    extraPursuits.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'new') returning pursuit_id::text id`, [other,b,owner]))!.id);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values
      ('affinity','person:918273645',$1,'rule:fixture'),('affinity','company:918273646',$2,'rule:fixture')`, [other,alias]);
    const rawNote = async (id: string, version: string, fetchedAt: string, payload: Record<string, unknown>) => {
      await db.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,fetched_at,payload)
        values('affinity','note',$1,$2,$3,$4)`, [id,version,fetchedAt,JSON.stringify({
        content: { html: 'INVENTED_R2_AFFINITY_BODY' }, ...payload,
      })]);
    };
    const linked = { personsPreview: { data: [{ id: 918273645 }, { id: 918273645 }] },
      companiesPreview: { data: [{ id: 918273645 }, { id: 918273646 }, { id: 918273646 }] } };
    await rawNote('authz-read-multi','tie-loser','2026-01-03T00:00:00Z', { ...linked, creator: { firstName: 'Obsolete' } });
    await rawNote('authz-read-multi','tie-winner','2026-01-03T00:00:00Z', { ...linked, creator: { firstName: 'Current', lastName: 'Invented' }, createdAt: '2026-01-02T00:00:00Z' });
    // A larger database id cannot revive an older fetched version.
    await rawNote('authz-read-multi','older-last','2026-01-01T00:00:00Z', { ...linked, creator: { firstName: 'Obsolete' } });
    await rawNote('authz-read-person','person-only','2026-01-03T00:00:00Z', { personsPreview: linked.personsPreview });
    await rawNote('authz-read-empty','missing-arrays','2026-01-03T00:00:00Z', {});
    await rawNote('authz-read-removed','previous-links','2026-01-02T00:00:00Z', linked);
    await rawNote('authz-read-removed','removed-links','2026-01-03T00:00:00Z', {});
    const view = await scopedReadData(viewer, db), serialized = JSON.stringify(view);
    check('Authz reads: Viewer projection retains identities, note metadata and restrictions without R1/R2/R4 values',
      view.rows.some(row => row.entityId === entity && row.restricted) && view.notes.some(n => n.id === note && n.author) && view.notes.some(n => n.id === 'affinity:authz-read-note' && n.author === 'Invented Affinity Author')
      && !serialized.includes('876543.21') && !serialized.includes('INVENTED_R2_') && !serialized.includes('INVENTED_R4_REASON')
      && !view.statuses.length && !view.bodies.length && !view.details.length,
      'real loader queried invented exposures, context and target restriction; restricted values never enter the DTO');
    const multi = view.notes.filter(n => n.id === 'affinity:authz-read-multi');
    const personOnly = view.notes.filter(n => n.id === 'affinity:authz-read-person');
    check('Authz reads: Affinity metadata keeps latest versions and deduplicates canonical links without conflating people and companies',
      multi.length === 2 && multi.some(n => n.entityId === entity) && multi.some(n => n.entityId === other)
      && multi.every(n => n.author === 'Current Invented' && n.at === '2026-01-02T00:00:00Z')
      && personOnly.length === 1 && personOnly[0]!.entityId === other && personOnly[0]!.author === null
      && personOnly[0]!.at.startsWith('2026-01-03')
      && !view.notes.some(n => n.id === 'affinity:authz-read-empty' || n.id === 'affinity:authz-read-removed'),
      'Fetched timestamp wins before id; tied versions use the higher id, merged aliases and duplicate references collapse, absent arrays and removed links produce no metadata.');
    const scopedViewer = await scopedReadData({ ...viewer, vehicles: [a!] }, db);
    check('Authz reads: scoped Viewer metadata excludes outside entities while retaining shared notes for an allowed canonical LP',
      scopedViewer.notes.filter(n => n.id === 'affinity:authz-read-multi').length === 1
      && scopedViewer.notes.some(n => n.id === 'affinity:authz-read-multi' && n.entityId === entity)
      && !scopedViewer.notes.some(n => n.entityId === other || n.id === 'affinity:authz-read-person')
      && !JSON.stringify(scopedViewer).includes('INVENTED_R2_'),
      'A shared note keeps only its in-scope entity association and never exposes its content.');
    const emptyViewer = await scopedReadData({ ...viewer, vehicles: [] }, db);
    check('Authz reads: an empty vehicle scope returns no rows or note metadata',
      emptyViewer.rows.length === 0 && emptyViewer.notes.length === 0 && emptyViewer.overlaps.length === 0
      && emptyViewer.details.length === 0 && emptyViewer.bodies.length === 0 && emptyViewer.statuses.length === 0,
      'No Affinity or research metadata crosses an empty vehicle grant.');
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
    await db.query("delete from sources.raw_record where source='affinity' and kind='note' and source_id=any($1::text[])", [affinityIds]);
    await db.query("delete from identity.source_record where source='affinity' and source_id=any($1::text[])", [sourceIds]);
    await db.query('delete from pipeline.exposure where exposure_id=$1', [exposure]);
    await db.query('delete from coordination.restriction where restriction_id=$1', [restriction]);
    await db.query('delete from research.note where note_id=any($1::uuid[])', [[note,outsideNote,licensedNote]]);
    await db.query('delete from strategy.pursuit where pursuit_id=any($1::uuid[])', [[...ids,...extraPursuits]]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [extraEntities]);
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
  // Red team, 17 Oct 2026: a route with a hop whose only evidence is licensed is withheld, not just its words, and counted;
  // a hop with other evidence too keeps the route with the licensed words redacted. Connectors on withheld routes vanish.
  const hop = (to: string, evidence: Array<{ source: string; note: string }>) => ({ toName: `Invented ${to}`, toEntity: to,
    edge: { edgeId: `edge-${to}`, fromEntity: 'team', toEntity: to, tier: 'B', kind: 'knows', evidence } });
  const route = (to: string, evidence: Array<{ source: string; note: string }>) => ({ fromEntity: 'team', fromName: 'Invented Team', verdict: 'recommend',
    hops: [hop(to, evidence), hop('target', [{ source: 'affinity', note: 'INVENTED_PUBLIC_TIE' }])], connectorIds: [to], connectorNames: [`Invented ${to}`],
    reasons: [], weakestTier: 'B', askLoad: null, influence: null, viaContact: { entityId: to, name: `Invented ${to}`, role: 'INVENTED_R3_TITLE' } });
  const mixed = { ...routes, targetId: 'target', routes: [route('only-licensed', [{ source: 'Dakota-2026', note: 'INVENTED_R3_ROUTE' }]),
    route('mixed', [{ source: 'dakota', note: 'INVENTED_R3_ROUTE' }, { source: 'affinity', note: 'INVENTED_PUBLIC_MIXED' }])] } as unknown as RouteSearch;
  mixed.topRoutes = mixed.routes;
  const prior = JSON.stringify(mixed), safe = redactLicensedRoutes(mixed), again = redactLicensedRoutes(safe), text = JSON.stringify(safe);
  check('Authz reads: without licensed access, a route with a Dakota-only hop is withheld and counted; a mixed hop keeps its route with the licensed words redacted; no connector or graph node is left only through the withheld hop',
    !text.includes('INVENTED_R3_') && text.includes('INVENTED_PUBLIC_MIXED') && safe.restrictions === mixed.restrictions
    && safe.routes.length === 1 && safe.routes[0]!.connectorIds[0] === 'mixed' && safe.topRoutes?.length === 1 && safe.licensedRoutesWithheld === 1
    && !text.includes('only-licensed') && !safe.graph?.nodes.some((n) => n.entityId === 'only-licensed')
    && safe.graph!.links.every((l) => l.routeIndices.every((i) => i < safe.routes.length))
    && again.licensedRoutesWithheld === 1 && JSON.stringify(mixed) === prior,
    `${safe.routes.length} route(s) kept, withheld ${safe.licensedRoutesWithheld} (again ${again.licensedRoutesWithheld}); graph nodes ${safe.graph?.nodes.map((n) => n.entityId).join(',')}`);
  check('Authz reads: licensed affiliations are matched by prefix, whatever the case (Dakota-2026, DAKOTA)',
    redactAffiliations(gp, [{ ...affiliation, source: 'Dakota-2026' } as Affiliation, { ...affiliation, source: 'DAKOTA' } as Affiliation]).length === 0,
    'r3.ts redactAffiliations uses /^dakota/i');

  // Score detail (the selection page's pane): a Dakota suggestion is skipped; a Dakota-based row shows no next, ask or basis.
  const plain = { label: 'L', weight: 1, value: 1, level: 'x', basis: 'INVENTED_R3_BASIS' };
  const strat = (source?: string) => ({ made_at: '2026-10-01T00:00:00Z', data: { ...(source ? { source } : {}), angle: 'INVENTED_R3_ANGLE', ask: { shape: 'verify first', range: '1M' }, risks: ['INVENTED_R3_RISK'],
    scores: { capacity: { band: 'unknown', basis: 'INVENTED_R3_BASIS' }, affinity: { level: 'low', basis: 'INVENTED_R3_BASIS' }, propensity: { level: 'low', basis: 'INVENTED_R3_BASIS' }, timeToDecision: { band: 'weeks', basis: 'INVENTED_R3_BASIS' } } } });
  const row = (over: Record<string, unknown>) => ({ stale: false, action: 'INVENTED_R3_NEXT', risks: ['INVENTED_R3_RISK', 'Owner unavailable'], usingDakota: false,
    pursuit: { source: 'mail_desk' }, suggestion: strat(), ...over }) as unknown as Parameters<typeof scoreDetailOf>[0];
  const fitA = { dimensions: [{ label: 'Fit', weightUs: 1, grade: 'strong', finding: 'INVENTED_R3_BASIS' }], gateStatus: 'clear', updatedAt: new Date() } as unknown as Parameters<typeof scoreDetailOf>[1];
  const fromSuggestion = scoreDetailOf(row({ suggestion: strat('dakota-import') }), undefined, false);
  const usingDakota = scoreDetailOf(row({ usingDakota: true }), fitA, false);
  const fromPursuit = scoreDetailOf(row({ pursuit: { source: 'Dakota' } }), undefined, false);
  const licensedReader = scoreDetailOf(row({ usingDakota: true, suggestion: strat('dakota') }), undefined, true);
  const ordinary = scoreDetailOf(row({}), undefined, false);
  check('Authz reads: score detail without licensed access skips a Dakota suggestion and, for a Dakota-based LP, nulls next, ask and every basis; licensed readers and ordinary rows are unchanged',
    !JSON.stringify(fromSuggestion).includes('INVENTED_R3_') && fromSuggestion.risks.join() === 'Owner unavailable'
    && [usingDakota, fromPursuit].every((d) => d.next === null && d.ask === null && d.parts.length > 0 && d.parts.every((p) => p.basis === null))
    && licensedReader.next === 'INVENTED_R3_NEXT' && licensedReader.ask !== null && licensedReader.parts.some((p) => p.basis === plain.basis)
    && ordinary.next === 'INVENTED_R3_NEXT' && ordinary.angle === 'INVENTED_R3_ANGLE' && ordinary.parts.some((p) => p.basis === plain.basis),
    `suggestion ${JSON.stringify(fromSuggestion).slice(0, 120)}; usingDakota next ${usingDakota.next}; pursuit next ${fromPursuit.next}; licensed next ${licensedReader.next}`);
}
