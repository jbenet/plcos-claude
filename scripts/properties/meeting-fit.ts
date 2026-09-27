/** Invented overlapping LP fixtures: no real records. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { vehicleReadings } from '../../lib/vehicle-readings';
import { listMeetings, prepBrief } from '../../modules/meetings';
import { orderDatedRows, type DatedRow } from '../../lib/lanes';
import type { Check } from './harness';

export async function meetingFitProperties(check: Check, db: Db) {
  const row = (id: string, from: string, lp: string, team: string[]): DatedRow => ({ id,from,lp,team,lane:'meetings',label:id,detail:null,to:null,vehicle:null,standing:'done',href:null });
  const calendar=[row('older','2026-01-01','Willow',['Zoe']),row('newer','2026-06-01','Cedar',['Amir'])];
  check('0072 calendar defaults newest first and supports date, LP and team direction changes',
    orderDatedRows(calendar,'date',false)[0]?.id==='newer' && orderDatedRows(calendar,'date',true)[0]?.id==='older'
    && orderDatedRows(calendar,'lp',true)[0]?.id==='newer' && orderDatedRows(calendar,'team',false)[0]?.id==='older',
    'Invented dated records change presentation order without mutating their source order.');
  await withDb(db,async()=>{
    const entity=randomUUID();
    const owner=(await db.one<{id:string}>('select id from platform.app_user where active limit 1'))!.id;
    const vehicles=await db.query<{id:string;name:string;slug:string}>("select id,name,slug from platform.vehicle where kind='fund' order by sort_order limit 2");
    const [first,second]=vehicles;
    if(!first || !second) throw Error('Need two fixture vehicles');
    await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person','Invented Meeting Willow')",[entity]);
    const pursuits:string[]=[];
    for(const v of vehicles) pursuits.push((await db.one<{id:string}>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'selected') returning pursuit_id id`,[entity,v.id,owner]))!.id);
    const proposal = (vehicle:string,level:string) => JSON.stringify({ask:{vehicle},fit:{[vehicle]:{verdict:'possible',why:'Invented fit'}},scores:{affinity:{level,basis:'Invented'},propensity:{level,basis:'Invented'}}});
    try {
      await db.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash,created_at) values
        ($1,'Valid first',$3,'fixture',now(),'0073-first',now()-interval '1 hour'),
        ($1,'Wrong vehicle newer',$4,'fixture',now(),'0073-wrong',now()),
        ($2,'Valid second',$4,'fixture',now(),'0073-second',now())`,[pursuits[0],pursuits[1],proposal(first.name,'low'),proposal(second.name,'high')]);
      const a=(await vehicleReadings(first.id,entity))[0]!,b=(await vehicleReadings(second.id,entity))[0]!;
      check('0073 fit reads strategies without legacy assessments and never borrows a higher score across vehicles',
        a.score===25 && b.score===100 && a.fit?.verdict==='possible','Latest applicable proposal wins; a newer proposal naming another vehicle is excluded.');
      await db.query("update strategy.suggestion set status='dismissed' where pursuit_id=$1 and file_hash='0073-first'",[pursuits[0]]);
      const missing=(await vehicleReadings(first.id,entity))[0]!;
      check('0073 missing or dismissed readings preserve the LP with unknown score',missing.suggestion_id===null && missing.score===null,'A missing reading is not a zero score or absent LP.');
      for(const [i,v] of vehicles.entries()) await db.query(`insert into meetings.meeting(entity_id,vehicle_id,pursuit_id,channel,scheduled_for,owner_id,created_by,source)
        values($1,$2,$3,'meeting',now()+($5::int * interval '1 day'),$4,$4,'us')`,[entity,v.id,pursuits[i],owner,i+1]);
      const scoped=await listMeetings(second.id);
      check('0074 overlapping LP meetings stay on the selected vehicle',scoped.filter(m=>m.entityId===entity).length===1 && scoped.filter(m=>m.entityId===entity).every(m=>m.vehicleName===second.name),'A scheduled meeting on another raise cannot become the selected prep meeting.');
      const brief=await prepBrief(entity,second.id);
      check('0074 prep meeting uses the requested vehicle, not the earliest meeting for the LP',brief?.meeting?.vehicleName===second.name,'Two upcoming meetings for one LP, earliest on the other vehicle.');
      await db.query(`insert into meetings.meeting(entity_id,channel,held_on,owner_id,created_by,source,about,about_vehicles,about_by)
        values($1,'meeting','2001-01-01',$2,$2,'affinity','raise',array[$3],'person')`,[entity,owner,second.slug]);
      check('0074 human vehicle tags remain visible outside the raise window',(await listMeetings(second.id)).some(m=>m.entityId===entity && m.heldOn?.getUTCFullYear()===2001),'Same human-tag override used by LP touchpoints.');
    } finally {
      await db.query('delete from meetings.meeting where entity_id=$1',[entity]);
      await db.query('delete from strategy.suggestion where pursuit_id=any($1::uuid[])',[pursuits]);
      await db.query('delete from strategy.pursuit where entity_id=$1',[entity]);
      await db.query('delete from identity.entity where entity_id=$1',[entity]);
    }
  });
}
