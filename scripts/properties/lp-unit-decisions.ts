import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../lib/db';
import { readLpUnitDecisions, repointWithLpUnitDecisions, type LpUnitDecisionInput } from '../../lib/enrich/lp-unit-decisions';
import { exportLpUnitReview } from '../../lib/enrich/lp-unit-review-export';
import { decideLpUnitByPerson, repointPursuits, reverseLpRepoint } from '../../modules/strategy/lp-units';
import type { Check } from './harness';

export async function lpUnitDecisionProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active limit 1'))!.id;
  const vehicle = (await db.one<{ id: string }>("select id::text from platform.vehicle where phase='active' and kind='fund' limit 1"))!.id;
  const scratch = await mkdtemp(join(tmpdir(), 'invented-lp-review-'));
  const fixture = async (name: string) => {
    const person = randomUUID(), firm = randomUUID(), pursuit = randomUUID();
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,'person',$3),($2,'org',$4)`,
      [person, firm, `Invented ${name}`, `Invented ${name} Robotics`]);
    await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,as_of,certainty)
      values($1,$2,'staff','Director',true,'2026-09-01','known')`, [person, firm]);
    await db.query(`insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,status,status_source)
      values($1,$2,$3,$4,'sourcing','rule')`, [pursuit, person, vehicle, actor]);
    return { person, firm, pursuit };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const evidence = [{ source: 'https://example.org/invented-lp', as_of: '2026-09-27', quote: 'Invented public evidence of the named investing capacity.' }];
  const proposal = (f: Fixture, decision = 'personal', extra: Record<string, unknown> = {}): LpUnitDecisionInput => ({ line: 1,
    value: { pursuitId: f.pursuit, decision, ...(decision === 'firm' ? { firmEntityId: f.firm } : {}), evidence, decided_by: 'fixture-researcher', ...extra } });
  const run = (inputs: LpUnitDecisionInput[], handle = db) => repointWithLpUnitDecisions(handle, actor, inputs);
  const state = (f: Fixture) => db.one<{ lp_capacity: string | null; merged_into: string | null; lp_review: string | null }>(
    'select lp_capacity,merged_into::text,lp_review from strategy.pursuit where pursuit_id=$1', [f.pursuit]);
  const journal = (f: Fixture) => db.one<{ id: string; file_decision: { key: string; decided_by: string }; evidence: unknown[] }>(
    "select id::text,file_decision,evidence from strategy.lp_repoint where pursuit_id=$1 and decided_by='file'", [f.pursuit]);
  try {
    const personal = await fixture('Personal'), firm = await fixture('Firm'), human = await fixture('Human'), changed = await fixture('Changed');
    const soft = await fixture('Soft'), hard = await fixture('Hard'), pool = await fixture('Pool'), rung = await fixture('Ladder');
    const outsider = await fixture('Outsider'), conflict = await fixture('Conflict'), atomic = await fixture('Atomic');
    const privateText = await fixture('Private reader@example.org +1 (212) 555-9876 $123456');
    for (const f of [soft, hard]) await db.query(`insert into pipeline.exposure(entity_id,vehicle_id,instrument,track,amount,owner_id,evidence_ref)
      values($1,$2,'lp_commitment',$3::pipeline.track,123456,$4,'invented signed record')`, [f.person, vehicle, f === hard ? 'hard' : 'soft', actor]);
    await db.query(`insert into pipeline.capital_pool(entity_id,budget,source,as_of) values($1,987654,'invented','2026-09-01')`, [pool.person]);
    await db.query(`insert into strategy.ladder_event(pursuit_id,rung,evidence_kind,evidence_ref,evidence_note,recorded_by,occurred_at)
      values($1,'indication_given','fixture','invented','Invented indication',$2,'2026-09-01')`, [rung.pursuit, actor]);
    const moneySnapshot = async () => JSON.stringify({
      exposures: await db.query('select * from pipeline.exposure where entity_id=any($1::uuid[]) order by exposure_id', [[soft.person, hard.person]]),
      pools: await db.query('select * from pipeline.capital_pool where entity_id=$1', [pool.person]),
    });
    const moneyBefore = await moneySnapshot();
    await repointPursuits(db, actor);
    await decideLpUnitByPerson(db, human.pursuit, actor, { kind: 'personal' });
    // A hard commitment normally settles personal; simulate an older unresolved review to
    // ensure file and page choices still check the shared guard, independent of rule order.
    await db.query("update strategy.pursuit set lp_review='Invented unresolved owner' where pursuit_id=$1", [hard.pursuit]);
    const beforeExport = JSON.stringify(await db.query('select * from strategy.lp_repoint order by id'));
    const exported = await db.transaction(exportLpUnitReview);
    const privateRow = exported.find(r => r.pursuitId === privateText.pursuit)!;
    const serialized = JSON.stringify(privateRow);
    check('LP REVIEW export is read-only, includes candidates and rule evidence, and excludes amounts/contact strings',
      beforeExport === JSON.stringify(await db.query('select * from strategy.lp_repoint order by id'))
      && privateRow.firms.length === 1 && privateRow.firms[0]!.knownToInvest === false && !!privateRow.reason
      && !/reader@|555-9876|123456|987654/.test(serialized)
      && exported.find(r => r.pursuitId === soft.pursuit)?.amountsOnFile === 'present'
      && exported.find(r => r.pursuitId === pool.pursuit)?.amountsOnFile === 'present'
      && exported.find(r => r.pursuitId === firm.pursuit)?.amountsOnFile === 'absent'
      && !exported.some(r => r.pursuitId === human.pursuit),
      'All values come from invented fixtures; presence replaces monetary values, including capital pools.');

    const good = [proposal(personal), proposal(firm, 'firm')];
    await writeFile(join(scratch, 'lp-unit-decisions.jsonl'), '\n{broken\n' + good.map(p => JSON.stringify(p.value)).join('\n'));
    const inputs = await readLpUnitDecisions(scratch);
    const applied = await run(inputs);
    check('LP DECISIONS malformed lines are listed while valid personal and firm decisions apply',
      inputs[0]?.line === 2 && applied.fileDecisions.applied === 2 && applied.fileDecisions.refused[0]?.line === 2
      && (await state(personal))?.lp_capacity === 'personal' && !!(await state(firm))?.merged_into
      && (await journal(firm))?.file_decision.decided_by === 'fixture-researcher'
      && JSON.stringify((await journal(firm))?.evidence).includes('https://example.org/invented-lp'),
      'Both decisions retain source/date/quote and researcher attribution in the reversible journal.');
    const retry = await run(good);
    check('LP DECISIONS unchanged retries write no duplicate journals and the rule preserves file answers',
      retry.fileDecisions.skipped === 2 && retry.fileDecisions.applied === 0 && (await state(personal))?.lp_capacity === 'personal',
      'The normalized decision hash is a persisted receipt; a personal answer survives contrary affiliation evidence.');

    const refusals = await run([proposal(human, 'firm'), proposal(soft, 'firm'), proposal(hard, 'firm'), proposal(pool, 'firm'),
      proposal(rung, 'firm'), proposal(outsider, 'firm', { firmEntityId: firm.firm }),
      proposal(conflict), proposal(conflict, 'firm'), proposal(changed, 'personal', { pursuitId: randomUUID() }),
      proposal(changed, 'wrong'), proposal(changed, 'personal', { evidence: [] }),
      proposal(changed, 'personal', { evidence: [{ ...evidence[0], as_of: '2026-02-30' }] }),
      proposal(changed, 'personal', { decided_by: '' }), proposal(changed, 'personal', { firmEntityId: changed.firm })]);
    check('LP DECISIONS invalid and conflicting proposals are refused with reasons; a person’s decision wins',
      refusals.fileDecisions.refused.length === 14 && refusals.fileDecisions.applied === 0
      && refusals.fileDecisions.refused.some(r => r.reason.includes('takes precedence'))
      && refusals.fileDecisions.refused.filter(r => r.reason.includes('Money')).length === 4
      && !(await state(outsider))?.merged_into && !(await state(conflict))?.merged_into,
      'Unknown pursuit/firm, conflicts, invalid kind/date/evidence/reviewer and money all fail closed.');
    let pageRefused = 0;
    for (const f of [soft, hard, pool, rung]) try { await decideLpUnitByPerson(db, f.pursuit, actor, { kind: 'firm', orgId: f.firm }); } catch { pageRefused++; }
    check('LP DECISIONS the LP page shares the money guard', pageRefused === 4 && moneyBefore === await moneySnapshot(),
      'Soft and signed exposures, capital pools and high ladder events prevent moving a pursuit between names.');

    const broken: Db = { ...db, transaction: work => db.transaction(tx => work({ ...tx,
      query: (sql, params) => {
        if (sql.startsWith('update strategy.lp_repoint set file_decision') && String(params?.[1]).includes(atomic.pursuit))
          throw new Error('Invented journal failure after move');
        return tx.query(sql, params);
      }, one: tx.one.bind(tx), exec: tx.exec.bind(tx),
    })) };
    const partial = await run([proposal(atomic, 'firm'), proposal(changed)], broken);
    check('LP DECISIONS each line rolls back fully after a write failure while its neighbour applies',
      partial.fileDecisions.applied === 1 && partial.fileDecisions.refused.length === 1
      && !(await state(atomic))?.merged_into && (await state(changed))?.lp_capacity === 'personal'
      && !await db.one('select 1 from strategy.pursuit where entity_id=$1', [atomic.firm]),
      'Failure after the move removes its created firm pursuit, contact, history changes and journal.');

    const firmJournal = (await journal(firm))!;
    await reverseLpRepoint(db, firmJournal.id, actor, 'Invented reversal');
    const reversedRetry = await run([proposal(firm, 'firm')]);
    check('LP DECISIONS firm decisions reverse through the LP journal and cannot replay',
      !(await state(firm))?.merged_into && reversedRetry.fileDecisions.applied === 0
      && reversedRetry.fileDecisions.refused[0]?.reason.includes('reversed') === true
      && !await db.one('select 1 from strategy.pursuit where entity_id=$1', [firm.firm]),
      'Compare-and-restore removes the created firm pursuit and restores the original review.');
    const personalJournal = (await journal(personal))!;
    await reverseLpRepoint(db, personalJournal.id, actor, 'Invented personal reversal');
    check('LP DECISIONS personal decisions restore the prior review on reversal',
      !(await state(personal))?.lp_capacity && !!(await state(personal))?.lp_review,
      'Personal and firm answers both use exact row changes.');
    await decideLpUnitByPerson(db, changed.pursuit, actor, { kind: 'personal' });
    const humanAfter = await run([proposal(changed, 'firm')]);
    check('LP DECISIONS a later LP-page answer also wins over file proposals',
      humanAfter.fileDecisions.refused[0]?.reason.includes('takes precedence') === true && !(await state(changed))?.merged_into,
      'File attribution is distinct from a person’s choice, before or after import.');

    const status = await fixture('Status'), alias = await fixture('Alias'), ended = await fixture('Ended');
    await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source)
      values($1,$2,$3,'passed','us')`, [status.firm, vehicle, actor]);
    const aliasId = randomUUID();
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name,merged_into) values($1,'person','Invented money alias',$2)`, [aliasId, alias.person]);
    await db.query(`insert into pipeline.exposure(entity_id,vehicle_id,instrument,track,amount,owner_id)
      values($1,$2,'lp_commitment','soft',1234,$3)`, [aliasId, vehicle, actor]);
    await repointPursuits(db, actor);
    await db.query("update identity.affiliation set ended_on='2026-09-26' where person_entity=$1", [ended.person]);
    const guarded = await run([proposal(status, 'firm'), proposal(alias, 'firm'), proposal(ended, 'firm')]);
    check('LP DECISIONS current status, aliases and affiliations are rechecked at application',
      guarded.fileDecisions.refused.length === 3 && guarded.fileDecisions.applied === 0
      && guarded.fileDecisions.refused.some(r => r.reason.includes('Passed'))
      && guarded.fileDecisions.refused.some(r => r.reason.includes('Money'))
      && guarded.fileDecisions.refused.some(r => r.reason.includes('affiliation')),
      'Person-set Passed cannot be silently overwritten; money on a canonical alias and ended affiliations fail closed.');

    // The export must not accidentally reuse the 200/300-row UI report limit.
    await db.query(`with people as (
      insert into identity.entity(entity_type,display_name) select 'person','Invented review batch' from generate_series(1,305) returning entity_id
    ) insert into strategy.pursuit(entity_id,vehicle_id,owner_id,lp_review) select entity_id,$1,$2,'Invented unresolved capacity' from people`, [vehicle, actor]);
    const large = await db.transaction(exportLpUnitReview);
    check('LP REVIEW exports every review item beyond the UI limit',
      large.filter(r => r.person.name === 'Invented review batch').length === 305,
      'One row per pursuit, independent of research status and display caps.');
    check('LP DECISIONS missing file means no proposals', (await readLpUnitDecisions(join(scratch, 'missing'))).length === 0
      && (await readFile(join(scratch, 'lp-unit-decisions.jsonl'), 'utf8')).includes('{broken'), 'Only ENOENT is treated as absent.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
