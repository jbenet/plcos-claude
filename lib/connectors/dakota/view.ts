import type { Queryable } from '@/lib/db';
import { contactRelevance, ticketEstimate } from './rules';
import type { RecordFields } from './replica';
export interface DakotaClaim {subject:string;field:string;value:string;source:string;as_of:Date;confidence:string;last_verified_by:string}
/** Database-only projections; deliberately not research.profile/context, which get exported. */
export async function dakotaFor(tx: Queryable,entityId: string) {
  const claims=await tx.query<DakotaClaim>(`select 'LP' subject,field,value,source,as_of,confidence,last_verified_by::text from dakota.claim
    where identity.canonical_entity_id(entity_id)=identity.canonical_entity_id($1)
    union select 'Employer account' subject,k.field,k.value,k.source,k.as_of,k.confidence,k.last_verified_by::text
    from dakota.contact c join dakota.account a on a.id=c.accountid join dakota.claim k on k.module='account' and k.record_id=a.id
    where identity.canonical_entity_id(c.entity_id)=identity.canonical_entity_id($1)
    order by subject,field,as_of desc`,[entityId]);
  const contacts=await tx.query<{name:string;title:string|null;likely:boolean;as_of:Date;last_verified_by:string}>(`select e.display_name name,c.title,c.id=a.likely_contact_id likely,c.lastmodifieddate as_of,c.last_verified_by::text
    from dakota.contact c join dakota.account a on a.id=c.accountid join identity.entity e on e.entity_id=c.entity_id
    where identity.canonical_entity_id(a.entity_id)=identity.canonical_entity_id($1) order by c.id`,[entityId]);
  contacts.sort((a,b)=>Number(b.likely)-Number(a.likely)||contactRelevance(b.title)-contactRelevance(a.title)||a.name.localeCompare(b.name));
  const capacity=(await dakotaCapacities(tx,[entityId])).get(entityId)??null;
  return {claims,contacts,capacity};
}
export async function dakotaCapacities(tx: Queryable,entityIds: string[]) {
  const rows=await tx.query<RecordFields & {target:string;last_verified_by:string}>(`select a.*,r.canonical_id::text target from dakota.account a
    join identity.entity_resolution r on r.entity_id=a.entity_id where r.canonical_id=any($1::uuid[])
    union all select a.*,r.canonical_id::text target from dakota.contact c join dakota.account a on a.id=c.accountid
    join identity.entity_resolution r on r.entity_id=c.entity_id where r.canonical_id=any($1::uuid[])
    order by lastmodifieddate desc,id`,[entityIds]);
  const result=new Map<string,{amount:number;basis:string;asOf:string;verifiedBy:string}>();
  for(const r of rows) {
    const estimate=ticketEstimate(r);if(estimate&&!result.has(r.target))result.set(r.target,{...estimate,basis:`${estimate.basis} The basis belongs to the matched account; for a contact it describes their employer, not personal wealth.`,asOf:new Date(r.lastmodifieddate).toISOString(),verifiedBy:r.last_verified_by});
  }
  return result;
}
export const dakotaLabel = (field: string) => ({type:'Allocator type',aum__c:'Assets under management',discretionary_assets__c:'Discretionary assets',
  average_ticket_size__c:'Average ticket size',check_size_from__c:'Check size from',check_size_to__c:'Check size to',private_equity_average_ticket_size__c:'PE/VC average ticket',
  venture_capital__c:'Venture capital',private_equity__c:'Private equity',cryptocurrency__c:'Cryptocurrency',investment_interest__c:'Interests',
  investment_focus_single__c:'Investment focus',industry_focus__c:'Industry focus',sector__c:'Sectors',asset_classes__c:'Asset classes',geography__c:'Geography',private_equity_fof__c:'Private equity fund of funds',fof__c:'Fund of funds',billingcity:'City',billingstate:'State',billingcountry:'Country',of_employees__c:'Headcount',
  title:'Title',contact_type__c:'Contact type',asset_class_coverage__c:'Asset class coverage',mailingcity:'City',mailingstate:'State',mailingcountry:'Country'} as Record<string,string>)[field]??field;
