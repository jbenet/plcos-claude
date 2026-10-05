import { getDb, type Queryable } from '@/lib/db';

/**
 * A person's addresses (migration 019; Juan, 5 Oct 2026): one login (the Google sign-in), one default-to (the one
 * we email them at, mirrored in app_user.email), and aliases. Sign-in and mail matching accept any of them. An
 * address belongs to one person, whatever its kind; a login that is also the default-to is one row, kind
 * 'default'.
 */
export type AddressKind = 'login' | 'default' | 'alias';
export interface UserAddress { address: string; kind: AddressKind }
export interface AddressSet { login: string | null; default: string | null; aliases: string[] }

export class AddressClash extends Error {
  constructor(readonly address: string, readonly ownerHandle: string | null) {
    super(`${address} already belongs to ${ownerHandle ? `another person (${ownerHandle})` : 'another person'}.`);
    this.name = 'AddressClash';
  }
}
export class AddressInvalid extends Error {
  constructor(message: string) { super(message); this.name = 'AddressInvalid'; }
}

const ADDRESS = /^[^\s@<>()",;:\\[\]]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** One person's set, checked and normalized (trimmed, lower-cased); duplicates within it collapse. */
export function normalizeAddressSet(set: AddressSet): AddressSet {
  const norm = (a: string | null | undefined) => {
    const v = (a ?? '').trim().toLowerCase();
    if (!v) return null;
    if (!ADDRESS.test(v) || v.length > 254) throw new AddressInvalid(`${v} is not an email address.`);
    return v;
  };
  const def = norm(set.default);
  let login = norm(set.login);
  // A login that is the default-to is the default row: one address, one row.
  if (login && login === def) login = null;
  const aliases = [...new Set(set.aliases.map(norm).filter((a): a is string => !!a))].filter((a) => a !== def && a !== login);
  return { login, default: def, aliases };
}

const rowsOf = (s: AddressSet): UserAddress[] => [
  ...(s.default ? [{ address: s.default, kind: 'default' as const }] : []),
  ...(s.login ? [{ address: s.login, kind: 'login' as const }] : []),
  ...s.aliases.map((address) => ({ address, kind: 'alias' as const })),
];

export async function addressesOf(userId: string, q?: Queryable): Promise<UserAddress[]> {
  const db = q ?? await getDb();
  return db.query<UserAddress>(`select address, kind from platform.user_address where user_id = $1
    order by case kind when 'login' then 0 when 'default' then 1 else 2 end, lower(address)`, [userId]);
}

/** Every person's addresses, for a page. */
export async function allAddresses(q?: Queryable): Promise<Map<string, UserAddress[]>> {
  const db = q ?? await getDb();
  const rows = await db.query<UserAddress & { user_id: string }>(`select user_id::text, address, kind from platform.user_address
    order by case kind when 'login' then 0 when 'default' then 1 else 2 end, lower(address)`);
  const out = new Map<string, UserAddress[]>();
  for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { address: r.address, kind: r.kind }]);
  return out;
}

/** Addresses in `set` that someone else holds: [address, their handle]. */
export async function addressClashes(q: Queryable, userId: string | null, addresses: string[]): Promise<Array<{ address: string; handle: string }>> {
  if (!addresses.length) return [];
  return q.query(`select a.address, u.handle from platform.user_address a join platform.app_user u on u.id = a.user_id
    where lower(a.address) = any($1::text[]) and ($2::uuid is null or a.user_id <> $2::uuid)`, [addresses.map((a) => a.toLowerCase()), userId]);
}

/**
 * Make a person's addresses exactly `set`. An address that belongs to someone else is refused, never moved.
 * Run inside the caller's transaction; the triggers keep app_user.email equal to the default.
 */
export async function setAddresses(tx: Queryable, userId: string, raw: AddressSet): Promise<AddressSet> {
  const set = normalizeAddressSet(raw);
  const rows = rowsOf(set);
  const clash = (await addressClashes(tx, userId, rows.map((r) => r.address)))[0];
  if (clash) throw new AddressClash(clash.address, clash.handle);
  await tx.query(`delete from platform.user_address where user_id = $1`, [userId]);
  for (const r of rows) await tx.query(`insert into platform.user_address (user_id, address, kind) values ($1, $2, $3)`, [userId, r.address, r.kind]);
  if (!set.default) await tx.query(`update platform.app_user set email = '' where id = $1 and email <> ''`, [userId]);
  return set;
}

/** The person (any, active or not) who holds an address, ignoring case. */
export async function ownerOfAddress(address: string, q?: Queryable): Promise<{ id: string; handle: string; active: boolean } | null> {
  const db = q ?? await getDb();
  return db.one(`select u.id::text, u.handle, u.active from platform.user_address a join platform.app_user u on u.id = a.user_id
    where lower(a.address) = lower($1)`, [address.trim()]);
}
