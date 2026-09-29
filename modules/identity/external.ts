import type { Queryable } from '@/lib/db';
import { resolveEntity } from './create';

export type IdentifierKind = 'domain' | 'linkedin' | 'crd' | 'cik';
export type Identifiers = Partial<Record<IdentifierKind, string>>;
/** Normalize identifiers, never prose or an email's shared employer domain. */
export function normalizeIdentifier(kind: IdentifierKind, value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (kind === 'crd' || kind === 'cik') return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (kind === 'domain') return host.includes('.') ? host : null;
    return host === 'linkedin.com' && /^\/(in|company)\/[^/]+\/?$/.test(u.pathname)
      ? `linkedin.com${u.pathname.replace(/\/$/, '').toLowerCase()}` : null;
  } catch { return null; }
}

/** The shared creation policy owns matching; external identifiers remain source-owned facts. */
export async function resolveExternalIdentity(tx: Queryable, input: {
  source: string; sourceId: string; type: 'person' | 'org'; name: string; identifiers: Identifiers;
  asOf: string; verifiedBy: string; domains?: string[]; organizations?: string[];
}): Promise<{ id: string; merged: number; possible: number }> {
  const resolved = await resolveEntity(tx, {
    source: input.source, sourceId: input.sourceId, type: input.type, name: input.name,
    domains: input.domains, organizations: input.organizations,
    personalUrls: input.type === 'person' && input.identifiers.linkedin ? [input.identifiers.linkedin] : [],
    resolvedBy: 'rule:source-owned',
  });
  const id = resolved.id;
  const normalized: Array<[IdentifierKind,string]> = [];
  for (const [kind,value] of Object.entries(input.identifiers)) {
    const v = normalizeIdentifier(kind as IdentifierKind,value);
    if (v) { normalized.push([kind as IdentifierKind,v]); }
  }
  // Multiple source records may now attach directly to one entity. Keep their other identifiers.
  const shared = Number((await tx.one<{ n: string }>('select count(*)::text n from identity.source_record where entity_id=$1 and source=$2',[id,input.source]))!.n) > 1;
  if (!shared) await tx.query('delete from identity.external_identifier where entity_id=$1 and source=$2',[id,input.source]);
  for (const [kind,value] of normalized) await tx.query(`insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
    values($1,$2,$3,$4,$5,'medium',$6) on conflict(entity_id,kind,value,source) do update
      set as_of=excluded.as_of,confidence=excluded.confidence,last_verified_by=excluded.last_verified_by`,[id,kind,value,input.source,input.asOf,input.verifiedBy]);
  return {id,merged:0,possible:resolved.possible.length};
}
