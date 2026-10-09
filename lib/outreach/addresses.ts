import { can, type Principal } from '@/lib/authz';
import { getDb } from '@/lib/db';

/**
 * Email addresses on record for people and organisations (docs/27 §4): the one reader behind the queue's
 * `contacts`, the route hops' and introducers' `contact`, and top_connectors' `contact`, so every surface applies
 * the same rule.
 *
 *   - An address is an R2 value: shown only where the reader may read words on the vehicle the answer is about
 *     (`addressesReadable`). With no vehicle (routes_through without one), only an all-vehicle reader who reads R2.
 *   - Licensed (Dakota) addresses never appear: research claims sourced from Dakota are left out, whoever reads.
 *   - The best first: the latest confirmation, then the newest claim, then the addresses Affinity holds for the person.
 *     `source` says where it came from — "gmail" (confirmed by a person from their mailbox), "affinity", or "research" —
 *     with when and by whom it was confirmed.
 */

export interface Address { email: string; source: 'gmail' | 'affinity' | 'research'; confirmedAt: string | null; confirmedBy: string | null }

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** May this reader see addresses in an answer about this vehicle (or, with null, about no one vehicle)? */
export function addressesReadable(user: Principal, vehicleId: string | null): boolean {
  return vehicleId ? can(user, 'read', { vehicle: vehicleId, fieldClass: 'R2' }) : can(user, 'read', { fieldClass: 'R2' });
}

/**
 * Every current, non-licensed address claim per canonical entity, best first. Call only after addressesReadable.
 * The ids' aliases are expanded first (identity.alias_ids), so the claim index answers, not a scan of every claim.
 */
export async function addressesFor(entityIds: string[]): Promise<Map<string, Address[]>> {
  const out = new Map<string, Address[]>();
  const ids = [...new Set(entityIds)];
  if (!ids.length) return out;
  const rows = await (await getDb()).query<{ entity_id: string; value: string; source: string; origin: string | null; verified_at: Date | string | null; verified_by: string | null }>(`
    select identity.canonical_entity_id(c.entity_id)::text entity_id, c.value, c.source, d.origin, c.last_verified_at verified_at, u.name verified_by
      from research.claim c left join research.source_doc d on d.doc_id = c.source left join platform.app_user u on u.id = c.last_verified_by
     where c.entity_id = any(identity.alias_ids($1::uuid[])) and c.superseded_by is null and c.field ~ '(^|\\.)email$'
       and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota'
     order by c.last_verified_at desc nulls last, c.as_of desc`, [ids]);
  for (const e of rows) {
    const list = out.get(e.entity_id) ?? [];
    list.push({
      email: e.value.trim(),
      source: /gmail/i.test(e.source) || /gmail/i.test(e.origin ?? '') ? 'gmail' : /affinity/i.test(e.source) || /affinity/i.test(e.origin ?? '') ? 'affinity' : 'research',
      confirmedAt: day(e.verified_at), confirmedBy: e.verified_by,
    });
    out.set(e.entity_id, list);
  }
  // The addresses Affinity holds for the person (its primary address first), after every claim: unconfirmed, source
  // "affinity". Before 7 Oct 2026 only claims counted, and Affinity's addresses never became claims, so nearly every LP
  // had none (JuanMail: contacts empty on all 4,895 queue rows). The latest copy of each Affinity person record.
  const people = await (await getDb()).query<{ entity_id: string; payload: { primaryEmailAddress?: unknown; emailAddresses?: unknown } }>(`
    select distinct on (r.source_id) identity.canonical_entity_id(s.entity_id)::text entity_id, r.payload
      from identity.source_record s join sources.raw_record r on r.source = 'affinity' and r.kind = 'person' and r.source_id = substr(s.source_id, 8)
     where s.source = 'affinity' and s.source_id like 'person:%' and s.entity_id = any(identity.alias_ids($1::uuid[]))
     order by r.source_id, r.fetched_at desc, r.id desc`, [ids]);
  for (const p of people) {
    const list = out.get(p.entity_id) ?? [];
    const emails = [p.payload.primaryEmailAddress, ...(Array.isArray(p.payload.emailAddresses) ? p.payload.emailAddresses : [])];
    for (const e of emails) {
      if (typeof e !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())) continue;
      const email = e.trim();
      if (list.some((x) => x.email.toLowerCase() === email.toLowerCase())) continue;
      list.push({ email, source: 'affinity', confirmedAt: null, confirmedBy: null });
    }
    if (list.length) out.set(p.entity_id, list);
  }
  return out;
}

/** The best address for each entity, for a reader who may see them; an empty map otherwise. */
export async function bestAddresses(user: Principal, vehicleId: string | null, entityIds: string[]): Promise<{ shown: boolean; best: Map<string, Address> }> {
  if (!addressesReadable(user, vehicleId)) return { shown: false, best: new Map() };
  const all = await addressesFor(entityIds);
  return { shown: true, best: new Map([...all].map(([id, list]) => [id, list[0]!])) };
}

/** The note an answer carries when addresses were withheld. */
export const ADDRESSES_WITHHELD = 'Addresses are withheld at your access: they are words (R2) on this vehicle.';

/** A phone, title, firm, postal address or LinkedIn page on file: the newest reading per field, with its source. */
export interface Detail { value: string; source: 'gmail' | 'gmail-signature' | 'affinity' | 'research'; asOf: string; confirmed: boolean }
export const DETAIL_FIELDS = { phone: 'phone', title: 'title', organization: 'organization', postalAddress: 'postal_address', linkedin: 'linkedin' } as const;
export type Details = Partial<Record<keyof typeof DETAIL_FIELDS, Detail>>;

/**
 * Each entity's newest contact details (docs/29): phone, title, organization, postal address, LinkedIn, from any
 * non-licensed source, newest reading first per field. Call only after addressesReadable, as for addresses.
 */
export async function detailsFor(entityIds: string[]): Promise<Map<string, Details>> {
  const out = new Map<string, Details>();
  const ids = [...new Set(entityIds)];
  if (!ids.length) return out;
  const rows = await (await getDb()).query<{ entity_id: string; field: string; value: string; source: string; origin: string | null; as_of: Date | string; verified: boolean }>(`
    select distinct on (identity.canonical_entity_id(c.entity_id), c.field) identity.canonical_entity_id(c.entity_id)::text entity_id, c.field, c.value,
           c.source, d.origin, c.as_of, c.last_verified_by is not null verified
      from research.claim c left join research.source_doc d on d.doc_id = c.source
     where c.entity_id = any(identity.alias_ids($1::uuid[])) and c.superseded_by is null
       and c.field = any($2::text[]) and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota'
     order by identity.canonical_entity_id(c.entity_id), c.field, c.as_of desc, c.created_at desc`, [ids, Object.values(DETAIL_FIELDS)]);
  const key = Object.fromEntries(Object.entries(DETAIL_FIELDS).map(([k, v]) => [v, k])) as Record<string, keyof typeof DETAIL_FIELDS>;
  for (const r of rows) {
    const d = out.get(r.entity_id) ?? {};
    d[key[r.field]!] = {
      value: r.value, asOf: new Date(r.as_of).toISOString().slice(0, 10), confirmed: r.verified,
      source: /^gmail-signature/i.test(r.source) ? 'gmail-signature' : /gmail/i.test(r.source) || /gmail/i.test(r.origin ?? '') ? 'gmail' : /affinity/i.test(r.source) || /affinity/i.test(r.origin ?? '') ? 'affinity' : 'research',
    };
    out.set(r.entity_id, d);
  }
  return out;
}
