import { createHash } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import type { Finding } from './schema';
import type { WarehouseGraph } from './warehouse-graph';
import { normalizeIdentityName } from '@/modules/identity/resolution';

const RULE = 'investing-organization:v1';
const normalize = normalizeIdentityName;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const stableId = (s: string) => { const h = digest(s); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const date = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
const uncertain = /\b(not|never|no evidence|unconfirmed|possibly|may be|might be|formerly|former|ex-|stepped down|left the|retired)\b/i;
const investing = /\b(invest(?:s|ing|ment|ments)?|allocator|allocates? capital|family office|donor.advised fund|DAF|holding company|venture capital|private equity)\b/i;
const institution = /\b(foundation|family office|fund|capital|ventures|holdings|holding company|DAF|institute|trust)\b/i;
// A named investment business/activity, not an incoming financing or philanthropic grant.
const investmentBusiness = /\b(family office|donor.advised fund|DAF|holding company|venture capital|private equity|investment (?:firm|fund|manager|arm|portfolio|management)|investing arm|fund.investing|(?:head|director) of (?:strategic )?investments|makes? (?:fund )?investments|invests in)\b/i;
const organizationFields = ['company', 'organization', 'org', 'firm', 'fund', 'institution'];
export interface OrganizationEvidence {
  person: string; personSource?: 'warehouse'; organization: string;
  kind: 'principal' | 'board'; role: string; tier: 'B' | 'C';
  evidence: Array<{ source: string; as_of: string; confidence: string; last_verified_by: string | null; note: string }>;
}
export interface OrganizationLpCounts { candidates: number; added: number; existing: number; ambiguous: number; affiliations: number; ties: number }

/** Only leadership in the named organisation qualifies; another role in a long biography does not. */
export function leadership(text: string, org: string): { kind: 'principal' | 'board'; role: string } | null {
  if (uncertain.test(text) || /\b(assistant|advis(?:e[rs]?|or|ory)|reports? to|works? for|invest(?:ed|s) with|(?:wife|husband|son|daughter|partner) of|called|named)\b/i.test(text)) return null;
  const name = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const role = '(?:co[ -]?)?found(?:er|ed)|chair(?:man|woman|person)?|principal|president|chief executive|CEO|runs|leads|funds|board member|trustee';
  const before = new RegExp(`\\b(${role})\\b[^.;:]{0,65}\\b${name}\\b`, 'i').exec(text);
  const after = new RegExp(`\\b${name}\\b(?:['’]s)?[, ]+(${role})\\b`, 'i').exec(text);
  const match = before?.[1] ?? after?.[1];
  if (!match) return null;
  return { kind: /chair|board|trustee/i.test(match) ? 'board' : 'principal', role: match };
}
/** Investing in an organisation does not mean that organisation invests. */
function investsItself(text: string, org: string): boolean {
  const escaped = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b(?:['’]s)?\\s+(?:is\\s+(?:an?\\s+)?(?:\\w+\\s+){0,3})?(?:invests|investing|investment|allocates|family office|donor.advised fund|holding company|venture capital|private equity|has\\s+(?:an?\\s+)?(?:strategic[ -])?invest|runs\\s+(?:an?\\s+)?invest)`, 'i').test(text);
}
const namesOf = (f: Finding) => [...new Set([
  ...(f.identity.canonical?.org?.split(/\s*;\s*/) ?? []),
  ...f.facts.flatMap(fact => organizationFields.flatMap(k => typeof fact.detail?.[k] === 'string' ? String(fact.detail[k]).split(/\s*;\s*/) : [])),
  ...(f.connections ?? []).filter(c => c.toType === 'org').map(c => c.to),
].map(s => s.trim()).filter(Boolean))];
const names = (s: string, org: string) => normalize(s).includes(normalize(org));

/** A sourced investing division can be the LP even when the bio names its parent institute. */
function foundationDivision(f: Finding, parent: string) {
  const stem = parent.replace(/\s+(?:institute|institution|organization|organisation)$/i, '').trim();
  if (stem === parent || !stem) return null;
  const fact = f.facts.find(x => x.scope === 'firm' && x.confidence !== 'low' && x.source.kind === 'primary'
    && organizationFields.some(k => typeof x.detail?.[k] === 'string' && normalize(String(x.detail[k])) === normalize(parent))
    && new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.;:]{0,120}\\bits Foundation\\b`, 'i').test(x.value)
    && investmentBusiness.test(x.value) && !uncertain.test(x.value));
  return fact ? { name: `${stem} Foundation`, fact } : null;
}

/** No amounts, consent, decision rights, or investor approval are inferred by this rule. */
export function findingOrganizations(f: Finding): OrganizationEvidence[] {
  if (!['confirmed', 'probable'].includes(f.identity.match)) return [];
  const asOf = date(f.researched.at);
  if (!asOf) return [];
  const out: OrganizationEvidence[] = [];
  for (const parent of namesOf(f)) {
    const division = foundationDivision(f, parent);
    const org = division?.name ?? parent;
    const facts = f.facts.filter(x => x.confidence !== 'low' &&
      (organizationFields.some(k => typeof x.detail?.[k] === 'string' && String(x.detail[k]).split(/\s*;\s*/).some(n => normalize(n) === normalize(parent))) || names(x.value, parent)));
    const statements = facts.map(x => ({ text: x.value, source: x.source.url, as_of: date(x.source.published ?? '') ?? asOf,
      confidence: x.confidence, personal: x.scope !== 'firm', firm: x.scope === 'firm', prior: x.field === 'prior_role' }));
    for (const c of f.connections ?? []) if (c.toType === 'org' && normalize(c.to) === normalize(org) && c.source) {
      statements.push({text: c.basis, source: c.source, as_of: asOf, confidence: c.tier === 'B' ? 'high' : 'low', personal: c.scope !== 'firm', firm: c.scope === 'firm', prior: false});
    }
    // Summaries are usable only with a source that names this organisation in the accepted finding.
    if (facts.length) for (const text of [f.profile?.summary, f.profile?.howTheyInvest]) if (text) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) if (names(sentence, org)) statements.push({
        text: sentence, source: `enrich/raw/${f.key}.json`, as_of: asOf, confidence: 'medium', personal: true, firm: false, prior: false,
      });
    }
    const led = statements.find(x => x.personal && !x.prior && leadership(x.text, parent));
    // A foundation may only make grants. Require positive investment evidence, attached to this org.
    const invests = division ? statements.find(x => x.text === division.fact.value)
      : statements.find(x => !uncertain.test(x.text) && investing.test(x.text)
        && (investsItself(x.text, org) || (x.firm && investmentBusiness.test(x.text))));
    if (!led || !invests || !(institution.test(org) || institution.test(invests.text))) continue;
    const relation = leadership(led.text, parent)!;
    out.push({ person: f.key, organization: org, ...relation,
      role: division ? `${relation.role} of ${parent}; ${org} is its investing division` : relation.role,
      tier: led.confidence === 'low' ? 'C' : 'B',
      evidence: [...new Set([led, invests])].map(x => ({source:x.source,as_of:x.as_of,confidence:x.confidence,last_verified_by:null,note:x.text})),
    });
  }
  return out;
}

/** A warehouse source key is an identity reference, never a name-only person match. */
export function warehouseOrganizations(graph: WarehouseGraph): OrganizationEvidence[] {
  const out: OrganizationEvidence[] = [];
  for (const p of graph.people) {
    if (!p.org || p.nodeType === 'organization' || !date(p.as_of) || !p.source) continue;
    const text = `${p.roles.join('; ')} at ${p.org}`;
    const relation = leadership(text, p.org);
    if (!relation || !institution.test(p.org) || !investing.test(p.org)) continue;
    out.push({ person:p.key, personSource:'warehouse', organization:p.org, ...relation, tier:'B',
      evidence:[{source:p.source,as_of:date(p.as_of)!,confidence:p.confidence,last_verified_by:p.last_verified_by,note:text}] });
  }
  return out;
}

/** Existing Affinity organisations/affiliations contribute only sourced leadership, never generic contact links. */
async function affiliationEvidence(tx: Queryable): Promise<OrganizationEvidence[]> {
  const rows = await tx.query<{person:string;organization:string;kind:'principal'|'board';role:string;source:string;as_of:string;certainty:string;note:string}>(
    `select identity.canonical_entity_id(a.person_entity)::text person,e.display_name organization,a.kind::text,a.role,a.source,a.as_of::text,a.certainty,coalesce(a.note,'') note
     from identity.affiliation a join identity.entity e on e.entity_id=identity.canonical_entity_id(a.org_entity)
     where a.ended_on is null and a.kind in ('principal','board') and a.source is not null
       and a.source not like 'investing-organization:%' and a.source <> 'dakota'
       and a.certainty in ('known','confirmed')`);
  return rows.filter(r => leadership(`${r.role} at ${r.organization}`,r.organization) && institution.test(r.organization)
    && (investmentBusiness.test(r.organization) || investsItself(r.note,r.organization) || investmentBusiness.test(r.note)) && !uncertain.test(r.note)).map(r => ({
      person:r.person,organization:r.organization,kind:r.kind,role:r.role,tier:'B',
      evidence:[{source:r.source,as_of:r.as_of,confidence:r.certainty,last_verified_by:null,note:`${r.role} at ${r.organization}. ${r.note}`}],
    }));
}

/** Existing server handle only. Serial lookup/create and insert-only pursuits protect all human statuses. */
export async function addOrganizationLps(db: Db, findings: Finding[], actorId: string | null,
  warehouse: WarehouseGraph = {people:[],ties:[],matches:[]}): Promise<OrganizationLpCounts> {
  const proposed = [...findings.flatMap(findingOrganizations), ...warehouseOrganizations(warehouse)];
  return db.transaction(async tx => {
    await tx.exec('lock table identity.entity, identity.source_record, identity.affiliation, strategy.pursuit in share row exclusive mode');
    proposed.push(...await affiliationEvidence(tx));
    const counts:OrganizationLpCounts = {candidates:proposed.length,added:0,existing:0,ambiguous:0,affiliations:0,ties:0};
    // Resolve the small LP universe once; never re-walk every pursuit for each finding.
    const activePursuits = await tx.query<{person:string;vehicle:string;owner:string}>(`select identity.canonical_entity_id(p.entity_id)::text person,
      p.vehicle_id::text vehicle,p.owner_id::text owner from strategy.pursuit p join platform.vehicle v on v.id=p.vehicle_id
      join identity.entity e on e.entity_id=p.entity_id where e.entity_type='person' and e.retired_at is null
      and p.closed_at is null and v.phase='active' and v.kind<>'grant_rail'`);
    const existingPursuits = new Set((await tx.query<{person:string;vehicle:string}>(`select identity.canonical_entity_id(entity_id)::text person,vehicle_id::text vehicle from strategy.pursuit`)).map(p=>`${p.person}:${p.vehicle}`));
    const ownedAffiliations = new Map((await tx.query<{person:string;org:string;source:string}>(`select identity.canonical_entity_id(person_entity)::text person,
      identity.canonical_entity_id(org_entity)::text org,source from identity.affiliation where source like $1`,[`${RULE}:%`])).map(a=>[`${a.person}:${a.org}`,a.source]));
    const seen = new Set<string>();
    for (const c of proposed) {
      const person = c.personSource ? await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source=$1 and source_id=$2`,[c.personSource,c.person])
        : await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.entity where entity_id=$1::uuid`,[c.person]);
      if (!person) continue;
      const pursuits = activePursuits.filter(p => p.person === person.id);
      if (!pursuits.length) continue;
      const key = `${person.id}:${normalize(c.organization)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mapped = await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source=$1 and source_id=$2`,[RULE,normalize(c.organization)]);
      const matches = mapped ? [mapped] : await tx.query<{id:string;affinity:boolean}>(`select e.entity_id::text id,
        exists(select 1 from identity.source_record s where s.entity_id=e.entity_id and s.source='affinity') affinity
        from identity.entity e where e.entity_type in ('org','foundation','family') and e.merged_into is null and e.retired_at is null
          and lower(trim(e.display_name))=$1`,[normalize(c.organization)]);
      // Duplicate derived network nodes may coexist with the single authoritative CRM organisation.
      const authoritative = matches.filter(m => 'affinity' in m && m.affinity);
      if (matches.length > 1 && authoritative.length !== 1) {counts.ambiguous++;continue;}
      let orgId = (authoritative[0] ?? matches[0])?.id;
      if (!orgId) orgId = (await tx.one<{id:string}>(`insert into identity.entity(entity_type,display_name) values('org',$1) returning entity_id::text id`,[c.organization]))!.id;
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,$1) on conflict(source,source_id) do nothing`,[RULE,normalize(c.organization),orgId]);
      const evidence = {rule:RULE,inputHash:digest(JSON.stringify(c)),person:person.id,organization:orgId,role:c.role,tier:c.tier,evidence:c.evidence};
      const source = ownedAffiliations.get(`${person.id}:${orgId}`) ?? `${RULE}:${digest(`${person.id}:${orgId}`)}`;
      const asOf = c.evidence.map(e=>e.as_of).sort().at(-1)!;
      const aff = await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
        select $1,$2,$3::identity.affil_kind,$4,$5,$6::date,'claimed',$7 where not exists
        (select 1 from identity.affiliation where source=$5) returning affiliation_id`,
        [person.id,orgId,c.kind,c.role,source,asOf,JSON.stringify(evidence)]);
      counts.affiliations += aff.length;
      ownedAffiliations.set(`${person.id}:${orgId}`,source);
      const edge = await tx.query(`insert into network.edge(from_entity,to_entity,kind,tier,tie_band,evidence,valid_from,edge_id)
        values($1,$2,$3::network.edge_kind,$4::network.evidence_tier,case when $4='B' then 'strong' else 'weak' end,$5::jsonb,$6::date,$7)
        on conflict(edge_id) do update set evidence=excluded.evidence,tier=excluded.tier,tie_band=excluded.tie_band
          where network.edge.reviewed_at is null and network.edge.valid_to is null
            and not exists(select 1 from jsonb_array_elements(network.edge.evidence) e where e->>'derived' is distinct from 'investing-organization:v1')
            and (network.edge.evidence is distinct from excluded.evidence or network.edge.tier is distinct from excluded.tier)
          returning edge_id`,
        [person.id,orgId,c.kind==='board'?'board':'employment',c.tier,JSON.stringify(c.evidence.map(e=>({...e,derived:RULE,ruleKey:source,role:c.role,tie:{kind:c.tier==='B'?'worked_together':'proximity'}}))),asOf,stableId(source)]);
      counts.ties += edge.length;
      for (const p of pursuits) {
        const pursuitKey = `${orgId}:${p.vehicle}`;
        if (existingPursuits.has(pursuitKey)) {counts.existing++;continue;}
        const reason = `${RULE}: ${c.role} of ${c.organization}; ${c.evidence.map(e=>`${e.note} [${e.source}, as of ${e.as_of}, ${e.confidence}]`).join(' ')}`;
        const saved = await tx.one<{id:string}>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_reason,status_set_at,status_set_by,source)
          values($1,$2,$3,'new','rule',$4,now(),$5,$6) on conflict(entity_id,vehicle_id) do nothing returning pursuit_id::text id`,
          [orgId,p.vehicle,p.owner,reason,actorId,RULE]);
        if (!saved) continue;
        await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'pursuit.organization_added','pursuit',$2,$3::jsonb)`,
          [actorId,saved.id,JSON.stringify({...evidence,vehicleId:p.vehicle,statusSource:'rule',to:'New'})]);
        await tx.query(`insert into research.note(entity_id,kind,body,data) values($1,'context',$2,$3::jsonb)`,
          [orgId,reason,JSON.stringify({...evidence,pursuitId:saved.id,vehicleId:p.vehicle})]);
        existingPursuits.add(pursuitKey);
        counts.added++;
      }
    }
    return counts;
  });
}
