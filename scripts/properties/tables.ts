/** Invented fixtures: table scope, score reuse and consequential bulk commands. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { applyBulk, type BulkInput } from '../../lib/pipeline-bulk';
import { pipelineData, scoreDetail } from '../../lib/pipeline-data';
import { provisionalScore } from '../../lib/strategy-score';
import { compareRows, groupRows, orgSummary, SORT_KEYS } from '../../components/strategy/pipeline-model';
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
      const grouped = groupRows([{...a, orgFirst: true, orgId: 'org', org: 'Invented Org'}, {...b, orgFirst: true, orgId: 'org', org: 'Invented Org'}], 'score', -1);
      check('0067 groups never combine the same organisation across vehicles', grouped.length === 2, 'Grouping uses organisation identity plus vehicle identity.');
      const orgRow = { ...a, id: 'org-pursuit', entityId: 'org', isOrg: true, orgFirst: true, orgId: 'org', org: 'Invented Org', name: 'Invented Org', score: 10 };
      const person = { ...a, id: 'person-pursuit', orgFirst: false, orgId: 'org', org: 'Invented Org', score: 90 };
      const withOrg = groupRows([person, orgRow], 'score', -1);
      const members = [{ ...person, orgFirst: true, score: 40, route: 2 }, { ...person, id: 'p2', orgFirst: true, score: 70, route: 3 }, { ...person, id: 'p3', orgFirst: true, score: null, route: null }];
      const sum = orgSummary(members);
      check('0092 an organisation pursued in its own right leads its people, and an organisation row reads its people without inventing',
        withOrg.length === 1 && withOrg[0]!.people[0]!.id === 'org-pursuit' && sum.score === 70 && sum.scoreFrom === members[1]!.name
          && sum.route === 5 && sum.count === 3,
        'The org pursuit comes first whatever its score; a summary row takes its best person’s score, names them, and adds up routes.');
      const peer = { ...person, id: 'peer-pursuit', entityId: 'peer', name: 'Invented Rowan', status: 'sourcing' as const, score: 30 };
      const withoutOwn = groupRows([person, peer], 'score', -1);
      check('0105 two distinct people at one organisation share one LP heading without an org pursuit',
        withoutOwn.length === 1 && withoutOwn[0]!.org === 'Invented Org' && withoutOwn[0]!.people.length === 2,
        'No investor-type or ask-unit claim is needed; current affiliation supplies canonical organisation identity.');
      const withPeers = groupRows([peer, orgRow, person], 'score', -1);
      check('0105 an organisation appears once and retains each person under its own pursuit',
        withPeers.length === 1 && withPeers[0]!.people[0] === orgRow
          && withPeers[0]!.people.slice(1).every(r => !r.isOrg)
          && withPeers[0]!.people.find(r => r.id === peer.id)?.status === 'sourcing',
        'An organisation row leads even with a lower score; child status and action IDs stay their own.');
      check('0105 grouping never joins same-name organisations, vehicles or unaffiliated people',
        groupRows([person, { ...peer, orgId: 'another-org' }], 'score', -1).length === 2
          && groupRows([person, { ...peer, vehicleId: 'another-vehicle' }], 'score', -1).length === 2
          && groupRows([{ ...person, orgId: null }, { ...peer, orgId: null }], 'score', -1).length === 2,
        'Only canonical org identity within a single vehicle determines the group.');
      check('0105 a filtered group keeps organisation context without inventing or hiding a pursuit',
        groupRows([peer], 'score', -1, [person, peer, orgRow])[0]!.org === 'Invented Org'
          && groupRows([peer], 'score', -1, [person, peer, orgRow])[0]!.people[0] === peer,
        'Filtering the organisation out leaves a heading for the surviving real person.');
      const groupingInput = [person, peer, orgRow];
      const snapshot = JSON.stringify(groupingInput);
      const moneyGroup = orgSummary([
        { ...person, money: { state: 'Soft', amount: 1_000_000, wired: 0, hard: false, signedPer: null } },
        { ...peer, money: { state: 'Hard', amount: 2_000_000, wired: 0, hard: true, signedPer: null } },
      ]);
      check('0105 organisation summaries never blend soft and hard child amounts', moneyGroup.money === null,
        'Mixed close tracks remain on their individual rows instead of becoming one misleading group amount.');
      check('0105 grouping is repeatable and leaves all source rows unchanged',
        JSON.stringify(groupRows(groupingInput, 'score', -1)) === JSON.stringify(groupRows(groupingInput, 'score', -1))
          && JSON.stringify(groupingInput) === snapshot,
        'The projection writes no identity, status, evidence or money and does not mutate caller arrays.');
      const fitRows: FitRow[] = [person, peer, orgRow].map(r => ({
        key: r.id, entityId: r.entityId, name: r.name, vehicleId: r.vehicleId, vehicleName: r.vehicle,
        vehicleSlug: r.vehicleSlug, pursuitId: r.id, status: r.status, owner: r.owner, score: r.score,
        rank: null, group: r.id === peer.id ? 'gate' : 'strong', kind: 'provisional', why: null,
        capacity: null, affinity: null, propensity: null, decide: null, gates: null, date: null,
        known: null, dims: null, isOrg: r.isOrg, org: r.org, orgId: r.orgId, orgFirst: r.orgFirst,
        detail: { bases: [], gateList: [], angle: null, next: null, nextStep: null, toFind: [], by: null, confidence: null },
      }));
      const fitGroups = groupFitRows(fitRows, (x, y) => (y.score ?? -1) - (x.score ?? -1));
      check('0105 Fit shares organisation grouping without replacing child scores or failing gates',
        fitGroups.length === 1 && fitGroups[0]!.people[0]!.isOrg === true
          && fitGroups[0]!.people.find(r => r.key === peer.id)?.group === 'gate'
          && fitGroups[0]!.people.find(r => r.key === person.id)?.score === person.score,
        'Paging whole groups keeps the organisation with its individual readings; no score is inherited.');
      check('0105 Fit group work queues preserve failing gates and the selected category',
        fitGroupCategory(fitGroups[0]!) === 'gate' && fitGroupCategory(fitGroups[0]!, 'gate') === 'gate'
          && fitGroupCategory(fitGroups[0]!, 'strong') === 'strong'
          && fitGroups[0]!.people.find(r => r.key === peer.id)?.group === 'gate',
        'A failing person puts an unfiltered organisation in the gate queue; filtering uses that category without rewriting any reading.');
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
