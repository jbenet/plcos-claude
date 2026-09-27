/**
 * Invented LP-unit cases for the demo (issues 0111, 0112; docs/23), added to an existing demo
 * database in their "before" state — people's pursuits as they were recorded — so "Re-point pursuits
 * to their LP" (Developer → Enrich) has something to decide:
 *   - Halden Brook Partners: a joint vehicle whose two founders also invest personally (the pattern
 *     of a GP pair's own fund); the firm has its own pursuit, and each founder has evidence.
 *   - Marrow Hill Capital: one employee pursued, no evidence of personal investing: moves to the firm.
 *   - Otto Vance: an angel with no firm.
 *   - Selma Quist: at a company nothing says invests: flagged for review.
 * Every name is fictional. Refuses the real profile; stop the demo server first (one PGlite writer).
 *   node --import tsx scripts/lp-units-demo.ts
 */
import { config } from '../config/deployment';
import { openFresh } from '../lib/db';

async function main() {
  if (config.data.profile === 'real') {
    console.error('Refusing: invented cases go into the demo database only.');
    process.exit(1);
  }
  const db = await openFresh();
  if (await db.one("select 1 from identity.source_record where source='seed' and source_id='lpu-halden-brook'")) {
    console.log('The invented LP-unit cases are already in this demo database.');
    await db.close(); return;
  }
  const user = (h: string) => db.one<{ id: string }>('select id::text from platform.app_user where handle=$1', [h]).then(r => r!.id);
  const vehicle = (slug: string) => db.one<{ id: string }>('select id::text from platform.vehicle where slug=$1', [slug]).then(r => r!.id);
  const [juan, mara, neuro, cortex] = await Promise.all([user('juan'), user('mara'), vehicle('neurotech'), vehicle('spv-cortex')]);
  await db.transaction(async tx => {
    const entity = async (key: string, type: string, name: string) => {
      const id = (await tx.one<{ id: string }>('insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id', [type, name]))!.id;
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('seed',$1,$2,'human:seed')`, [key, id]);
      return id;
    };
    const affiliate = (person: string, org: string, kind: string, role: string, primary = true) => tx.query(
      `insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,as_of,certainty,source)
       values($1,$2,$3::identity.affil_kind,$4,$5,'2026-09-01','known','invented demo case')`, [person, org, kind, role, primary]);
    const pursue = async (e: string, v: string, owner: string, status: string, human: boolean, headline: string) => {
      const id = (await tx.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,headline,status,status_source,status_set_at,status_set_by,source)
        values($1,$2,$3,$4,$5::strategy.pursuit_status,$6,case when $6='us' then now() - interval '3 days' end,case when $6='us' then $3::uuid end,'us') returning pursuit_id::text id`,
        [e, v, owner, headline, status, human ? 'us' : 'rule']))!.id;
      if (human) await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'pursuit.status_set','pursuit',$2,$3::jsonb)`,
        [owner, id, JSON.stringify({ fromId: 'new', toId: status, from: 'New', to: status, statusSource: 'us', reason: 'Invented demo case' })]);
      return id;
    };
    const profile = (e: string, investorType: string) => tx.query(`insert into research.note(entity_id,kind,body,data) values($1,'public_profile',$2,$3::jsonb)`,
      [e, 'Invented research profile for the LP-unit demo.', JSON.stringify({ profile: { investorType } })]);

    // 1. A joint vehicle whose two founders also invest personally.
    const halden = await entity('lpu-halden-brook', 'org', 'Halden Brook Partners');
    const tove = await entity('lpu-tove-halden', 'person', 'Tove Halden');
    const idris = await entity('lpu-idris-brook', 'person', 'Idris Brook');
    await affiliate(tove, halden, 'principal', 'Co-founder');
    await affiliate(idris, halden, 'principal', 'Co-founder');
    await profile(tove, 'angel');
    await tx.query(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context',$3,$4::jsonb)`,
      [idris, juan, 'Invented prospect row: named without a firm.', JSON.stringify({ source: 'prospects', entityType: 'person', org: null, name: 'Idris Brook' })]);
    for (const v of [neuro, cortex]) {
      await pursue(halden, v, juan, 'sourcing', false, 'Invented: the founders’ joint vehicle.');
      await pursue(tove, v, juan, 'sourcing', false, 'Invented: invests personally as well as through the joint vehicle.');
      await pursue(idris, v, juan, 'new', false, 'Invented: invests personally as well as through the joint vehicle.');
    }
    // 2. One employee pursued; nothing says they invest personally.
    const marrow = await entity('lpu-marrow-hill', 'org', 'Marrow Hill Capital');
    const petra = await entity('lpu-petra-lund', 'person', 'Petra Lund');
    await affiliate(petra, marrow, 'staff', 'Associate');
    await pursue(petra, neuro, mara, 'selected', true, 'Invented: our contact at Marrow Hill.');
    await pursue(petra, cortex, mara, 'sourcing', false, 'Invented: our contact at Marrow Hill.');
    // 3. A pure angel.
    const otto = await entity('lpu-otto-vance', 'person', 'Otto Vance');
    await profile(otto, 'angel');
    await pursue(otto, cortex, juan, 'new', false, 'Invented: an angel with no firm.');
    await pursue(otto, neuro, juan, 'sourcing', false, 'Invented: an angel with no firm.');
    // 4. Ambiguous: a company that nothing says invests.
    const quist = await entity('lpu-quist-robotics', 'org', 'Quist Robotics');
    const selma = await entity('lpu-selma-quist', 'person', 'Selma Quist');
    await affiliate(selma, quist, 'principal', 'Founder and CEO');
    await pursue(selma, neuro, juan, 'sourcing', false, 'Invented: a founder; firm or personal is not clear.');
  });
  console.log('Added the invented LP-unit cases: 4 organisations and people across PLC Neurotech I and SPV — Cortex.');
  await db.close();
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
