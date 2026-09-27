/** Invented records only; a separate temporary database never touches a demo or live server. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PortfolioInput, PortfolioInputRow, PortfolioSource } from '../lib/enrich/portfolio';
process.env.DATA_PROFILE = 'demo';
delete process.env.DATABASE_URL;
const scratch = await mkdtemp(join(tmpdir(), 'portfolio-0079-'));
process.env.PGLITE_DIR = scratch;
const { openFresh, withDb } = await import('../lib/db');
const { importPortfolio, portfolioProblems, listPortfolio, portfolioFounders } = await import('../lib/enrich/portfolio');
const db = await openFresh(scratch);
const source: PortfolioSource = { file: 'invented-material.pdf', page: 4, as_of: '2026-09-01', confidence: .9, last_verified_by: 'fixture' };
const row = (id: string, name: string): PortfolioInputRow => ({ id, vehicle: 'neurotech', company: { name: `${name} Labs` }, founders: [{ name, source }], source });
const input = (rows: PortfolioInputRow[], extra: Partial<PortfolioInput> = {}): PortfolioInput => ({ version: 1, as_of: source.as_of, coverage: [], rows, ...extra });
async function entity(name: string, type = 'person') { return (await db.one<{ id: string }>('insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id', [type, name]))!.id; }
async function map(id: string, key: string, sourceName = 'warehouse') { await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,'fixture')", [sourceName, key, id]); }
async function founder(id: string) { return (await db.one<{ founders: Array<{ entityId: string; possibleMatches: string[] }> }>('select founders from network.portfolio where portfolio_id=$1', [id]))!.founders[0]!; }
let passed = 0;
async function test(label: string, fn: () => Promise<void>) { await fn(); console.log(`PASS ${label}`); passed++; }
try {
  const pl = await entity('Invented institution', 'org'); await map(pl, 'pl', 'network_org');
  await db.query("insert into platform.vehicle(slug,name,kind,exemption) values('invented-spv','Invented SPV','spv','506(c)')");
  await test('invalid identity and investment provenance rejects without partial writes', async () => {
    const before = (await db.one<{ n: number }>('select count(*)::int n from identity.entity'))!.n;
    const bad = row('invalid', 'Invented Invalid'); bad.founders[0]!.warehouse_person_id = 'missing-source';
    assert.ok(portfolioProblems(input([bad])).length); await assert.rejects(importPortfolio(db, input([bad])), /provenance/);
    delete bad.founders[0]!.warehouse_person_id;
    bad.investments = [{ date: '2026-02-30', amount: 500, currency: 'USD', multiple: 1, source }];
    await assert.rejects(importPortfolio(db, input([bad])), /investment/);
    bad.investments[0]!.date = '2026-02'; bad.investments[0]!.source = { ...source, last_verified_by: '' };
    await assert.rejects(importPortfolio(db, input([bad])), /investment/);
    assert.equal((await db.one<{ n: number }>('select count(*)::int n from identity.entity'))!.n, before);
  });
  await test('name alone stays possible and repeated own affiliations do not corroborate', async () => {
    const existing = await entity('Invented Namesake');
    const a = row('namesake', 'Invented Namesake');
    await importPortfolio(db, input([a])); const first = await founder(a.id);
    assert.notEqual(first.entityId, existing); assert.ok(first.possibleMatches.includes(existing));
    await importPortfolio(db, input([a])); assert.equal((await founder(a.id)).entityId, first.entityId);
    await db.query(`update identity.possible_match set active=false,signals='{"rule":"independent-fixture"}'::jsonb
      where left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid)`, [existing, first.entityId]);
    await importPortfolio(db, input([a]));
    assert.equal((await db.one<{ active: boolean }>(`select active from identity.possible_match where signals->>'rule'='independent-fixture'`))!.active, false);
    const b = row('second-namesake', 'Invented Namesake');
    await importPortfolio(db, input([a, b])); assert.notEqual((await founder(b.id)).entityId, first.entityId);
  });
  await test('overlapping names across a complete snapshot produce no new possible matches on repeat', async () => {
    const existing = await entity('Invented Shared Founder');
    const a = row('shared-one', 'Invented Shared Founder'), b = row('shared-two', 'Invented Shared Founder');
    b.company.name = 'Invented Second Company';
    const first = await importPortfolio(db, input([a, b]));
    const state = () => db.query('select left_entity,right_entity,active,signals from identity.possible_match order by left_entity,right_entity');
    const before = await state();
    const ids = [(await founder(a.id)).entityId, (await founder(b.id)).entityId];
    assert.ok(ids.every(id => id !== existing));
    const second = await importPortfolio(db, input([a, b]));
    assert.deepEqual(await state(), before); assert.equal(second.possible, first.possible); assert.equal(second.linked, 0);
    assert.deepEqual([(await founder(a.id)).entityId, (await founder(b.id)).entityId], ids);
  });
  await test('later warehouse evidence retargets only this source and keeps external entities intact', async () => {
    const external = await entity('Invented Rematch'); await map(external, 'invented-person-42');
    const a = row('rematch', 'Invented Rematch');
    await importPortfolio(db, input([a])); const previous = (await founder(a.id)).entityId;
    assert.notEqual(previous, external);
    a.founders[0]!.warehouse_person_id = 'invented-person-42'; a.founders[0]!.warehouse_person_id_source = source;
    const result = await importPortfolio(db, input([a])); assert.equal(result.linked, 1);
    assert.equal((await founder(a.id)).entityId, external);
    assert.equal((await db.one<{ merged: string | null }>('select merged_into::text merged from identity.entity where entity_id=$1', [previous]))!.merged, null);
    assert.equal((await db.one<{ n: number }>("select count(*)::int n from network.edge where to_entity=$1 and evidence @> '[{\"portfolioId\":\"rematch\"}]'::jsonb", [previous]))!.n, 0);
    const edgeIds = async () => (await db.query<{ id: string }>("select edge_id::text id from network.edge where evidence @> '[{\"portfolioId\":\"rematch\"}]'::jsonb order by edge_id")).map(e => e.id);
    const stable = await edgeIds(); await importPortfolio(db, input([a])); assert.deepEqual(await edgeIds(), stable);
    assert.equal((await founder(a.id)).entityId, external);
  });
  await test('profile and company-domain evidence corroborate independently sourced identities', async () => {
    const profileId = await entity('Invented Profile');
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented research',$2::jsonb)", [profileId, JSON.stringify({ researched: { at: source.as_of, by: 'fixture' }, identity: { match: 'confirmed', links: [{ url: 'https://example.org/people/invented-profile' }] } })]);
    const p = row('profile', 'Invented Profile'); p.founders[0]!.profile_urls = ['https://example.org/people/invented-profile/'];
    p.founders[0]!.profile_sources = [{ url: p.founders[0]!.profile_urls[0]!, source }];
    const domainId = await entity('Invented Domain');
    const reviewer = (await db.one<{ id: string }>('select id::text from platform.app_user limit 1'))!.id;
    await db.query("insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body) values('invented-domain-source','Invented site','website','https://invented.example','2026-09-01','strong','identity','Invented')");
    await db.query("insert into research.claim(entity_id,field,value,source,as_of,confidence,last_verified_by) values($1,'company_domain','invented.example','invented-domain-source','2026-09-01','high',$2)", [domainId, reviewer]);
    const d = row('domain', 'Invented Domain'); d.founders[0]!.company_domain = 'https://invented.example/'; d.founders[0]!.company_domain_source = source;
    await importPortfolio(db, input([p, d])); assert.equal((await founder(p.id)).entityId, profileId); assert.equal((await founder(d.id)).entityId, domainId);
  });
  await test('not-same-as and ambiguous corroboration fail closed', async () => {
    const external = await entity('Invented Blocked'); await map(external, 'invented-blocked-person');
    const a = row('blocked', 'Invented Blocked'); a.founders[0]!.warehouse_person_id = 'invented-blocked-person'; a.founders[0]!.warehouse_person_id_source = source;
    await db.query("insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id) values('not_same_as','portfolio','blocked:founder:invented blocked','warehouse','invented-blocked-person')");
    await importPortfolio(db, input([a])); assert.notEqual((await founder(a.id)).entityId, external);
    const first = await entity('Invented Ambiguous'), second = await entity('Invented Ambiguous'), org = await entity('Invented Ambiguous Labs', 'org');
    for (const id of [first, second]) await db.query("insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of) values($1,$2,'principal','Founder','invented-independent.pdf','2026-09-01')", [id, org]);
    const b = row('ambiguous', 'Invented Ambiguous'); await importPortfolio(db, input([b]));
    assert.ok(![first, second].includes((await founder(b.id)).entityId));
  });
  await test('SPV investment rows preserve values and month precision; warehouse classification is not membership', async () => {
    const a = row('spv-row', 'Invented SPV Founder'); a.vehicle = 'invented-spv';
    a.company.domain = null; a.founders[0]!.warehouse_person_id = null;
    a.investments = [{ date: '2026-03', amount: 12500, currency: 'USD', multiple: 1.25, source }, { date: null, amount: null, currency: null, multiple: null, source, note: 'Not disclosed' }];
    const b = row('warehouse-row', 'Invented Warehouse Founder'); b.vehicle = 'rails'; b.portfolio_status = 'warehouse_claimed_portfolio';
    await importPortfolio(db, input([b], { spv_rows: [a] }));
    const loaded = await withDb(db, () => listPortfolio()); assert.deepEqual(loaded.find(r => r.id === a.id)!.investments, a.investments);
    assert.equal(loaded.find(r => r.id === b.id)!.portfolioStatus, b.portfolio_status);
    const membership = await withDb(db, () => portfolioFounders());
    assert.ok(membership[(await founder(a.id)).entityId]); assert.equal(membership[(await founder(b.id)).entityId], undefined);
    a.portfolio_status = 'research_scope_only';
    await importPortfolio(db, input([b], { spv_rows: [a] }));
    assert.equal((await withDb(db, () => portfolioFounders()))[(await founder(a.id)).entityId], undefined);
    assert.equal((await db.one<{ n: number }>("select count(*)::int n from network.edge where evidence @> '[{\"portfolioId\":\"warehouse-row\"}]'::jsonb"))!.n, 0);
    const wrong = structuredClone(a); wrong.vehicle = 'neurotech'; await assert.rejects(importPortfolio(db, input([], { spv_rows: [wrong] })), /wrong kind/);
  });
  await test('exclusions win and stale rows retire owned ties while preserving independent evidence', async () => {
    const a = row('excluded-row', 'Invented Excluded'), b = row('stale-row', 'Invented Stale');
    await importPortfolio(db, input([a, b]));
    const former = (await founder(a.id)).entityId;
    await db.query("update network.edge set evidence=evidence || '[{\"source\":\"invented-independent.pdf\",\"note\":\"Independent relationship\"}]'::jsonb where evidence @> '[{\"portfolioId\":\"excluded-row\"}]'::jsonb");
    const result = await importPortfolio(db, input([a], { excluded: [{ id: a.id }] })); assert.equal(result.removed, 2);
    assert.equal((await withDb(db, () => listPortfolio())).length, 0);
    assert.equal((await withDb(db, () => portfolioFounders()))[former], undefined);
    const left = await db.query<{ evidence: Array<Record<string, unknown>> }>('select evidence from network.edge where to_entity=$1', [former]);
    assert.ok(left.some(e => e.evidence.some(v => v.source === 'invented-independent.pdf')));
    assert.ok(left.every(e => e.evidence.every(v => !v.portfolioId)));
    assert.equal((await db.one<{ n: number }>("select count(*)::int n from identity.affiliation where note like 'Portfolio %'"))!.n, 0);
    assert.equal((await db.one<{ n: number }>("select count(*)::int n from identity.possible_match where active and signals->>'rule'='portfolio-name-only'"))!.n, 0);
    assert.equal((await db.one<{ active: boolean }>("select active from identity.possible_match where signals->>'rule'='independent-fixture'"))!.active, false);
  });
  console.log(`${passed} portfolio 0079 properties hold.`);
} finally { await db.close(); await rm(scratch, { recursive: true, force: true }); }
