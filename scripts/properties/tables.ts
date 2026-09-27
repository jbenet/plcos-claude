/** Invented fixtures: table scope, score reuse and consequential bulk commands. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { applyBulk, type BulkInput } from '../../lib/pipeline-bulk';
import { pipelineData, scoreDetail } from '../../lib/pipeline-data';
import { provisionalScore } from '../../lib/strategy-score';
import { compareRows, groupRows, SORT_KEYS } from '../../components/strategy/pipeline-model';
import type { Check } from './harness';
export async function tableProperties(check: Check, db: Db) {
  await withDb(db, async () => {
    const actor = (await db.one<{ id: string }>('select id from platform.app_user where active limit 1'))!.id;
    const vehicles = await db.query<{ id: string; name: string }>("select id,name from platform.vehicle where kind='fund' order by sort_order limit 2");
    const entity = randomUUID();
    await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person','Invented Table Elm')",[entity]);
    const ids: string[] = [];
    for (const v of vehicles) ids.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,next_step)
      values($1,$2,$3,'new','Keep this invented next step') returning pursuit_id id`,[entity,v.id,actor]))!.id);
    const count = async (table: string) => Number((await db.one<{ n: string }>(`select count(*)::text n from ${table}`))!.n);
    const rungs = await count('strategy.ladder_event');
    try {
      const first = vehicles[0]!; const second = vehicles[1]!;
      const scores = { capacity: { band: '$1–5M' }, affinity: { level: 'high' }, propensity: { level: 'medium' }, timeToDecision: { band: 'weeks' } };
      await db.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash)
        values($1,'Invented strategy',$2,'fixture',now(),'0067-fixture')`,[ids[1],JSON.stringify({ scores, ask: { vehicle: second.name } })]);
      const a = (await pipelineData(first.id)).rows.find(r => r.id === ids[0])!;
      const b = (await pipelineData(second.id)).rows.find(r => r.id === ids[1])!;
      check('0067/0071 pursuits without manual factors stay visible and scores stay vehicle-specific',
        a.status === 'new' && a.score === null && b.score === provisionalScore(scores), 'No factor rows; same person in two vehicles; only the second has a strategy.');
      const detail = await scoreDetail(second.id, ids[1]!);
      check('0089 the selection detail shows each reading behind a provisional score, and only inside its vehicle',
        detail?.kind === 'provisional' && detail.parts.length === 4 && detail.parts.every(p => p.value !== null && p.weight > 0)
          && await scoreDetail(first.id, ids[1]!) === null && (await scoreDetail(first.id, ids[0]!))?.kind === 'none',
        'Four weighted readings for the scored pursuit; another vehicle cannot read it; no strategy means no readings.');
      await db.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash)
        values($1,'Wrong vehicle strategy',$2,'fixture',now(),'0067-wrong')`,[ids[0],JSON.stringify({ scores, ask: { vehicle: second.name } })]);
      check('0067/0071 wrongly attached vehicle strategies cannot supply a score',
        (await pipelineData(first.id)).rows.find(r => r.id === ids[0])?.score === null, 'The existing vehicle projection rejects a mismatched ask.vehicle.');
      const grouped = groupRows([{...a, orgFirst: true, orgId: 'org', org: 'Invented Org'}, {...b, orgFirst: true, orgId: 'org', org: 'Invented Org'}], 'score', -1);
      check('0067 groups never combine the same organisation across vehicles', grouped.length === 2, 'Grouping uses organisation identity plus vehicle identity.');
      check('0067 every column compares deterministically and missing scores sort last both ways',
        SORT_KEYS.every(k => Number.isFinite(compareRows(a,b,k,1))) && compareRows(a,b,'score',1) > 0 && compareRows(a,b,'score',-1) > 0,
        'Unscored is not a zero; all displayed columns have a comparator.');
      const input: BulkInput = { key: 'table-fixture-status', action: 'status', rows: [a,b].map(r => ({ id:r.id, vehicleId:r.vehicleId, status:r.status })), body:'Invented reason for selection', status:'selected' };
      const before = await count('strategy.pursuit_update');
      let refused = false;
      try { await applyBulk(actor,{...input,rows:[input.rows[0]!,{...input.rows[1]!,status:'passed'}]},null); } catch { refused = true; }
      check('0067 a stale member rolls back the whole bulk status batch',refused && await count('strategy.pursuit_update') === before
        && (await db.one<{status:string}>('select status from strategy.pursuit where pursuit_id=$1',[ids[0]]))?.status === 'new', 'No partial statuses or updates survive.');
      refused = false;
      try { await applyBulk(actor,input,first.id); } catch { refused = true; }
      check('0067 scoped bulk requests refuse a pursuit from another vehicle',refused && await count('strategy.pursuit_update') === before,'Server validates scope independently of browser selection.');
      const saved = await applyBulk(actor,input,null); const retry = await applyBulk(actor,input,null);
      const audits = await db.query<{ detail: { reason?: string } }>("select detail from platform.audit_log where subject_id=any($1::text[]) and action='pursuit.status_set'",[ids]);
      const after = await db.query<{status:string; next_step:string}>('select status,next_step from strategy.pursuit where pursuit_id=any($1::uuid[])',[ids]);
      check('0067 bulk status is audited once, preserves next steps and never moves consent',saved.written===2 && retry.written===0 && retry.alreadySaved===2
        && audits.length===2 && audits.every(a=>a.detail.reason===input.body) && after.every(r=>r.status==='selected' && r.next_step==='Keep this invented next step')
        && await count('strategy.ladder_event') === rungs,'Same idempotency key cannot duplicate status history.');
      const selected = input.rows.map(r=>({...r,status:'selected' as const}));
      for (const action of ['context','research','connections','strategy'] as const) {
        const request = {...input,key:`table-fixture-${action}`,action,rows:selected};
        await applyBulk(actor,request,null); await applyBulk(actor,request,null);
      }
      const notes = await db.query<{kind:string; data:{execution?:string}}>('select kind,data from research.note where entity_id=$1',[entity]);
      check('0067 context and workflow requests persist once and launch no work',notes.length===8 && notes.filter(n=>n.kind==='workflow_request').every(n=>n.data.execution==='not_started'), 'Each request is reviewable in the LP timeline and backed by an audit record.');
      const touch: BulkInput = {...input,key:'table-fixture-touch',action:'touch',rows:selected,channel:'email',direction:'ours',on:'2030-01-01'};
      const meetings = await count('meetings.meeting');
      await applyBulk(actor,touch,null); await applyBulk(actor,touch,null);
      check('0067 bulk touchpoints are idempotent records and never accept a rung',await count('meetings.meeting')===meetings+2 && await count('strategy.ladder_event')===rungs,'Future planned touchpoints; no sends or accepted evidence.');
    } finally {
      await db.query('delete from meetings.meeting where pursuit_id=any($1::uuid[])',[ids]);
      await db.query('delete from research.note where entity_id=$1',[entity]);
      await db.query('delete from strategy.pursuit_update where pursuit_id=any($1::uuid[])',[ids]);
      await db.query('delete from strategy.suggestion where pursuit_id=any($1::uuid[])',[ids]);
      await db.query('delete from strategy.pursuit where pursuit_id=any($1::uuid[])',[ids]);
      await db.query('delete from identity.entity where entity_id=$1',[entity]);
    }
  });
}
