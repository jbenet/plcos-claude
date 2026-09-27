/** Invented fixtures: table scope, score reuse and consequential bulk commands. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { applyBulk, type BulkInput } from '../../lib/pipeline-bulk';
import { pipelineData, scoreDetail } from '../../lib/pipeline-data';
import { provisionalScore } from '../../lib/strategy-score';
import { compareRows, SORT_KEYS } from '../../components/strategy/pipeline-model';
import { groupFitRows, fitGroupCategory, type FitRow } from '../../app/[vehicle]/fit/fit-model';
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
      // Grouping moved to the LP-unit model (issues 0111, 0112; docs/23): scripts/properties/lp-units.ts.
      const orgRow = { ...a, id: 'org-pursuit', entityId: 'org', isOrg: true, orgFirst: true, orgId: 'org', org: 'Invented Org', name: 'Invented Org', score: 10 };
      const person = { ...a, id: 'person-pursuit', orgFirst: false, orgId: 'org', org: 'Invented Org', score: 90 };
      const peer = { ...person, id: 'peer-pursuit', entityId: 'peer', name: 'Invented Rowan', status: 'sourcing' as const, score: 30 };
      const fitRows: FitRow[] = [person, peer, orgRow].map(r => ({
        key: r.id, entityId: r.entityId, name: r.name, vehicleId: r.vehicleId, vehicleName: r.vehicle,
        vehicleSlug: r.vehicleSlug, pursuitId: r.id, status: r.status, owner: r.owner, score: r.score,
        rank: null, group: r.id === peer.id ? 'gate' : 'strong', kind: 'provisional', why: null,
        capacity: null, affinity: null, propensity: null, decide: null, gates: null, date: null,
        known: null, dims: null, isOrg: r.isOrg, org: r.org, orgId: r.orgId, orgFirst: r.orgFirst,
        detail: { bases: [], gateList: [], angle: null, next: null, nextStep: null, toFind: [], by: null, confidence: null },
      }));
      const fitGroups = groupFitRows(fitRows, (x, y) => (y.score ?? -1) - (x.score ?? -1));
      check('0111 the fit list has one row per LP unit: organisations, then individuals, each keeping its own score and gates',
        fitGroups.length === 3 && fitGroups[0]!.section === 'organisation' && fitGroups[0]!.people[0]!.key === orgRow.id
          && fitGroups.slice(1).every(g => g.section === 'individual' && g.people.length === 1)
          && fitGroups.find(g => g.id === peer.id)?.people[0]!.group === 'gate'
          && fitGroups.find(g => g.id === person.id)?.people[0]!.score === person.score,
        'No person is nested under an organisation; nothing is inherited between rows.');
      check('0111 fit work queues read each LP unit’s own category',
        fitGroupCategory(fitGroups.find(g => g.id === peer.id)!) === 'gate' && fitGroupCategory(fitGroups[0]!) === 'strong'
          && fitGroupCategory(fitGroups[0]!, 'gate') === 'strong',
        'A person’s failing gate no longer moves their firm’s row into the gate queue.');
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
