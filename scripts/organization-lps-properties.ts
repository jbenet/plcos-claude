/** Invented fixtures only. */
import { randomUUID } from 'node:crypto';
import { addOrganizationLps, findingOrganizations, leadership } from '../lib/enrich/organization-lps';
import type { Finding } from '../lib/enrich/schema';
import type { Check, Db } from './properties/harness';
import { withDb } from '../lib/db';
import { edgeGrade } from '../modules/network/warmth';
import { relatedLpHeadings } from '../lib/lp-heading';

export async function organizationLpsProperties(check: Check, db: Db) {
  const actor = (await db.one<{id:string}>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{id:string}>("select id::text from platform.vehicle where phase='active' and kind='fund' limit 1"))!.id;
  const person = randomUUID(), org = randomUUID(), alias = randomUUID();
  const finding: Finding = {key:person,name:'Invented Person',researched:{at:'2026-09-20',by:'fixture',workflow:'W1',version:'1'},
    identity:{match:'confirmed',basis:'Invented fixture',canonical:{org:'Invented Science Foundation'}},facts:[
      {field:'role',value:'Founder of Invented Science Foundation.',detail:{company:'Invented Science Foundation'},source:{url:'https://example.org/team',kind:'primary'},confidence:'high'},
      {field:'investment',value:'Invented Science Foundation runs an investing arm and makes fund investments.',detail:{company:'Invented Science Foundation'},scope:'firm',source:{url:'https://example.org/investing',kind:'primary'},confidence:'high'},
    ]};
  const candidates = findingOrganizations(finding);
  check('organization LP rule requires sourced leadership plus investing',candidates.length===1&&candidates[0]!.tier==='B','Separate role and investment facts are retained.');
  const division = findingOrganizations({...finding,identity:{...finding.identity,canonical:{org:'Invented Science Institute'}},facts:[
    {...finding.facts[0]!,value:'Founder of Invented Science Institute.',detail:{company:'Invented Science Institute'}},
    {...finding.facts[1]!,value:'Invented Science Institute says its Foundation has a Head of Strategic Investments.',detail:{company:'Invented Science Institute'}},
  ]});
  check('a sourced investing foundation division becomes the LP',division.length===1&&division[0]!.organization==='Invented Science Foundation'
    && division[0]!.evidence.length===2,'The parent founder role and the division investment fact travel together.');
  check('grant-only foundations and ordinary employees are excluded',findingOrganizations({...finding,facts:[finding.facts[0]!] }).length===0 &&
    findingOrganizations({...finding,facts:[{...finding.facts[0]!,value:'Works at Invented Science Foundation.'},finding.facts[1]!] }).length===0,'A foundation name and staff role are insufficient.');
  check('uncertain identities and former roles are excluded',findingOrganizations({...finding,identity:{match:'ambiguous',basis:'unknown'}}).length===0 &&
    leadership('Former founder of Invented Science Foundation','Invented Science Foundation')===null,'Never invent a current tie.');
  check('investment recipients are not mistaken for investing organisations',findingOrganizations({...finding,facts:[finding.facts[0]!,
    {...finding.facts[1]!,value:'Invented Science Foundation received an investment from Another Fund.'}]}).length===0,
    'Firm scope does not turn incoming financing into an investing mandate.');
  check('another person’s leadership is not attributed to the LP',leadership('Assistant to the founder of Invented Science Foundation.','Invented Science Foundation')===null
    && leadership('Invented Science Foundation has a principal investor called Someone Else.','Invented Science Foundation')===null,
    'Proximity to a title is not a leadership role.');
  const before=(await db.one<{n:number}>('select count(*)::int n from strategy.ladder_event'))!.n;
  try {
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,'person','Invented Person'),($2,'org','Invented Science Foundation'),($3,'person','Invented Alias')`,[person,org,alias]);
    // This relationship/replay fixture pins the existing organization by source identity.
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('investing-organization:v1','invented science foundation',$1,'invented fixture')`,[org]);
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2',[person,alias]);
    await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source) values($1,$2,$3,'discussing','us')`,[person,vehicle,actor]);
    const first=await addOrganizationLps(db,[{...finding,key:alias}],actor);
    const again=await addOrganizationLps(db,[finding],actor);
    check('organization LP import follows canonical persons and is idempotent',first.added===1&&first.affiliations===1&&first.ties===1&&again.added===0&&again.affiliations===0&&again.ties===0,'One organisation pursuit and one evidenced tie.');
    const edge=await db.one<{kind:'employment';evidence:Array<{note:string;source?:string;tie?:{kind:'worked_together'}}>}>('select kind,evidence from network.edge where from_entity=$1 and to_entity=$2',[person,org]);
    check('leadership edge retains a warm effective routing tier',!!edge&&edgeGrade(edge)==='B','Person-to-organisation working role is structured evidence, without inventing contact dates.');
    const rows=await db.query<{entity_id:string;status:string;status_source:string;status_reason:string}>(`select entity_id::text,status::text,status_source,status_reason from strategy.pursuit where entity_id=any($1::uuid[])`,[[person,org]]);
    check('person and organisation remain separate with independent status',rows.find(r=>r.entity_id===person)?.status==='discussing'&&rows.find(r=>r.entity_id===org)?.status==='new'&&rows.find(r=>r.entity_id===org)?.status_source==='rule'&&rows.find(r=>r.entity_id===org)?.status_reason.includes('https://example.org/team')===true,'New rule pursuit carries evidence and changes no existing status.');
    // Reverse the canonical root after import: the source-owned affiliation/tie must survive replay.
    await db.query('update identity.entity set merged_into=null where entity_id=$1',[alias]);
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2',[alias,person]);
    const afterMerge=await addOrganizationLps(db,[finding],actor);
    check('organisation rule replay survives a later identity merge',afterMerge.added===0&&afterMerge.affiliations===0&&afterMerge.ties===0,
      'Derived relationship keys retain their original identity after redirects.');
    await db.query('update identity.entity set merged_into=null where entity_id=$1',[person]);
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2',[person,alias]);
    const links=await withDb(db,async()=>Promise.all([relatedLpHeadings(person,vehicle),relatedLpHeadings(org,vehicle)]));
    check('both LP pages resolve their counterpart in the same vehicle',links.every(xs=>xs.length===1),'The existing heading slot links each independent pursuit.');
    await db.query(`update strategy.pursuit set status='passed',status_source='us',closed_at=now(),status_reason='Human decision' where entity_id=$1`,[org]);
    await addOrganizationLps(db,[finding],actor);
    const kept=await db.one<{status:string;status_reason:string}>('select status::text,status_reason from strategy.pursuit where entity_id=$1',[org]);
    check('organisation rule never reopens or changes a human pursuit',kept?.status==='passed'&&kept.status_reason==='Human decision','Existing and closed pursuits are insert-only.');
    check('organisation rule never writes consent or capital',before===(await db.one<{n:number}>('select count(*)::int n from strategy.ladder_event'))!.n,'No rung copied from the person.');
  } finally {
    await db.query('delete from research.note where entity_id=$1',[org]);
    await db.query('delete from network.edge where from_entity=$1 or to_entity=$1',[org]);
    await db.query('delete from identity.affiliation where org_entity=$1',[org]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])',[[person,org]]);
    await db.query('delete from identity.source_record where entity_id=$1',[org]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [[alias,person,org]]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])',[[alias,person,org]]);
  }
}
