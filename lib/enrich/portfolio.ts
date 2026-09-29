import { createHash } from 'node:crypto';
import { recordActivity } from '@/lib/activity/log';
import { readFile } from 'node:fs/promises';
import { config } from '@/config/deployment';
import { getDb, type Db } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { resolveEntity, type EntityCreation } from '@/modules/identity/create';

export interface PortfolioSource { file: string; page: number; as_of: string; confidence: number; last_verified_by: string }
export interface PortfolioPerson {
  name: string; source: PortfolioSource; role?: string;
  company_domain?: string | null; company_domain_source?: PortfolioSource;
  organization_names?: string[]; organization_names_source?: PortfolioSource;
  profile_urls?: string[]; profile_sources?: Array<{ url: string; source: PortfolioSource }>;
  warehouse_person_id?: string | null; warehouse_person_id_source?: PortfolioSource;
}
export interface PortfolioInvestment {
  date: string | null; amount: number | null; currency: string | null; multiple: number | null;
  fund_label?: string; round?: string; source: PortfolioSource; note?: string;
}
export interface PortfolioInputRow {
  id: string; vehicle: string;
  company: { name: string; domain?: string | null; domain_source?: PortfolioSource; organization_names?: string[];
    warehouse_company_id?: string | null; warehouse_company_id_source?: PortfolioSource };
  founders: PortfolioPerson[]; source: PortfolioSource; fund_labels?: string[]; note?: string;
  investments?: PortfolioInvestment[]; portfolio_status?: string;
}
export interface PortfolioInput {
  version: 1; as_of: string;
  coverage: Array<{ vehicle: string; status: string; detail: string; source?: unknown }>;
  rows: PortfolioInputRow[]; spv_rows?: PortfolioInputRow[]; excluded?: Array<{ id: string }>;
}
export interface PortfolioFounder extends PortfolioPerson { entityId: string; possibleMatches: string[]; resolution: string }
export interface PortfolioRow {
  id: string; vehicleId: string; companyId: string; company: string; founders: PortfolioFounder[];
  source: PortfolioSource; fundLabels: string[]; note: string | null;
  investments: PortfolioInvestment[]; portfolioStatus: string | null;
}
export const portfolioFile = () => `data/${config.data.profile}/portfolio/portfolio.json`;
export async function readPortfolioFile(): Promise<PortfolioInput | null> {
  try { return JSON.parse(await readFile(portfolioFile(), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Portfolio file is not valid JSON.'); }
}
const dateValid = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const investmentDateValid = (s: unknown) => dateValid(s) || (typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s));
const sourceValid = (s: PortfolioSource | undefined) => s && typeof s.file === 'string' && !!s.file.trim()
  && Number.isInteger(s.page) && s.page > 0 && typeof s.as_of === 'string' && dateValid(s.as_of.slice(0, 10))
  && Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1 && typeof s.last_verified_by === 'string' && !!s.last_verified_by.trim();
const stringsValid = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string' && !!x.trim());
const urlKey = (s: string) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}` : ''; } catch { return ''; } };
const domainKey = (s: string) => { try { return new URL(s.includes('://') ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const rowsOf = (input: PortfolioInput) => [...input.rows, ...(input.spv_rows ?? [])];
export function portfolioProblems(input: PortfolioInput): string[] {
  if (!input || input.version !== 1 || !Array.isArray(input.rows) || !Array.isArray(input.coverage)
    || (input.spv_rows !== undefined && !Array.isArray(input.spv_rows))
    || (input.excluded !== undefined && (!Array.isArray(input.excluded) || input.excluded.some(r => !r || typeof r.id !== 'string' || !r.id.trim())))) return ['Expected version 1, rows, coverage and valid optional row lists.'];
  const errors: string[] = [], ids = new Set<string>();
  for (const [i, r] of rowsOf(input).entries()) {
    if (!r || typeof r.id !== 'string' || !r.id.trim() || ids.has(r.id) || typeof r.vehicle !== 'string' || !r.vehicle.trim()
      || !r.company?.name?.trim() || !sourceValid(r.source) || !Array.isArray(r.founders)) { errors.push(`Row ${i + 1}: missing provenance, invalid identity, vehicle or duplicate key.`); continue; }
    ids.add(r.id);
    const c = r.company;
    if ((c.domain != null && (typeof c.domain !== 'string' || !domainKey(c.domain) || !sourceValid(c.domain_source)))
      || (c.warehouse_company_id != null && (typeof c.warehouse_company_id !== 'string' || !c.warehouse_company_id.trim() || !sourceValid(c.warehouse_company_id_source)))
      || (c.organization_names !== undefined && !stringsValid(c.organization_names))) errors.push(`Row ${i + 1}: company identity requires provenance.`);
    for (const f of r.founders) {
      if (!f?.name?.trim() || !sourceValid(f.source)
        || (f.company_domain != null && (typeof f.company_domain !== 'string' || !domainKey(f.company_domain) || !sourceValid(f.company_domain_source)))
        || (f.organization_names !== undefined && (!stringsValid(f.organization_names) || !sourceValid(f.organization_names_source)))
        || (f.warehouse_person_id != null && (typeof f.warehouse_person_id !== 'string' || !f.warehouse_person_id.trim() || !sourceValid(f.warehouse_person_id_source)))
        || (f.profile_urls !== undefined && (!stringsValid(f.profile_urls) || !Array.isArray(f.profile_sources)
          || f.profile_urls.some(url => !urlKey(url) || !f.profile_sources!.some(p => p.url === url && sourceValid(p.source)))))) errors.push(`Row ${i + 1}: founder identity requires provenance.`);
    }
    if (r.investments !== undefined && (!Array.isArray(r.investments) || r.investments.some(v => !v || !sourceValid(v.source)
      || (v.date !== null && !investmentDateValid(v.date)) || (v.amount !== null && (typeof v.amount !== 'number' || !Number.isFinite(v.amount) || v.amount < 0))
      || (v.multiple !== null && (typeof v.multiple !== 'number' || !Number.isFinite(v.multiple) || v.multiple < 0))
      || (v.currency !== null && (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency)))
      || (v.amount !== null && v.currency === null)))) errors.push(`Row ${i + 1}: investment requires valid values and provenance.`);
    if (r.portfolio_status !== undefined && (typeof r.portfolio_status !== 'string' || !r.portfolio_status.trim())) errors.push(`Row ${i + 1}: invalid portfolio status.`);
  }
  return errors;
}
export interface PortfolioResult { rows: number; founders: number; possible: number; linked: number; removed: number }
const affiliationNote = 'Portfolio import: sourced founder affiliation.';
const legacyAffiliationNote = 'Portfolio materials explicitly name this founder.';
/** The file is an authoritative snapshot, including explicit exclusions. Source-owned facts remain separate
 * from independent graph evidence. Existing source keys stay attached until explicit identity review. */
export async function importPortfolio(db: Db, input: PortfolioInput): Promise<PortfolioResult> {
  const activityAt = new Date().toISOString();
  const errors = portfolioProblems(input); if (errors.length) throw new Error(errors.join(' '));
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const excluded = new Set(input.excluded?.map(r => r.id));
  const rows = rowsOf(input).filter(r => !excluded.has(r.id));
  const imported = await db.transaction(async tx => {
    await tx.exec('lock table identity.entity, identity.source_record, network.portfolio in share row exclusive mode');
    const vehicles = new Map((await tx.query<{ id: string; slug: string; kind: string }>('select id::text,slug,kind::text from platform.vehicle')).map(v => [v.slug, v]));
    if (rows.some(r => !['fund', 'spv'].includes(vehicles.get(r.vehicle)?.kind ?? ''))
      || (input.spv_rows ?? []).some(r => !excluded.has(r.id) && vehicles.get(r.vehicle)?.kind !== 'spv')) throw new Error('Portfolio vehicle is unavailable or has the wrong kind.');
    const sources = await tx.query<{ source: string; key: string; id: string }>(`select source,source_id key,identity.canonical_entity_id(entity_id)::text id from identity.source_record`);
    const sourceIds = new Map(sources.map(s => [`${s.source}:${s.key}`, s.id]));
    const result: PortfolioResult = { rows: 0, founders: 0, possible: 0, linked: 0, removed: 0 };
    async function resolve(key: string, name: string, type: 'person' | 'org', incoming: Pick<EntityCreation, 'organizations' | 'domains' | 'personalUrls'>) {
      const resolved = await resolveEntity(tx, { type, name, source: 'portfolio', sourceId: key, ...incoming });
      if (!resolved.created && resolved.rule !== 'source_id') result.linked++;
      if (resolved.created) await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('portfolio_placeholder',$1::text,($1::text)::uuid,'rule:portfolio:source-created-placeholder') on conflict(source,source_id) do nothing`, [resolved.id]);
      // Include the live queue on retries; source-id attachment itself does not enqueue again.
      const possibleMatches = (await tx.query<{ id: string }>(`select case when left_entity=$1 then right_entity else left_entity end::text id
        from identity.possible_match where active and (left_entity=$1 or right_entity=$1)`, [resolved.id])).map(p => p.id);
      result.possible += possibleMatches.length;
      return { entityId: resolved.id, possibleMatches, resolution: resolved.rule };
    }
    const pl = sourceIds.get('network_org:pl') ?? sourceIds.get('w3_person:713c0c5f-8600-59da-abef-c84cc771b81a');
    const desiredEdges = new Map<string, { from: string; to: string; evidence: Record<string, unknown>; asOf: string }>();
    const desiredAffiliations = new Map<string, { person: string; company: string; source: PortfolioSource }>();
    for (const row of rows) {
      const company = await resolve(`${row.id}:company`, row.company.name, 'org', {});
      const founders: PortfolioFounder[] = [];
      for (const f of row.founders) {
        const founder = { ...f, ...await resolve(`${row.id}:founder:${normalizeIdentityName(f.name)}`, f.name, 'person', {
          organizations: [row.company.name, ...(row.company.organization_names ?? []), ...(f.organization_names ?? [])],
          personalUrls: f.profile_urls,
        }) };
        founders.push(founder); result.founders++;
        desiredAffiliations.set(`${founder.entityId}:${company.entityId}:${f.source.file}`, { person: founder.entityId, company: company.entityId, source: f.source });
        if (pl && pl !== founder.entityId && !row.portfolio_status?.startsWith('warehouse_') && row.portfolio_status !== 'research_scope_only') {
          const evidence = { note: 'PLC portfolio founder; already in touch under the portfolio policy. No interaction date or consent is inferred.',
            source: f.source.file, as_of: f.source.as_of, confidence: f.source.confidence, last_verified_by: f.source.last_verified_by,
            portfolioId: row.id, tie: { kind: 'investor_founder', withUs: 'pl_founder' } };
          desiredEdges.set(`${row.id}:${pl}:${founder.entityId}`, { from: pl, to: founder.entityId, evidence, asOf: f.source.as_of });
        }
      }
      await tx.query(`insert into network.portfolio(portfolio_id,vehicle_id,company_entity,company_name,founders,source,fund_labels,note,input_hash,investments,portfolio_status)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11) on conflict(portfolio_id) do update set
        vehicle_id=excluded.vehicle_id,company_entity=excluded.company_entity,company_name=excluded.company_name,founders=excluded.founders,
        source=excluded.source,fund_labels=excluded.fund_labels,note=excluded.note,input_hash=excluded.input_hash,investments=excluded.investments,portfolio_status=excluded.portfolio_status,imported_at=now()`,
      [row.id, vehicles.get(row.vehicle)!.id, company.entityId, row.company.name, JSON.stringify(founders), JSON.stringify(row.source), JSON.stringify(row.fund_labels ?? []), row.note ?? null, hash, JSON.stringify(row.investments ?? []), row.portfolio_status ?? null]);
      result.rows++;
    }
    result.removed = (await tx.query(`delete from network.portfolio where not (portfolio_id=any($1::text[])) returning portfolio_id`, [rows.map(r => r.id)])).length;
    const oldAffiliations = await tx.query<{ id: string; person: string; company: string; source: string }>(`select affiliation_id::text id,person_entity::text person,org_entity::text company,source from identity.affiliation where note=any($1::text[])`, [[affiliationNote, legacyAffiliationNote]]);
    for (const a of oldAffiliations) {
      const key = `${a.person}:${a.company}:${a.source}`;
      if (desiredAffiliations.has(key)) desiredAffiliations.delete(key);
      else await tx.query('delete from identity.affiliation where affiliation_id=$1', [a.id]);
    }
    for (const a of desiredAffiliations.values()) await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
      values($1,$2,'principal','Founder',$3,$4::date,'known',$5)`, [a.person, a.company, a.source.file, a.source.as_of, affiliationNote]);
    // Strip only this import's evidence. A mixed edge retains independently sourced facts.
    const oldEdges = await tx.query<{ id: string; from: string; to: string; evidence: Array<Record<string, unknown>> }>(`select edge_id::text id,from_entity::text "from",to_entity::text "to",evidence from network.edge where kind='portfolio'
      and exists(select 1 from jsonb_array_elements(evidence) v where v ? 'portfolioId')`);
    for (const edge of oldEdges) {
      const next: Array<Record<string, unknown>> = [];
      for (const e of edge.evidence) {
        if (!e.portfolioId) { next.push(e); continue; }
        const key = `${e.portfolioId}:${edge.from}:${edge.to}`, desired = desiredEdges.get(key);
        if (desired) { next.push(desired.evidence); desiredEdges.delete(key); }
      }
      if (!next.length) await tx.query('delete from network.edge where edge_id=$1', [edge.id]);
      else if (JSON.stringify(next) !== JSON.stringify(edge.evidence)) await tx.query('update network.edge set evidence=$2::jsonb where edge_id=$1', [edge.id, JSON.stringify(next)]);
    }
    for (const edge of desiredEdges.values()) await tx.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from) values($1,$2,'portfolio','B',$3::jsonb,$4::date)`, [edge.from, edge.to, JSON.stringify([edge.evidence]), edge.asOf]);
    return result;
  });
  await recordActivity({ source: 'intake', at: activityAt, segment: 'portfolio', requests: 0,
    bytesIn: null, bytesOut: 0, records: imported.rows });
  return imported;
}
export async function listPortfolio(vehicleId?: string): Promise<PortfolioRow[]> {
  return (await getDb()).query<PortfolioRow>(`select portfolio_id id,vehicle_id::text "vehicleId",identity.canonical_entity_id(company_entity)::text "companyId",
    company_name company,founders,source,fund_labels "fundLabels",note,investments,portfolio_status "portfolioStatus" from network.portfolio ${vehicleId ? 'where vehicle_id=$1' : ''} order by company_name`, vehicleId ? [vehicleId] : []);
}
export interface PortfolioIdentity {
  /** The record the source key resolves to now, after any merge. */
  canonicalId: string;
  /** False while the record is still the placeholder the import made for a name it could not corroborate. */
  corroborated: boolean;
  /** Namesakes still open as possible matches, never the record itself. */
  possible: Array<{ id: string; name: string }>;
}
/**
 * How each imported founder or company stands today. The import stores a snapshot; a later merge,
 * a rejected match or a corroboration changes the answer, so the page asks the identity tables.
 * A placeholder merged into an independent record counts as corroborated: someone joined them.
 */
export async function portfolioIdentities(people: Array<{ id: string; possible: string[] }>): Promise<Map<string, PortfolioIdentity>> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set(people.flatMap(p => [p.id, ...p.possible]))].filter(id => uuid.test(id));
  const result = new Map<string, PortfolioIdentity>();
  if (!ids.length) return result;
  const db = await getDb();
  const [records, open] = await Promise.all([
    db.query<{ id: string; canonical: string; name: string; placeholder: boolean }>(`select i.id::text id,c.entity_id::text canonical,c.display_name name,
      exists(select 1 from identity.source_record s where s.source='portfolio_placeholder' and s.source_id=c.entity_id::text) placeholder
      from unnest($1::uuid[]) i(id) join identity.entity c on c.entity_id=identity.canonical_entity_id(i.id)
      where c.retired_at is null`, [ids]),
    db.query<{ a: string; b: string }>(`select left_entity::text a,right_entity::text b from identity.possible_match
      where active and (left_entity=any($1::uuid[]) or right_entity=any($1::uuid[]))`, [ids]),
  ]);
  const byId = new Map(records.map(r => [r.id, r]));
  const pairs = new Set(open.map(p => [p.a, p.b].sort().join('|')));
  for (const p of people) {
    const self = byId.get(p.id); if (!self) continue;
    const seen = new Set([self.canonical]);
    const possible = p.possible.flatMap(other => {
      const match = byId.get(other);
      if (!match || seen.has(match.canonical) || !pairs.has([p.id, other].sort().join('|'))) return [];
      seen.add(match.canonical); return [{ id: match.canonical, name: match.name }];
    });
    result.set(p.id, { canonicalId: self.canonical, corroborated: !self.placeholder, possible });
  }
  return result;
}
/** Warehouse classification alone is not verified fund membership or an In touch assertion. */
export async function portfolioFounders(): Promise<Record<string, string[]>> {
  const rows = await (await getDb()).query<{ id: string; company: string }>(`select identity.canonical_entity_id((f->>'entityId')::uuid)::text id,p.company_name company
    from network.portfolio p cross join lateral jsonb_array_elements(p.founders) f where coalesce(p.portfolio_status,'') not like 'warehouse_%' and coalesce(p.portfolio_status,'') <> 'research_scope_only'`);
  const result: Record<string, string[]> = {}; for (const r of rows) if (r.id) result[r.id] = [...new Set([...(result[r.id] ?? []), r.company])]; return result;
}
