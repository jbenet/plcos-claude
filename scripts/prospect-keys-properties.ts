/** Invented W1/W5 files only, imported into the harness's demo database. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb, type Db } from '../lib/db';
import { importFindings } from '../lib/enrich/import';
import type { Finding } from '../lib/enrich/schema';
import type { Strategy } from '../lib/enrich/strategy';
import type { Check } from './properties/harness';

export async function prospectKeysProperties(check: Check, db: Db) {
  const dir = await mkdtemp(join(tmpdir(), 'invented-prospect-keys-'));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const [original, intermediate, canonical] = ids as [string, string, string];
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text, slug from platform.vehicle where phase <> 'historical' order by slug limit 1"))!;
  const key = 'invented-prospect-keys:cedar', member = 'member:invented-prospect-keys-cedar';
  const finding = (key: string): Finding => ({
    key, name: 'Invented Key Cedar', researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1' },
    identity: { match: 'confirmed', basis: 'Invented sourced identity' },
    facts: [{ field: 'role', value: 'Invented operator', confidence: 'high',
      source: { url: 'https://example.org/invented-prospect-keys', kind: 'primary' } }], connections: [],
  });
  const strategy = (key: string): Strategy => ({
    key, name: 'Invented Key Cedar', made: { at: '2026-09-27', by: 'fixture', workflow: 'W5', version: '1.18' },
    fit: { [vehicle.slug]: { verdict: 'possible', why: 'Invented fixture' } },
    scores: { capacity: { band: 'unknown', basis: 'Invented fixture' }, affinity: { level: 'unknown', basis: 'Invented fixture' },
      propensity: { level: 'unknown', basis: 'Invented fixture' }, timeToDecision: { band: 'unknown', basis: 'Invented fixture' } },
    angle: 'Invented angle', route: null, next: { what: 'Review invented evidence', who: 'Fixture owner', when: '2026-10-01' },
    ask: { vehicle: vehicle.slug, shape: 'verify first' }, openQuestions: [], risks: [], list: 'this year', confidence: 'low',
  });
  const write = async (key: string) => {
    for (const folder of ['raw', 'strategy']) {
      await rm(join(dir, folder), { recursive: true, force: true });
      await mkdir(join(dir, folder));
    }
    await writeFile(join(dir, 'raw', `${key}.json`), JSON.stringify(finding(key)));
    await writeFile(join(dir, 'strategy', `${key}.json`), JSON.stringify(strategy(key)));
  };
  const run = () => withDb(db, () => importFindings(null, dir));
  const alias = (source: string, key: string, id: string) => db.query(
    `insert into identity.source_record (source,source_id,entity_id,resolved_by) values ($1,$2,$3,'invented:key-fixture')`, [source, key, id]);
  const snapshot = async () => JSON.stringify({
    claims: await db.query(`select entity_id,field,value,source,as_of,confidence,last_verified_by from research.claim where entity_id=any($1::uuid[]) order by entity_id,field,source,value,claim_id`, [ids]),
    profiles: await db.query(`select entity_id,kind,body,tags,data from research.note where kind='public_profile' and entity_id=any($1::uuid[]) order by entity_id,kind,body,tags,data,note_id`, [ids]),
    suggestions: await db.query(`select pursuit_id,body,data,made_by,made_at,status from strategy.suggestion where pursuit_id in
      (select pursuit_id from strategy.pursuit where entity_id=any($1::uuid[])) order by pursuit_id,body,data,made_by,made_at,status,suggestion_id`, [ids]),
  });
  const clearSuggestions = () => db.query(`delete from strategy.suggestion where pursuit_id in
    (select pursuit_id from strategy.pursuit where entity_id=any($1::uuid[]))`, [ids]);
  try {
    for (const id of ids) await db.query("insert into identity.entity (entity_id,entity_type,display_name) values ($1,'person','Invented Key Cedar')", [id]);
    await write(key);
    const unmapped = await run();
    const refusal = `key ${key} is not mapped yet; run Add prospects (or Import portfolio) first`;
    check('PROSPECT-KEYS unmapped W1 and W5 keys are refused with actionable original-key diagnostics',
      unmapped.rejected === 1 && unmapped.mapped === 0 && unmapped.proposed === 0
      && unmapped.problems.some(p => p.key === key && p.problems.includes(refusal))
      && unmapped.problems.some(p => p.key === key && p.problems.includes(`strategy: ${refusal}`)),
      'Unknown source keys do not reach UUID SQL or write research.');

    await alias('prospect_key', key, original);
    await alias('warehouse', member, original);
    await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [original, intermediate]);
    await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [intermediate, canonical]);
    const beforePursuit = await run();
    check('PROSPECT-KEYS mapped strategies without a pursuit explicitly promise retry on the next import',
      beforePursuit.mapped === 1 && beforePursuit.proposed === 0 && beforePursuit.problems.some(p => p.key === key
        && p.problems.includes('strategy: no open pursuit in the named vehicle; not imported; retried on the next import once the pursuit exists')),
      'The original file key stays in diagnostics and the refused strategy is not marked imported.');
    await db.query(`insert into strategy.pursuit (entity_id,vehicle_id,owner_id,status) values ($1,$2,$3,'new')`, [canonical, vehicle.id, actor]);
    const imported = await run();
    const stored = await db.one<{ id: string; key: string }>(`select p.entity_id::text id,s.data->>'key' key
      from strategy.suggestion s join strategy.pursuit p using(pursuit_id) where p.entity_id=$1`, [canonical]);
    check('PROSPECT-KEYS W1 and W5 follow merge chains and retry successfully after a pursuit is created',
      imported.mapped === 1 && imported.claims === 1 && imported.proposed === 1 && stored?.id === canonical && stored.key === canonical
      && (await db.one<{ n: number }>('select count(*)::int n from research.claim where entity_id=$1', [canonical]))?.n === 1,
      'The source alias points to the original person; both imports write to the canonical person.');
    const mappedSnapshot = await snapshot();
    const retry = await run();
    check('PROSPECT-KEYS retry does not duplicate mapped claims, profiles or strategy suggestions',
      retry.mapped === 1 && retry.proposed === 0 && mappedSnapshot === await snapshot(),
      'Original file hashes retain strategy idempotence after key resolution.');

    await clearSuggestions();
    await write(canonical);
    const uuidResult = await run();
    check('PROSPECT-KEYS a prospect key imports the same research and strategy payload as the canonical UUID',
      uuidResult.mapped === 1 && uuidResult.proposed === 1 && mappedSnapshot === await snapshot(),
      'Compared persisted claims, profile and strategy fields, excluding generated IDs and file hashes.');
    await clearSuggestions();
    await write(member);
    const memberResult = await run();
    check('PROSPECT-KEYS full member keys resolve through warehouse and import identically to UUIDs after merges',
      memberResult.mapped === 1 && memberResult.proposed === 1 && mappedSnapshot === await snapshot(),
      'The member: prefix is preserved in the warehouse source lookup.');
    await clearSuggestions();
    await write(original);
    const oldUuid = await run();
    check('PROSPECT-KEYS an old UUID follows the same canonical import path as source keys',
      oldUuid.mapped === 1 && oldUuid.proposed === 1 && mappedSnapshot === await snapshot(),
      'Merge redirects apply consistently to direct UUID files.');

    await clearSuggestions();
    await write('member:invented-unmapped');
    const unmappedMember = await run();
    check('PROSPECT-KEYS an unmapped member key is refused without guessing an identity',
      unmappedMember.rejected === 1 && unmappedMember.proposed === 0
      && unmappedMember.problems.every(p => p.problems.every(s => s.includes('key member:invented-unmapped is not mapped yet;'))),
      'Both import types report the missing member mapping.');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await clearSuggestions();
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.claim where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])', [ids]);
    await db.query("delete from research.source_doc where origin='https://example.org/invented-prospect-keys'");
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
  }
}
