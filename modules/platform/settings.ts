import { getDb, type Queryable } from '@/lib/db';
import type { AppUser } from './types';

/**
 * platform.setting and the sign-in lookups (docs/deploy/railway.md §3, migration 015). The values here are
 * already sealed by lib/settings: this file stores and reads rows, and never sees a plaintext secret.
 */
export interface SettingRow { key: string; value: string; secret: boolean; updatedAt: string; updatedBy: string | null }

export async function readSettingRows(q?: Queryable): Promise<SettingRow[]> {
  const db = q ?? await getDb();
  return db.query<SettingRow>(`select key, value, secret, updated_at::text "updatedAt", updated_by::text "updatedBy"
    from platform.setting order by key`);
}

export async function upsertSettingRow(q: Queryable, key: string, value: string, secret: boolean, by: string | null): Promise<void> {
  await q.query(`insert into platform.setting (key, value, secret, updated_at, updated_by) values ($1, $2, $3, now(), $4)
    on conflict (key) do update set value = excluded.value, secret = excluded.secret, updated_at = now(), updated_by = excluded.updated_by`,
  [key, value, secret, by]);
}

export async function deleteSettingRow(q: Queryable, key: string): Promise<boolean> {
  return (await q.query('delete from platform.setting where key = $1 returning key', [key])).length > 0;
}

const USER_COLUMNS = 'id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves';

/**
 * The active people whose email is this address, ignoring case. More than one is ambiguous, and the
 * caller refuses the sign-in rather than guess.
 */
export async function activeUsersByEmail(email: string, q?: Queryable): Promise<Array<AppUser & { sessionEpoch: number }>> {
  const db = q ?? await getDb();
  return db.query(`select ${USER_COLUMNS}, session_epoch "sessionEpoch" from platform.app_user
    where active and email <> '' and lower(email) = lower($1)`, [email.trim()]);
}

/** The person a session names, if they are still active, with their current epoch. */
export async function sessionUser(id: string, q?: Queryable): Promise<(AppUser & { sessionEpoch: number }) | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const db = q ?? await getDb();
  return db.one(`select ${USER_COLUMNS}, session_epoch "sessionEpoch" from platform.app_user where id = $1 and active`, [id]);
}

/** Sign a person out everywhere: every cookie carrying the old epoch stops working. */
export async function raiseSessionEpoch(id: string, q?: Queryable): Promise<number | null> {
  const db = q ?? await getDb();
  const row = await db.one<{ epoch: number }>(`update platform.app_user set session_epoch = session_epoch + 1
    where id = $1 returning session_epoch epoch`, [id]);
  return row?.epoch ?? null;
}

/** How many active admins there are: /setup needs one, and the last one cannot be removed by accident. */
export async function activeAdminCount(q?: Queryable): Promise<number> {
  const db = q ?? await getDb();
  const row = await db.one<{ n: number }>(`select count(*)::int n from platform.app_user where active and access = 'admin' and email <> ''`);
  return row?.n ?? 0;
}

/**
 * The first admin, from /setup: an existing active person with this email becomes an admin; otherwise a
 * new one is added with all vehicles. Returns who, and whether they were new. Run inside the setup
 * transaction, after every value has been checked.
 */
export async function ensureAdmin(q: Queryable, email: string): Promise<{ user: AppUser; created: boolean }> {
  const address = email.trim().toLowerCase();
  const existing = await q.query<AppUser>(`select ${USER_COLUMNS} from platform.app_user where active and lower(email) = $1`, [address]);
  if (existing.length > 1) throw new Error(`More than one active person has the address ${address}. Make it unique first.`);
  if (existing.length === 1) {
    const user = (await q.one<AppUser>(`update platform.app_user set access = 'admin', vehicles = null where id = $1 returning ${USER_COLUMNS}`, [existing[0]!.id]))!;
    return { user, created: false };
  }
  const local = address.split('@')[0]!.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'admin';
  const taken = new Set((await q.query<{ handle: string }>(`select handle from platform.app_user where handle = $1 or handle like $1 || '-%'`, [local])).map((r) => r.handle));
  let handle = local;
  for (let i = 2; taken.has(handle); i++) handle = `${local}-${i}`;
  const words = local.split('-').filter(Boolean);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') || 'Admin';
  const initials = (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
  const user = (await q.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ($1, $2, $3, 'Admin', $4, 'admin', null) returning ${USER_COLUMNS}`, [handle, name, initials, address]))!;
  return { user, created: true };
}
