/** Invented records only. Never opens the live replica; every DB fixture is rolled back. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Check, Db } from './properties/harness';
import { config } from '../config/deployment';
import { translateDakota } from '../lib/connectors/dakota/translate';
import { needed, neededRecord, readReplicas, type Module, type Replica } from '../lib/connectors/dakota/replica';
import { accountFit, ticketEstimate, usd } from '../lib/connectors/dakota/rules';
import { dakotaCapacities, dakotaFor } from '../lib/connectors/dakota/view';
import type { RecordFields } from '../lib/connectors/dakota/replica';
import { readBody, type ListQuery } from '../lib/connectors/dakota/client';
import { normalizeIdentifier } from '../modules/identity/external';
import { undoIdentityMerge } from '../modules/identity/resolution';

export async function dakotaProperties(check: Check, db: Db) {
  const at = '2026-09-01T12:00:00.000Z', nextAt = '2026-09-02T12:00:00.000Z';
  const record = (module: Module, raw: Record<string, unknown>) => neededRecord(module, { lastmodifieddate: at, ...raw });
  const replica = (module: Module, file: string, rows: Record<string, unknown>[]): Replica => ({
    module, file, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), records: rows.map(r => record(module, r)),
  });
  const fits = (raw: Record<string, unknown>, slug = 'neurotech') => accountFit(record('account', { id: 'invented-rule', ...raw }), { slug, name: slug });
  const unknown = record('account', { account_id: 'invented-allowlist', id: 'wrong-alias', arbitrary_secret: 'invented forbidden field', name: 'Not in needed fields' });
  check('DAKOTA keeps only needed fields and normalizes response ID aliases', unknown.id === 'invented-allowlist'
    && !('arbitrary_secret' in unknown) && !('name' in unknown)
    && record('contact', { contact_id: 'invented-contact', accountid: 'invented-account' }).accountid === 'invented-account'
    && record('account', { id: 'invented-id' }).id === 'invented-id', 'account_id/contact_id/id and accountid use the public response schema.');
  check('DAKOTA ticket rule checks the lower bound and each permitted ticket field',
    !fits({ investment_interest__c: 'healthcare', average_ticket_size__c: '499999', check_size_to__c: '2000000' })
    && ['average_ticket_size__c', 'check_size_from__c', 'private_equity_average_ticket_size__c'].every(k => fits({ investment_interest__c: 'healthcare', [k]: '500000' }))
    && !fits({ average_ticket_size__c: '500000' }), 'A high upper bound alone does not qualify; thesis match and at least $500K are required.');
  check('DAKOTA allocator exception requires allocator type, flag and vehicle fit',
    ['Family Office', 'Foundation', 'Endowment', 'Fund of Funds'].every(type => fits({ type, venture_capital__c: true }))
    && !fits({ type: 'RIA', venture_capital__c: true }) && !fits({ type: 'Foundation', investment_interest__c: 'healthcare' })
    && fits({ type: 'Family Office', cryptocurrency__c: true }, 'rails') !== null,
    'Allocator exception is explicit; neither type nor interest alone is enough.');
  check('DAKOTA SPV thesis matching uses words rather than substrings',
    !!fits({ investment_interest__c: 'AI', average_ticket_size__c: '500000' }, 'prime-intellect')
    && !!fits({ investment_interest__c: 'robotics', average_ticket_size__c: '500000' }, 'persona-ai')
    && !!fits({ investment_interest__c: 'neurotech', average_ticket_size__c: '500000' }, 'netholabs')
    && !fits({ investment_interest__c: 'retail', average_ticket_size__c: '500000' }, 'prime-intellect'), 'AI does not match retail.');
  check('DAKOTA ticket estimates retain source, date and estimate label',
    usd('$500K') === 500000 && usd('1.5 million') === 1500000 && usd('unknown') === null
    && /Estimate.*Dakota.*source dakota.*as of/.test(ticketEstimate(record('account', { id: 'invented-ticket', average_ticket_size__c: '$500K' }))!.basis), 'Dollar parsing is bounded; capacity is a sourced estimate.');
  check('DAKOTA identity identifiers normalize URLs and registration numbers',
    normalizeIdentifier('domain', 'https://www.fixture.example/path') === 'fixture.example'
    && normalizeIdentifier('linkedin', 'https://www.linkedin.com/in/Invented-Person/?tracking=x') === 'linkedin.com/in/invented-person'
    && normalizeIdentifier('crd', '000123') === '123' && normalizeIdentifier('cik', '000009') === '9'
    && normalizeIdentifier('linkedin', 'https://not-linkedin.example/in/person') === null, 'Public website, LinkedIn and regulator identifiers have deterministic normalization.');

  const nonReads: unknown[] = ['create', 'update', 'delete', 'records', 'data', 'action'].map(k => ({ module: 'account', [k]: {} }));
  nonReads.push({ module: 'account', filter: [{ $delete: true }] }, { module: 'account', filter: [{ $or: [{ id: { $set: 'bad' } }] }] });
  const refused = nonReads.filter(q => { try { readBody(q as ListQuery); return false; } catch { return true; } });
  check('DAKOTA client refuses every non-read body and nested write operator', refused.length === nonReads.length
    && JSON.parse(readBody({ module: 'account', countOnly: true })).count_only === '1', `${refused.length} invented mutation shapes refused without network access.`);

  const sources = await Promise.all(['lib/connectors/dakota/translate.ts', 'lib/connectors/dakota/replica.ts', 'lib/connectors/dakota/view.ts', 'modules/identity/external.ts'].map(p => readFile(p, 'utf8')));
  check('DAKOTA translation has no file-write, network or DB-opening capability',
    sources.every(s => !/\b(writeFile|appendFile|createWriteStream|mkdir|rename|copyFile|fetch|openPglite|getDb)\s*\(/.test(s))
    && !/from ['"]node:fs/.test(sources[0]!), 'Static boundary check over translator, replica reader, projections and identity helper; records persist only through the supplied DB handle.');

  // These files are invented test inputs under a private scratch directory, never a live replica.
  const scratch = await mkdtemp(join(tmpdir(), 'invented-dakota-manifests-'));
  try {
    await mkdir(join(scratch, 'account'));
    const manifest = async (stamp: string, expected: number, written: number, module: Module = 'account') => writeFile(join(scratch, `${stamp}.manifest.json`),
      JSON.stringify({ at: stamp.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, 'T$1:$2:$3Z'), modules: { [module]: { expected, written } } }));
    const oldStamp = '2026-09-01T12-00-00Z', deltaStamp = '2026-09-02T12-00-00Z', incompleteStamp = '2026-09-03T12-00-00Z';
    await manifest(oldStamp, 1, 1);
    await writeFile(join(scratch, 'account', `${oldStamp}.jsonl`), JSON.stringify({ account_id: 'invented-reader', lastmodifieddate: at, website: 'https://reader.example', ignored: 'invented not persisted' }) + '\n');
    await manifest(deltaStamp, 1, 1);
    await writeFile(join(scratch, 'account', `${deltaStamp}.jsonl`), JSON.stringify({ id: 'invented-reader', lastmodifieddate: nextAt, aum__c: '1500000' }) + '\n');
    await manifest(incompleteStamp, 2, 1);
    const loaded = await readReplicas(scratch);
    check('DAKOTA manifest reader replays complete deltas in order and skips incomplete latest replicas', loaded.length === 2
      && loaded[0]!.records[0]!.website === 'https://reader.example' && loaded[1]!.records[0]!.aum__c === '1500000'
      && !('ignored' in loaded[0]!.records[0]!), 'Completeness comes from manifests, never newest filename alone; needed-field filtering happens before translation.');
    await manifest('2026-09-04T12-00-00Z', 0, 0, 'contact');
    const empty = (await readReplicas(scratch)).find(r => r.module === 'contact');
    check('DAKOTA a complete zero-row manifest accepts an absent data file', empty?.records.length === 0, 'An empty completed module is different from an incomplete pull.');
    await manifest(deltaStamp, 2, 2);
    let countError = '';
    try { await readReplicas(scratch); } catch (e) { countError = (e as Error).message; }
    check('DAKOTA manifest count mismatches refuse import with a counts-only error', countError === 'Dakota replica count does not match its manifest.', 'Failure includes neither row content nor record identifiers.');
  } finally { await rm(scratch, { recursive: true, force: true }); }

  const rollback = new Error('invented-dakota-property-rollback');
  const mutableConfig = config.dakota as { perVehicleCap: number };
  const priorCap = mutableConfig.perVehicleCap;
  try {
    mutableConfig.perVehicleCap = 2;
    await db.transaction(async tx => {
      const local: Db = { ...db, ...tx, transaction: async fn => fn(tx) };
      const actor = randomUUID(), vehicle = randomUUID(), stamp = randomUUID();
      await tx.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,$2,'Invented Dakota Operator','DO','fixture','')`, [actor, `dakota-prop-${stamp}`]);
      await tx.query(`insert into platform.vehicle(id,slug,name,kind,exemption) values($1,$2,'Invented Neurotech Fixture','fund','506(c)')`, [vehicle, `dakota-neurotech-${stamp}`]);
      const entity = async (name: string, type = 'org') => {
        const id = randomUUID();
        await tx.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)', [id, type, name]);
        return id;
      };
      const identify = async (id: string, kind: string, value: string) => tx.query(`insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
        values($1,$2,$3,'invented_fixture',$4,'medium',$5)`, [id, kind, value, at, actor]);
      const existing = await entity('Invented Existing Allocator'), blocked = await entity('Invented Restricted Allocator');
      const namesake = await entity('Invented Nameless Match', 'person'), linked = await entity('Invented Linked Contact', 'person');
      await identify(existing, 'domain', 'dakota-existing.example');
      await identify(blocked, 'crd', '987654');
      await identify(linked, 'linkedin', 'linkedin.com/in/dakota-fixture-cio');
      await tx.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'discussing')`, [existing, vehicle, actor]);
      await tx.query(`insert into coordination.restriction(entity_id,scope,instruction,recorded_by) values($1,'blanket','Invented restriction',$2)`, [blocked, actor]);
      const acct = (id: string, extra: Record<string, unknown> = {}) => ({ account_id: id, investment_interest__c: 'healthcare', average_ticket_size__c: '500000', ...extra });
      const accounts = replica('account', 'account/invented-initial.jsonl', [
        acct('fixture-existing', { website: 'https://www.dakota-existing.example/', aum__c: '100000000', discretionary_assets__c: '80000000', billingcity: 'Invented City' }),
        acct('fixture-blocked', { crd__c: '000987654', investment_interest__c: 'healthcare life sciences neurotech deep tech' }),
        acct('fixture-top', { investment_interest__c: 'healthcare life sciences neurotech', aum__c: '90000000', arbitrary_secret: 'invented excluded' }),
        acct('fixture-allocator', { average_ticket_size__c: null, type: 'Endowment', venture_capital__c: true, investment_interest__c: 'healthcare neurotech' }),
        acct('fixture-cap-loser'),
        acct('fixture-too-small', { average_ticket_size__c: '499999', check_size_to__c: '9000000' }),
      ]);
      const contacts = replica('contact', 'contact/invented-initial.jsonl', [
        { contact_id: 'fixture-contact-name', accountid: 'fixture-existing', account_name__c: 'Invented Existing Allocator', firstname: 'Invented', lastname: 'Nameless Match', title: 'Operations Associate' },
        { id: 'fixture-contact-cio', accountid: 'fixture-existing', firstname: 'Invented', lastname: 'Linked Contact', title: 'Chief Investment Officer', linkedin_url__c: 'https://linkedin.com/in/dakota-fixture-cio' },
      ]);
      const first = await translateDakota(local, actor, [accounts, contacts]);
      const lookup = async (module: string, id: string) => (await tx.one<{ entity_id: string; root: string }>(`select entity_id::text,identity.canonical_entity_id(entity_id)::text root from dakota.${module} where id=$1`, [id]))!;
      const account = await lookup('account', 'fixture-existing'), name = await lookup('contact', 'fixture-contact-name'), cio = await lookup('contact', 'fixture-contact-cio');
      const possible = await tx.one(`select 1 from identity.possible_match where left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid) and active`, [name.entity_id, namesake]);
      check('DAKOTA name-only match remains separate and possible; corroborated identities redirect', name.root !== namesake && !!possible
        && account.root === existing && account.entity_id !== existing && cio.root === linked && first.merged >= 3,
        'Website, CRD and LinkedIn corroborate; a person name alone does not. Source entities remain intact.');
      const selected = await tx.query<{ id: string; status: string; status_source: string; status_reason: string }>(`select a.id,p.status::text,p.status_source,p.status_reason from strategy.pursuit p
        join dakota.account a on identity.canonical_entity_id(a.entity_id)=p.entity_id where p.vehicle_id=$1 and p.source='dakota' order by a.id`, [vehicle]);
      check('DAKOTA sources only the top capped eligible accounts and respects restrictions and pursued entities', selected.length === 2
        && selected.map(r => r.id).join(',') === 'fixture-allocator,fixture-top'
        && selected.every(r => r.status === 'new' && r.status_source === 'rule' && r.status_reason.includes('dakota-fit-v1') && r.status_reason.includes('investment_interest__c')),
        'Restricted, already pursued, under-threshold and lower-ranked accounts are not added to the invented vehicle.');
      const claims = await tx.query<{ source: string; as_of: Date; confidence: string; last_verified_by: string; replica_file: string }>('select source,as_of,confidence,last_verified_by::text,replica_file from dakota.claim');
      check('DAKOTA every claim retains the provenance tuple and record modification date', claims.length > 0 && claims.every(c => c.source === 'dakota'
        && c.as_of.toISOString() === at && c.confidence === 'medium' && c.last_verified_by === actor && !!c.replica_file), `${claims.length} invented claims have source, as_of, confidence and verifier.`);
      const display = await dakotaFor(tx, existing);
      const ties = await tx.query<{ tier: string; evidence: Array<Record<string, unknown>> }>(`select e.tier::text,e.evidence from dakota.employment d join network.edge e on e.edge_id=d.edge_id`);
      check('DAKOTA groups contacts under their account and ranks the likely first contact with tier-C ties', display.contacts.length === 2
        && display.contacts[0]!.title === 'Chief Investment Officer' && display.contacts[0]!.likely && !display.contacts[1]!.likely && display.capacity?.amount === 500000
        && ties.length === 2 && ties.every(t => t.tier === 'C' && t.evidence.every(e => e.source === 'dakota' && e.as_of === at && e.last_verified_by === actor && !!e.confidence)), 'Contact order and estimate retain sourced uncertainty.');
      const snapshot = async () => JSON.stringify(await tx.query(`select
        (select jsonb_agg(to_jsonb(x) order by id) from dakota.account x) accounts,
        (select jsonb_agg(to_jsonb(x) order by id) from dakota.contact x) contacts,
        (select jsonb_agg(to_jsonb(x) order by module,record_id,field) from dakota.claim x) claims,
        (select jsonb_agg(to_jsonb(x) order by entity_id) from identity.entity x) entities,
        (select jsonb_agg(to_jsonb(x) order by affiliation_id) from identity.affiliation x) affiliations,
        (select jsonb_agg(to_jsonb(x) order by edge_id) from network.edge x) edges,
        (select jsonb_agg(to_jsonb(x) order by pursuit_id) from strategy.pursuit x) pursuits,
        (select jsonb_agg(to_jsonb(x) order by asserted_at,assertion_id) from identity.match_assertion x) assertions,
        (select jsonb_agg(to_jsonb(x) order by entity_id,kind,value,source) from identity.external_identifier x) identifiers,
        (select jsonb_agg(to_jsonb(x)) from network.edge_revision x) edge_revision`));
      const before = await snapshot(), repeated = await translateDakota(local, actor, [accounts, contacts]);
      check('DAKOTA translating the same replica is idempotent including timestamps and source facts', before === await snapshot()
        && Object.values(repeated).every(v => v === 0), 'Full rows, IDs, provenance and timestamps remain unchanged; the cap does not drain on repeated clicks.');
      const stored = await tx.one<Record<string, unknown>>('select * from dakota.account where id=$1', ['fixture-top']);
      const metadata = ['entity_id', 'replica_file', 'source', 'confidence', 'last_verified_by', 'likely_contact_id'];
      check('DAKOTA persisted account columns hold only needed fields and provenance', !!stored && Object.keys(stored).every(k => needed('account').includes(k) || metadata.includes(k))
        && !JSON.stringify(stored).includes('invented excluded'), 'Undocumented input fields never become stored blobs.');
      const untouchedBefore = await tx.one('select to_jsonb(a) as row from dakota.account a where id=$1', ['fixture-top']);
      const delta = await translateDakota(local, actor, [replica('account', 'account/invented-delta.jsonl', [{ id: 'fixture-existing', lastmodifieddate: nextAt, aum__c: '120000000', billingcity: null }])]);
      const updated = await tx.one<{ aum__c: string; average_ticket_size__c: string; website: string; billingcity: string | null; replica_file: string }>('select aum__c,average_ticket_size__c,website,billingcity,replica_file from dakota.account where id=$1', ['fixture-existing']);
      check('DAKOTA newer sparse deltas update supplied fields, preserve omitted fields and leave other records unchanged', delta.accounts === 1
        && updated?.aum__c === '120000000' && updated.average_ticket_size__c === '500000' && updated.website === 'https://www.dakota-existing.example/'
        && updated.billingcity === null && updated.replica_file === 'account/invented-delta.jsonl'
        && JSON.stringify(untouchedBefore) === JSON.stringify(await tx.one('select to_jsonb(a) as row from dakota.account a where id=$1', ['fixture-top'])), 'Explicit null clears; absent fields preserve prior values.');
      const prior = await snapshot();
      const older = await translateDakota(local, actor, [replica('account', 'account/invented-old.jsonl', [{ id: 'fixture-existing', aum__c: '1' }])]);
      check('DAKOTA older deltas cannot overwrite newer records or claims', older.unchanged === 1 && prior === await snapshot(), 'Record lastmodifieddate controls freshness.');
      let immutable = false;
      try { await translateDakota(local, actor, [{ ...accounts, hash: 'invented-changed-hash' }]); } catch { immutable = true; }
      check('DAKOTA completed replica hash changes fail closed', immutable && prior === await snapshot(), 'A previously imported file cannot silently change its meaning.');
      const assertion = (await tx.one<{ id: string }>('select assertion_id::text id from identity.match_assertion where merged_entity=$1 and undone_at is null', [account.entity_id]))!;
      const undone = await undoIdentityMerge(local, assertion.id, 'Invented fixture correction');
      await translateDakota(local, actor, [replica('account', 'account/invented-after-undo.jsonl', [{ id: 'fixture-existing', lastmodifieddate: '2026-09-04T00:00:00Z', aum__c: '130000000' }])]);
      check('DAKOTA identity corrections survive newer corroborated records', undone && (await lookup('account', 'fixture-existing')).root === account.entity_id,
        'An undone source-owned redirect is not recreated merely because the vendor repeats its identifier.');
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('invented_fixture','person-name',$1,'invented fixture')`, [namesake]);
      await identify(namesake, 'linkedin', 'linkedin.com/in/dakota-constrained-person');
      await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,note)
        values('not_same_as','dakota','contact:fixture-contact-name','invented_fixture','person-name','Invented namesake correction')`);
      await translateDakota(local, actor, [replica('contact', 'contact/invented-constrained.jsonl', [{ id: 'fixture-contact-name', lastmodifieddate: nextAt, linkedin_url__c: 'https://linkedin.com/in/dakota-constrained-person' }])]);
      check('DAKOTA explicit not-same-as constraints override corroborating identifiers', (await lookup('contact', 'fixture-contact-name')).root !== namesake,
        'A correction attached to source identities takes precedence over a repeated LinkedIn URL.');

      // Compare the bounded capacity read to the original whole-resolution query,
      // including multi-hop aliases and a newer account without a usable ticket.
      const root = await entity('Invented Capacity Root'), middle = await entity('Invented Capacity Alias'), leaf = await entity('Invented Capacity Leaf');
      const person = await entity('Invented Capacity Contact', 'person');
      await tx.query('update identity.entity set merged_into=$1 where entity_id=$2', [root, middle]);
      await tx.query('update identity.entity set merged_into=$1 where entity_id=$2', [middle, leaf]);
      await tx.query(`insert into dakota.account(id,entity_id,lastmodifieddate,replica_file,last_verified_by,average_ticket_size__c,check_size_from__c,private_equity_average_ticket_size__c)
        values('invented-capacity-old',$1,'2026-09-01','invented',$4,'500000',null,null),
          ('invented-capacity-a',$2,'2026-09-02','invented',$4,'unknown','750000',null),
          ('invented-capacity-b',$2,'2026-09-02','invented',$4,null,null,'900000'),
          ('invented-capacity-new',$3,'2026-09-03','invented',$4,'unknown',null,null)`, [root,middle,leaf,actor]);
      await tx.query(`insert into dakota.contact(id,entity_id,accountid,lastmodifieddate,replica_file,last_verified_by)
        values('invented-capacity-contact',$1,'invented-capacity-a','2026-09-02','invented',$2)`, [person,actor]);
      const capacityIds = [existing, linked, root, root, middle, leaf, person, randomUUID()];
      const legacyRows = await tx.query<RecordFields & {target:string;last_verified_by:string}>(`select a.*,r.canonical_id::text target from dakota.account a
        join identity.entity_resolution r on r.entity_id=a.entity_id where r.canonical_id=any($1::uuid[])
        union all select a.*,r.canonical_id::text target from dakota.contact c join dakota.account a on a.id=c.accountid
        join identity.entity_resolution r on r.entity_id=c.entity_id where r.canonical_id=any($1::uuid[])
        order by lastmodifieddate desc,id`, [capacityIds]);
      const legacy = new Map<string,{amount:number;basis:string;asOf:string;verifiedBy:string}>();
      for (const r of legacyRows) {
        const estimate = ticketEstimate(r);
        if (estimate && !legacy.has(r.target)) legacy.set(r.target, {...estimate,
          basis:`${estimate.basis} The basis belongs to the matched account; for a contact it describes their employer, not personal wealth.`,
          asOf:new Date(r.lastmodifieddate).toISOString(),verifiedBy:r.last_verified_by});
      }
      const bounded = await dakotaCapacities(tx,capacityIds);
      check('DAKOTA bounded capacities preserve the original projection across aliases, employer records and fallback ordering',
        JSON.stringify([...bounded]) === JSON.stringify([...legacy]) && bounded.get(root)?.amount === 750000
          && bounded.get(person)?.amount === 750000 && !bounded.has(middle) && !bounded.has(leaf)
          && (await dakotaCapacities(tx,[])).size === 0,
        'Newest usable ticket wins; equal dates retain account-ID order, merged aliases retain canonical targets, provenance is identical.');
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
  finally { mutableConfig.perVehicleCap = priorCap; }
}
