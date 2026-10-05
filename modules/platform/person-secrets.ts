import { getDb, type Queryable } from '@/lib/db';

/**
 * platform.person_secret rows (migration 017). The values arrive sealed by lib/settings/person-secrets.ts;
 * this file never sees a plaintext secret. Every function takes the person's own id: there is no "list
 * everyone's" here, so no page can show or set another person's secret.
 */
export async function readPersonSecret(userId: string, purpose: string, q?: Queryable): Promise<string | null> {
  const db = q ?? await getDb();
  return (await db.one<{ value: string }>(`select value from platform.person_secret where user_id = $1 and purpose = $2`, [userId, purpose]))?.value ?? null;
}

export async function writePersonSecret(userId: string, purpose: string, sealed: string, q?: Queryable): Promise<void> {
  const db = q ?? await getDb();
  await db.query(`insert into platform.person_secret (user_id, purpose, value) values ($1, $2, $3)
    on conflict (user_id, purpose) do update set value = excluded.value, updated_at = now()`, [userId, purpose, sealed]);
}

export async function deletePersonSecret(userId: string, purpose: string, q?: Queryable): Promise<boolean> {
  const db = q ?? await getDb();
  return (await db.query(`delete from platform.person_secret where user_id = $1 and purpose = $2 returning purpose`, [userId, purpose])).length > 0;
}
