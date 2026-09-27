import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from '@/config/deployment';
import { getDb, type Db, type Queryable } from '@/lib/db';
import { normalizeIdentityName, organizationNames } from '@/modules/identity/resolution';

export interface PortfolioSource { file: string; page: number; as_of: string; confidence: number; last_verified_by: string }
export interface PortfolioPerson { name: string; source: PortfolioSource }
export interface PortfolioInput {
  version: 1; as_of: string;
  coverage: Array<{ vehicle: string; status: string; detail: string; source?: unknown }>;
  rows: Array<{ id: string; vehicle: string; company: { name: string; domain?: string }; founders: PortfolioPerson[];
    source: PortfolioSource; fund_labels?: string[]; note?: string }>;
}
export interface PortfolioFounder extends PortfolioPerson { entityId: string; possibleMatches: string[]; resolution: string }
export interface PortfolioRow {
  id: string; vehicleId: string; companyId: string; company: string; founders: PortfolioFounder[];
  source: PortfolioSource; fundLabels: string[]; note: string | null;
}
export const portfolioFile = () => `data/${config.data.profile}/portfolio/portfolio.json`;
export async function readPortfolioFile(): Promise<PortfolioInput | null> {
  try { return JSON.parse(await readFile(portfolioFile(), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Portfolio file is not valid JSON.'); }
}
const sourceValid = (s: PortfolioSource) => s && typeof s.file === 'string' && !!s.file.trim()
  && Number.isInteger(s.page) && s.page > 0 && /^\d{4}-\d{2}-\d{2}/.test(s.as_of)
  && Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1 && typeof s.last_verified_by === 'string' && !!s.last_verified_by.trim();
export function portfolioProblems(input: PortfolioInput): string[] {
  if (!input || input.version !== 1 || !Array.isArray(input.rows) || !Array.isArray(input.coverage)) return ['Expected version 1, rows and coverage.'];
  const errors: string[] = [], ids = new Set<string>();
  for (const [i, r] of input.rows.entries()) {
    if (!r.id || ids.has(r.id) || !['neurotech','rails'].includes(r.vehicle) || !r.company?.name?.trim()
      || !sourceValid(r.source) || !Array.isArray(r.founders) || r.founders.some(f => !f.name?.trim() || !sourceValid(f.source))) errors.push(`Row ${i + 1}: missing provenance, invalid identity, vehicle or duplicate key.`);
    ids.add(r.id);
  }
  return errors;
}
export interface PortfolioResult { rows: number; founders: number; possible: number; linked: number }
/** Server-owned import. Name-only matches create possible links; corroborated name + organization may resolve.
 * Stable source keys preserve idempotence. No pipeline state, consent rung or outreach is written.
 */
export async function importPortfolio(db: Db, input: PortfolioInput): Promise<PortfolioResult> {
  const errors = portfolioProblems(input); if (errors.length) throw new Error(errors.join(' '));
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.transaction(async tx => {
    await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
    const vehicles = new Map((await tx.query<{ id:string; slug:string }>('select id::text,slug from platform.vehicle')).map(v => [v.slug,v.id]));
    if (input.rows.some(r => !vehicles.has(r.vehicle))) throw new Error('Portfolio vehicle is unavailable.');
    const entities = await tx.query<{ id:string; name:string; type:string }>(`select entity_id::text id,display_name name,entity_type::text type from identity.entity where merged_into is null and retired_at is null`);
    const affiliations = await tx.query<{ id:string; org:string }>(`select identity.canonical_entity_id(a.person_entity)::text id,o.display_name org from identity.affiliation a join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity) where nullif(trim(a.source),'') is not null and a.certainty in ('known','confirmed')`);
    const mappings = new Map((await tx.query<{ key:string; id:string }>(`select source_id key,identity.canonical_entity_id(entity_id)::text id from identity.source_record where source='portfolio'`)).map(r => [r.key,r.id]));
    const result = { rows:0,founders:0,possible:0,linked:0 };
    async function resolve(key:string,name:string,type:'person'|'org',org?:string) {
      const matches = entities.filter(e => e.type===type && normalizeIdentityName(e.name)===normalizeIdentityName(name));
      const corroborated = org ? matches.filter(e => affiliations.some(a => a.id===e.id && organizationNames(a.org).some(n => organizationNames(org).includes(n)))) : [];
      let id = mappings.get(key), resolution = id ? 'Existing source key' : 'Source identity; name-only matches remain possible';
      if (!id && corroborated.length===1) {
        const blocked = await tx.one(`select 1 from identity.match_assertion where kind='not_same_as' and
          ((left_source='portfolio' and left_source_id=$1) or (right_source='portfolio' and right_source_id=$1)) limit 1`,[key]);
        if (!blocked) { id=corroborated[0]!.id; resolution='Name and sourced company affiliation'; result.linked++; }
      }
      if (!id) id=(await tx.one<{id:string}>(`insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id`,[type,name]))!.id;
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('portfolio',$1,$2,$3) on conflict(source,source_id) do nothing`,[key,id,`rule:portfolio:${resolution}`]);
      mappings.set(key,id);
      const possibleMatches=matches.filter(m => m.id!==id).map(m=>m.id);
      for (const other of possibleMatches) {
        const [a,b]=[id,other].sort();
        await tx.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals) values($1,$2,0.25,$3::jsonb) on conflict(left_entity,right_entity) do nothing`,[a,b,JSON.stringify({rule:'portfolio-name-only',sourceKey:key})]);
        result.possible++;
      }
      return {entityId:id,possibleMatches,resolution};
    }
    for(const row of input.rows) {
      const company=await resolve(`${row.id}:company`,row.company.name,'org');
      const founders:PortfolioFounder[]=[];
      for(const f of row.founders) { founders.push({...f,...await resolve(`${row.id}:founder:${normalizeIdentityName(f.name)}`,f.name,'person',row.company.name)}); result.founders++; }
      for (const founder of founders) {
        await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
          select $1,$2,'principal','Founder',$3,$4::date,'known','Portfolio materials explicitly name this founder.'
          where not exists(select 1 from identity.affiliation where person_entity=$1 and org_entity=$2 and source=$3 and role='Founder')`,
          [founder.entityId,company.entityId,founder.source.file,founder.source.as_of]);
        const pl = await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record
          where (source='network_org' and source_id='pl') or (source='w3_person' and source_id='713c0c5f-8600-59da-abef-c84cc771b81a')
          order by source limit 1`);
        if (pl && pl.id !== founder.entityId) {
          const evidence=JSON.stringify([{note:'PLC portfolio founder; already in touch under the portfolio policy. No interaction date or consent is inferred.',
            source:founder.source.file,as_of:founder.source.as_of,confidence:founder.source.confidence,last_verified_by:founder.source.last_verified_by,
            portfolioId:row.id,tie:{kind:'investor_founder',withUs:'pl_founder'}}]);
          await tx.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
            select $1,$2,'portfolio','B',$3::jsonb,$4::date where not exists(select 1 from network.edge
              where from_entity=$1 and to_entity=$2 and evidence @> $5::jsonb)`,
            [pl.id,founder.entityId,evidence,founder.source.as_of,JSON.stringify([{portfolioId:row.id}])]);
        }
      }
      await tx.query(`insert into network.portfolio(portfolio_id,vehicle_id,company_entity,company_name,founders,source,fund_labels,note,input_hash)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) on conflict(portfolio_id) do update set
        vehicle_id=excluded.vehicle_id,company_entity=excluded.company_entity,company_name=excluded.company_name,founders=excluded.founders,
        source=excluded.source,fund_labels=excluded.fund_labels,note=excluded.note,input_hash=excluded.input_hash,imported_at=now()`,
        [row.id,vehicles.get(row.vehicle),company.entityId,row.company.name,JSON.stringify(founders),JSON.stringify(row.source),JSON.stringify(row.fund_labels??[]),row.note??null,hash]);
      result.rows++;
    }
    return result;
  });
}
export async function listPortfolio(vehicleId?: string): Promise<PortfolioRow[]> {
  return (await getDb()).query<PortfolioRow>(`select portfolio_id id,vehicle_id::text "vehicleId",identity.canonical_entity_id(company_entity)::text "companyId",
    company_name company,founders,source,fund_labels "fundLabels",note from network.portfolio ${vehicleId?'where vehicle_id=$1':''} order by company_name`,vehicleId?[vehicleId]:[]);
}
/** Canonical, confirmed portfolio membership only. Possible namesakes never inherit In touch. */
export async function portfolioFounders(): Promise<Record<string,string[]>> {
  const rows=await (await getDb()).query<{id:string;company:string}>(`select identity.canonical_entity_id((f->>'entityId')::uuid)::text id,p.company_name company
    from network.portfolio p cross join lateral jsonb_array_elements(p.founders) f`);
  const result:Record<string,string[]>={};for(const r of rows) if(r.id) result[r.id]=[...new Set([...(result[r.id]??[]),r.company])]; return result;
}
