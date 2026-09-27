import type { Db, Queryable } from '@/lib/db';
import { config } from '@/config/deployment';
import { externalIdentityIndex, resolveExternalIdentity } from '@/modules/identity/external';
import { needed, neededRecord, type Module, type Replica, type RecordFields } from './replica';
import { accountFit, contactRelevance } from './rules';

export interface DakotaCounts { replicas: number; accounts: number; contacts: number; unchanged: number; merged: number; possible: number; claims: number; sourced: number }
type Stored = RecordFields & { entity_id:string;replica_file:string;last_verified_by:string };
const accountFields = ['type','aum__c','discretionary_assets__c','average_ticket_size__c','check_size_from__c','check_size_to__c',
  'private_equity_average_ticket_size__c','venture_capital__c','private_equity__c','cryptocurrency__c','investment_interest__c',
  'investment_focus_single__c','industry_focus__c','sector__c','asset_classes__c','geography__c','private_equity_fof__c','fof__c','billingcity','billingstate','billingcountry','of_employees__c'];
const contactFields = ['title','contact_type__c','asset_class_coverage__c','mailingcity','mailingstate','mailingcountry'];
const asIso = (x: unknown) => new Date(x as string).toISOString();

async function storeRecord(tx: Queryable, module: Module, record: RecordFields, file: string, actor: string,
  index: Awaited<ReturnType<typeof externalIdentityIndex>>, accountNames: Map<string,string>, counts: DakotaCounts) {
  const previous = await tx.one<Stored>(`select * from dakota.${module} where id=$1`,[record.id]);
  const merged: RecordFields = {...record};
  for(const key of needed(module)) if(!(key in record)) merged[key]=previous?.[key]??null;
  merged.lastmodifieddate=record.lastmodifieddate;
  if(previous && (asIso(previous.lastmodifieddate)>record.lastmodifieddate || needed(module).every(k=>
    k==='lastmodifieddate'?asIso(previous[k])===record[k]:previous[k]===merged[k]))) { counts.unchanged++;return; }
  const name=module==='account' ? accountNames.get(record.id) || merged.website || `Dakota account ${record.id}`
    : [merged.firstname,merged.lastname].filter(Boolean).join(' ') || `Dakota contact ${record.id}`;
  const identity=await resolveExternalIdentity(tx,index,{source:'dakota',sourceId:`${module}:${record.id}`,type:module==='account'?'org':'person',name,
    identifiers:module==='account'?{domain:merged.website??'',linkedin:merged.linkedin__c??(merged.lid__linkedin_company_id__c?`https://linkedin.com/company/${merged.lid__linkedin_company_id__c}`:''),crd:merged.crd__c??'',cik:merged.sec_cik__c??''}:{linkedin:merged.linkedin_url__c??''},
    asOf:record.lastmodifieddate,verifiedBy:actor});
  const columns=[...needed(module),'entity_id','replica_file','last_verified_by'];
  await tx.query(`insert into dakota.${module}(${columns.join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')})
    on conflict(id) do update set ${columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',')}`,
    [...needed(module).map(k=>merged[k]??null),identity.id,file,actor]);
  counts[module==='account'?'accounts':'contacts']++;counts.merged+=identity.merged;counts.possible+=identity.possible;
}

async function employment(tx: Queryable, contacts: Stored[], accounts: Map<string,Stored>) {
  for(const c of contacts) {
    const a=c.accountid?accounts.get(c.accountid):undefined;
    const old=await tx.one<{affiliation_id:string;edge_id:string}>('select affiliation_id::text,edge_id::text from dakota.employment where contact_id=$1',[c.id]);
    const at=asIso(c.lastmodifieddate),date=at.slice(0,10);
    if(!a) {
      if(old) {
        await tx.query('update identity.affiliation set ended_on=$2,is_primary=false where affiliation_id=$1 and ended_on is null',[old.affiliation_id,date]);
        await tx.query('update network.edge set valid_to=$2 where edge_id=$1 and valid_to is null',[old.edge_id,date]);
      }
      continue;
    }
    const evidence=JSON.stringify([{source:'dakota',as_of:at,confidence:config.dakota.claimConfidence,last_verified_by:c.last_verified_by,
      note:'Employment affiliation claimed by Dakota; title is not evidence of decision rights.',replica_file:c.replica_file}]);
    if(old) {
      await tx.query(`update identity.affiliation set org_entity=$2,role=$3,as_of=$4,ended_on=null,note=$5 where affiliation_id=$1
        and (org_entity,role,as_of,ended_on,note) is distinct from ($2::uuid,$3::text,$4::date,null::date,$5::text)`,
        [old.affiliation_id,a.entity_id,c.title??'not recorded',date,evidence]);
      await tx.query(`update network.edge set to_entity=$2,evidence=$3::jsonb,valid_from=$4,valid_to=null where edge_id=$1
        and (to_entity,evidence,valid_from,valid_to) is distinct from ($2::uuid,$3::jsonb,$4::date,null::date)`,[old.edge_id,a.entity_id,evidence,date]);
    } else {
      const aff=await tx.one<{id:string}>(`insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,source,as_of,certainty,note)
        values($1,$2,'staff',$3,false,'dakota',$4,'claimed',$5) returning affiliation_id::text id`,[c.entity_id,a.entity_id,c.title??'not recorded',date,evidence]);
      const edge=await tx.one<{id:string}>(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
        values($1,$2,'employment','C',$3::jsonb,$4) returning edge_id::text id`,[c.entity_id,a.entity_id,evidence,date]);
      await tx.query('insert into dakota.employment(contact_id,affiliation_id,edge_id) values($1,$2,$3)',[c.id,aff!.id,edge!.id]);
    }
  }
}

async function enrich(tx: Queryable,module: Module,records: Stored[],counts: DakotaCounts) {
  const fields=module==='account'?accountFields:contactFields;
  // Source-owned claims follow canonical identity at read time, so undo never moves source facts.
  const pipeline=new Set((await tx.query<{id:string}>(`select distinct r.entity_id::text id from identity.entity_resolution r
    join strategy.pursuit p on identity.canonical_entity_id(p.entity_id)=r.canonical_id`)).map(x=>x.id));
  if(module==='account')for(const r of await tx.query<{id:string}>(`select a.entity_id::text id from dakota.contact c
    join dakota.account a on a.id=c.accountid join strategy.pursuit p
    on identity.canonical_entity_id(p.entity_id)=identity.canonical_entity_id(c.entity_id)`))pipeline.add(r.id);
  for(const r of records) {
    if(!pipeline.has(r.entity_id))continue;
    for(const field of fields) {
      const value=r[field];
      if(value==null || value==='') {
        await tx.query('delete from dakota.claim where module=$1 and record_id=$2 and field=$3',[module,r.id,field]); continue;
      }
      const changed=await tx.one(`insert into dakota.claim(module,record_id,entity_id,field,value,as_of,last_verified_by,replica_file)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(module,record_id,field) do update
        set value=excluded.value,as_of=excluded.as_of,last_verified_by=excluded.last_verified_by,replica_file=excluded.replica_file
        where (claim.value,claim.as_of) is distinct from (excluded.value,excluded.as_of) returning field`,
        [module,r.id,r.entity_id,field,value,asIso(r.lastmodifieddate),r.last_verified_by,r.replica_file]);
      if(changed)counts.claims++;
    }
  }
}

async function sourceAccounts(tx: Queryable,accounts: Stored[],actor: string,counts: DakotaCounts) {
  const vehicles=await tx.query<{id:string;slug:string;name:string}>(`select id::text,slug,name from platform.vehicle where phase<>'historical' and kind::text<>'grant_rail'`);
  const roots=new Map((await tx.query<{id:string;root:string}>('select entity_id::text id,canonical_id::text root from identity.entity_resolution')).map(r=>[r.id,r.root]));
  const canonical=(id:string)=>roots.get(id)??id;
  // Do not circumvent restrictions on the institution, one of its contacts, a corrected alias,
  // or a namesake pending resolution. Restriction uncertainty is a reason to defer sourcing.
  const blocked=new Set((await tx.query<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from coordination.restriction
    where expires_at is null or expires_at>current_date`)).map(r=>r.id));
  const pursuits=await tx.query<{id:string;vehicle:string;source:string}>(`select identity.canonical_entity_id(entity_id)::text id,vehicle_id::text vehicle,source from strategy.pursuit`);
  const pursued=new Set(pursuits.map(p=>p.id));
  const existing=new Set(pursuits.map(p=>`${p.id}:${p.vehicle}`));
  const possible=await tx.query<{a:string;b:string}>(`select identity.canonical_entity_id(left_entity)::text a,identity.canonical_entity_id(right_entity)::text b from identity.possible_match where active`);
  const affiliations=await tx.query<{person:string;org:string}>(`select identity.canonical_entity_id(person_entity)::text person,identity.canonical_entity_id(org_entity)::text org from identity.affiliation where ended_on is null`);
  for(const v of vehicles) {
    // A cap across repeat clicks cannot drain the next 150 on every click.
    const remaining=Math.max(0,config.dakota.perVehicleCap-pursuits.filter(p=>p.vehicle===v.id&&p.source==='dakota').length);
    const candidates=accounts.flatMap(a=>{const fit=accountFit(a,v);return fit?[{a,fit,id:canonical(a.entity_id)}]:[];})
      .filter(c=>!blocked.has(c.id)&&!pursued.has(c.id)&&!existing.has(`${c.id}:${v.id}`)
        && !affiliations.some(a=>a.org===c.id&&(blocked.has(a.person)||pursued.has(a.person)))
        && !possible.some(p=>p.a===c.id&&(blocked.has(p.b)||pursued.has(p.b))||p.b===c.id&&(blocked.has(p.a)||pursued.has(p.a))))
      .sort((a,b)=>b.fit.score-a.fit.score||a.a.id.localeCompare(b.a.id));
    let added=0;
    for(const c of candidates) {
      if(added>=remaining)break;
      if(existing.has(`${c.id}:${v.id}`))continue;
      const reason=`${c.fit.reason}; fit score ${c.fit.score} (rule ranking, not probability); source dakota; as_of ${asIso(c.a.lastmodifieddate)}; confidence ${config.dakota.claimConfidence}; last_verified_by ${c.a.last_verified_by}`;
      const row=await tx.one(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_reason,status_set_at,status_set_by,source)
        values($1,$2,$3,'new','rule',$4,now(),$3,'dakota') on conflict(entity_id,vehicle_id) do nothing returning pursuit_id`,[c.id,v.id,actor,reason]);
      if(row) {added++;counts.sourced++;existing.add(`${c.id}:${v.id}`);}
    }
  }
}

/** Supplied handle only. One atomic import; output contains counts and no record identifiers.
 * Call from the live server button. Tests pass invented in-memory replicas. No file writes. */
export async function translateDakota(db: Db,actor: string,replicas: Replica[]): Promise<DakotaCounts> {
  return db.transaction(async tx=>{
    await tx.exec('lock table dakota.replica,identity.entity,identity.source_record,strategy.pursuit in share row exclusive mode');
    const counts:DakotaCounts={replicas:0,accounts:0,contacts:0,unchanged:0,merged:0,possible:0,claims:0,sourced:0};
    const pending: Replica[]=[];
    for(const batch of replicas) {
      const prior=await tx.one<{hash:string}>('select hash from dakota.replica where module=$1 and file=$2',[batch.module,batch.file]);
      if(prior) {if(prior.hash!==batch.hash)throw new Error('A completed Dakota replica changed; import refused.');}
      else pending.push(batch);
    }
    // Even a zero-row UPDATE fires statement-level cache invalidation triggers. A repeat
    // must return before any mutation, rather than relying on SQL WHERE clauses alone.
    if(!pending.length)return counts;
    const index=await externalIdentityIndex(tx);
    const names=new Map<string,string>();
    for(const c of await tx.query<{accountid:string;account_name__c:string}>(`select accountid,account_name__c from dakota.contact where accountid is not null and account_name__c is not null order by lastmodifieddate,id`))names.set(c.accountid,c.account_name__c);
    // Account names are not in the account needed list. Use only the contact's allowed account_name__c.
    for(const batch of replicas)if(batch.module==='contact')for(const c of batch.records)if(c.accountid&&c.account_name__c)names.set(c.accountid,c.account_name__c);
    for(const batch of replicas) {
      const prior=await tx.one<{hash:string}>('select hash from dakota.replica where module=$1 and file=$2',[batch.module,batch.file]);
      if(prior) {if(prior.hash!==batch.hash)throw new Error('A completed Dakota replica changed; import refused.');continue;}
      for(const record of batch.records)await storeRecord(tx,batch.module,neededRecord(batch.module,record),batch.file,actor,index,names,counts);
      await tx.query('insert into dakota.replica(module,file,hash) values($1,$2,$3)',[batch.module,batch.file,batch.hash]);counts.replicas++;
    }
    if(!counts.accounts&&!counts.contacts)return counts;
    const accounts=await tx.query<Stored>('select * from dakota.account order by id');
    const contacts=await tx.query<Stored>('select * from dakota.contact order by id');
    // A later contact delta can supply the account's allowed display name.
    for(const a of accounts) {
      const name=names.get(a.id);if(name)await tx.query('update identity.entity set display_name=$2 where entity_id=$1 and display_name is distinct from $2',[a.entity_id,name]);
    }
    for(const a of accounts) {
      const likely=contacts.filter(c=>c.accountid===a.id&&contactRelevance(c.title??null)>0)
        .sort((x,y)=>contactRelevance(y.title??null)-contactRelevance(x.title??null)||x.id.localeCompare(y.id))[0]?.id??null;
      await tx.query('update dakota.account set likely_contact_id=$2 where id=$1 and likely_contact_id is distinct from $2',[a.id,likely]);
    }
    await employment(tx,contacts,new Map(accounts.map(a=>[a.id,a])));
    await sourceAccounts(tx,accounts,actor,counts);
    await enrich(tx,'account',accounts,counts);await enrich(tx,'contact',contacts,counts);
    return counts;
  });
}
