/** Invented queue: normalized-name groups of 2–6, mixed sources, no real inputs. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';
import { businessEmailDomain } from '../lib/enrich/duplicate-rules';

export async function dedupeRulesProperties(check: Check, db: Db) {
  const rollback = new Error('invented queue rollback');
  await db.transaction(async tx => {
    {
      const tag=randomUUID();
      const entity=async (name:string, source:string, type='person') => {
        const id=randomUUID();
        await tx.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)',[id,type,name]);
        await tx.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2::text,$2::uuid,'rule:fixture')",[source,id]);
        return id;
      };
      const note=(id:string,data:unknown)=>tx.query("insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented fixture',$2::jsonb)",[id,JSON.stringify(data)]);
      const root=async(id:string)=>(await tx.one<{id:string}>('select identity.canonical_entity_id($1)::text id',[id]))!.id;
      const sources=['affinity','warehouse','dakota','network_finding','prospect_key','w3_person'];
      const groups:string[][]=[];
      for(let size=2;size<=6;size++) {
        const ids:string[]=[];
        for(let i=0;i<size;i++) {
          const id=await entity(`Invented ${tag} Size ${size}`,sources[i]!); ids.push(id);
          await note(id,size===2?{email:`person${i}@cedar.example.org`}:size===3?(i?{personal_url:'https://invented.example.org/'}:{personal_domain:'invented.example.org'}):
            size===4?{org:i%2?'cedar-partners':'Cédar Partners'}:size===5?{email:'name@gmail.com'}:{facts:[{field:'prior_role',detail:{org:'Former Partners'}}]});
        }
        groups.push(ids);
      }
      const conflictName=`Invented ${tag} Conflict`;
      const conflicts=[await entity(conflictName,'affinity'),await entity(conflictName,'affinity')];
      for(const id of conflicts) await note(id,{org:'Conflict Partners',personal_url:'https://conflict.example.org'});
      const person=await entity(`Invented ${tag} Founder`,'warehouse');
      const org=await entity(`Invented ${tag} Founder Family Office`,'network_finding','org');
      const denied=[await entity(`Invented ${tag} Denied`,'warehouse'),await entity(`Invented ${tag} Denied`,'dakota'),await entity(`Invented ${tag} Denied`,'prospect_key')];
      for(const id of denied) await note(id,{org:'Shared Partners'});
      await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id)
        values('not_same_as','warehouse',$1,'dakota',$2)`,denied.slice(0,2));
      // Identical IDs cannot describe two entities: source_record's PK is the rule at ingestion.
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('warehouse',$1,$2,'rule:fixture') on conflict do nothing`,[person,org]);
      const owner=await tx.one<{id:string}>("select entity_id::text id from identity.source_record where source='warehouse' and source_id=$1",[person]);
      check('dedupe same external ID remains one source-owned identity',owner?.id===person,'A repeated key reuses its existing owner; it cannot introduce a duplicate mapping.');
      const report=await mergeImportDuplicatesInTransaction(tx,'invented-fixture');
      const expected={same_name_email_domain:1,same_name_personal_url:2,same_name_current_affiliation:3,different_external_id:1,own_named_organization:1};
      check('dedupe invented queue per-rule counts',Object.entries(expected).every(([key,n])=>report.rules?.[key]===n),JSON.stringify({sizes:[2,3,4,5,6],rules:report.rules,same_external_id:0}));
      for(const ids of groups.slice(0,3)) check(`dedupe group of ${ids.length} converges`,new Set(await Promise.all(ids.map(root))).size===1,'Mixed established and imported sources; named audit rule.');
      for(const ids of groups.slice(3)) check(`dedupe unsupported group of ${ids.length} stays ambiguous`,new Set(await Promise.all(ids.map(root))).size===ids.length && report.ambiguous.some(g=>g.entityIds.includes(ids[0]!)),'Free mail and former roles do not corroborate names.');
      check('dedupe separation blocks transitive bridges',new Set(await Promise.all(denied.map(root))).size===3,'The whole proposed component is checked before any redirect.');
      const affiliation=await tx.one(`select 1 from identity.affiliation where person_entity=$1 and org_entity=$2 and source='identity:v1:own_named_organization'`,[person,org]);
      check('dedupe own-named office keeps person and organization with affiliation',await root(person)!==await root(org)&&!!affiliation,'Inferred affiliation records no ownership, role or decision authority.');
      const expired=[await entity(`Invented ${tag} Expired`,'warehouse'),await entity(`Invented ${tag} Expired`,'dakota')];
      for (const id of expired) await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,ended_on)
        values($1,$2,'staff','','fixture',current_date,'2020-01-01')`,[id,org]);
      const future=[await entity(`Invented ${tag} Future`,'warehouse'),await entity(`Invented ${tag} Future`,'network_finding')];
      for (const id of future) await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,started_on)
        values($1,$2,'staff','','fixture',current_date,'2999-01-01')`,[id,org]);
      const futureNotes=[await entity(`Invented ${tag} Future Note`,'warehouse'),await entity(`Invented ${tag} Future Note`,'network_finding')];
      for (const id of futureNotes) await note(id,{org:'Future Employer',started_on:'2999-01-01'});
      const history=[await entity(`Invented ${tag} History`,'affinity'),await entity(`Invented ${tag} History`,'warehouse')];
      for (const [i,id] of history.entries()) for (const [date,organization] of [['2020-01-01','Old Employer'],['2026-01-01',`New Employer ${i}`]])
        await tx.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,payload,source_updated_at)
          values($1,'person',$2,$3,$4::jsonb,$5)`,[i?'warehouse':'affinity',id,date,JSON.stringify({org:organization}),date]);
      const retry=await mergeImportDuplicatesInTransaction(tx,'invented-fixture');
      check('dedupe retry adds no rule mutations',!Object.keys(retry.rules??{}).length,'Recorded differences and inferred affiliations are idempotent.');
      check('dedupe ended and future affiliations do not corroborate identity',await root(expired[0]!)!==await root(expired[1]!) && await root(future[0]!)!==await root(future[1]!), 'Only current dated rows count.');
      check('dedupe future structured roles and historical raw snapshots cannot corroborate current roles',
        await root(futureNotes[0]!)!==await root(futureNotes[1]!) && await root(history[0]!)!==await root(history[1]!), 'Use latest source versions and refuse future starts.');
      const sameName=[await entity(`Invented ${tag} Equal Foundation`,'warehouse'),await entity(`Invented ${tag} Equal Foundation`,'network_finding','org')];
      const mixed=await mergeImportDuplicatesInTransaction(tx,'invented-fixture');
      check('dedupe same-name person and foundation remain affiliated distinct identities',mixed.rules?.own_named_organization===1
        && await root(sameName[0]!)!==await root(sameName[1]!), 'Organization suffix prevents the old name-only type correction and merge.');
      const free=['gmail.com','yahoo.co.uk','hotmail.com','outlook.com','icloud.com','proton.me','protonmail.com','mail.gmail.com','gmx.de'];
      check('dedupe excludes common and regional free mail',free.every(d=>businessEmailDomain(d)===null) && businessEmailDomain('name@cedar.example.org')==='cedar.example.org','No local parts are stored in merge evidence.');
    }
    throw rollback;
  }).catch(e=>{if(e!==rollback)throw e;});
}
