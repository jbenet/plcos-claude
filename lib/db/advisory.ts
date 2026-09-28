import { Client } from 'pg';

/** Session lock uses its own connection: a pool query cannot own a lock safely.
 * PostgreSQL releases it even if the worker is killed. Never print the URL. */
export async function withImportLock<T>(url: string, kind: string, work: () => Promise<T>, onLockLost?: () => void): Promise<{ acquired: false } | { acquired: true; value: T }> {
  // Pull and rebuild own the same replica and must never run concurrently.
  if (kind === 'linear-rebuild') kind = 'linear';
  const client = new Client({ connectionString: url, application_name: 'plcos-import-lock', connectionTimeoutMillis: 5000 });
  let lost=false;
  client.on('error',()=>{lost=true;onLockLost?.();});
  await client.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(173542,hashtext($1)) acquired', [kind]);
    if (!lock.rows[0].acquired) return { acquired: false };
    try {
      const value=await work();
      if(lost)throw new Error('Import lock connection was lost.');
      return { acquired: true, value };
    }
    finally { await client.query('select pg_advisory_unlock(173542,hashtext($1))', [kind]); }
  } finally { await client.end(); }
}
