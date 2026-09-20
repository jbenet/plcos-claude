import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';

const fixture = async <T>(name: string): Promise<T[]> =>
  JSON.parse(await readFile(join(process.cwd(), 'fixtures', name), 'utf8')) as T[];

/**
 * Enough for every screen to have something in it. Deliberately fictional: real names and
 * amounts should not reach a shared repo (docs/12, "Seeds").
 */
export async function seed(db: Db): Promise<{ users: number; vehicles: number; sources: number }> {
  const users = await fixture<{ handle: string; name: string; initials: string; role: string; email: string }>('users.json');
  const vehicles = await fixture<{ slug: string; name: string; kind: string; exemption: string; target_amount: number | null; sort_order: number }>('vehicles.json');
  const sources = await fixture<{ source: string; label: string; status: string; detail: string }>('sources.json');

  await db.transaction(async (tx) => {
    for (const u of users) {
      await tx.query(
        `insert into platform.app_user (handle, name, initials, role, email)
         values ($1,$2,$3,$4,$5) on conflict (handle) do nothing`,
        [u.handle, u.name, u.initials, u.role, u.email],
      );
    }
    for (const v of vehicles) {
      await tx.query(
        `insert into platform.vehicle (slug, name, kind, exemption, target_amount, sort_order)
         values ($1,$2,$3::platform.vehicle_kind,$4,$5,$6) on conflict (slug) do nothing`,
        [v.slug, v.name, v.kind, v.exemption, v.target_amount, v.sort_order],
      );
    }
    for (const s of sources) {
      await tx.query(
        `insert into platform.source_sync (source, label, status, last_sync_at, detail)
         values ($1,$2,$3::platform.sync_status,$4,$5)
         on conflict (source) do update set status = excluded.status, last_sync_at = excluded.last_sync_at, detail = excluded.detail`,
        [s.source, s.label, s.status, s.status === 'ok' ? new Date() : null, s.detail],
      );
    }
    await tx.query(
      `insert into platform.audit_log (action, subject_type, detail)
       values ('seed.loaded', 'database', $1)`,
      [JSON.stringify({ users: users.length, vehicles: vehicles.length, sources: sources.length })],
    );
  });

  return { users: users.length, vehicles: vehicles.length, sources: sources.length };
}

/** Called on boot so `npm run dev` on a fresh clone lands on a populated screen. */
export async function seedIfEmpty(db: Db): Promise<void> {
  const row = await db.one<{ n: string }>('select count(*)::text as n from platform.app_user');
  if (row && Number(row.n) > 0) return;
  await seed(db);
}
