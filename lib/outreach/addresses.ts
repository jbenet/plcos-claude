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
 *   - The best first: the latest confirmation, then the newest claim. `source` says where it came from — "gmail"
 *     (confirmed by a person from their mailbox), "affinity", or "research" — with when and by whom it was confirmed.
 */

export interface Address { email: string; source: 'gmail' | 'affinity' | 'research'; confirmedAt: string | null; confirmedBy: string | null }

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** May this reader see addresses in an answer about this vehicle (or, with null, about no one vehicle)? */
export function addressesReadable(user: Principal, vehicleId: string | null): boolean {
  return vehicleId ? can(user, 'read', { vehicle: vehicleId, fieldClass: 'R2' }) : can(user, 'read', { fieldClass: 'R2' });
}

/** Every current, non-licensed address claim per canonical entity, best first. Call only after addressesReadable. */
export async function addressesFor(entityIds: string[]): Promise<Map<string, Address[]>> {
  const out = new Map<string, Address[]>();
  const ids = [...new Set(entityIds)];
  if (!ids.length) return out;
  const rows = await (await getDb()).query<{ entity_id: string; value: string; source: string; origin: string | null; verified_at: Date | string | null; verified_by: string | null }>(`
    select identity.canonical_entity_id(c.entity_id)::text entity_id, c.value, c.source, d.origin, c.last_verified_at verified_at, u.name verified_by
      from research.claim c left join research.source_doc d on d.doc_id = c.source left join platform.app_user u on u.id = c.last_verified_by
     where identity.canonical_entity_id(c.entity_id) = any($1::uuid[]) and c.superseded_by is null and c.field ~ '(^|\\.)email$'
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
