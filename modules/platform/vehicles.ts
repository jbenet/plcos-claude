import { getDb, type Queryable } from '@/lib/db';
import { can, type Principal } from '@/lib/authz';
import { appendAudit } from './repo';
import { checkNewVehicle, type NewVehicle, type VehicleRowInput } from './client';

/**
 * A vehicle row, written one way whoever writes it: the init file (lib/real/init.ts, loadInit) and
 * Settings → Vehicles (an Admin, on the cloud server, where nobody can edit the init file). Both go
 * through `writeVehicle`, so a vehicle made in the app and one from the file are the same row, and a
 * later init reload that names the slug updates it while one that does not leaves it alone.
 */
export class VehicleRefused extends Error {
  constructor(message: string) { super(message); this.name = 'VehicleRefused'; }
}

/**
 * The one insert both writers use. `onConflict: 'update'` is the init file's upsert by slug; 'refuse'
 * is the app's create, which never changes an existing vehicle and answers null when the slug is taken.
 */
export async function writeVehicle(q: Queryable, v: VehicleRowInput, sortOrder: number, onConflict: 'update' | 'refuse'): Promise<{ id: string } | null> {
  return q.one<{ id: string }>(
    `insert into platform.vehicle (slug, name, kind, exemption, target_amount, sort_order, phase,
                                   raise_opens_on, raise_closes_on, raise_window_note, aliases)
     values ($1,$2,$3::platform.vehicle_kind,$4,$5,$6,$7,$8,$9,$10,$11)
     ${onConflict === 'update' ? `on conflict (slug) do update set name = excluded.name, kind = excluded.kind,
       exemption = excluded.exemption, target_amount = excluded.target_amount,
       sort_order = excluded.sort_order, phase = excluded.phase,
       raise_opens_on = excluded.raise_opens_on, raise_closes_on = excluded.raise_closes_on,
       raise_window_note = excluded.raise_window_note, aliases = excluded.aliases` : 'on conflict (slug) do nothing'}
     returning id::text`,
    [v.slug, v.name, v.kind, v.exemption, v.target, sortOrder, v.phase,
     v.raise.opens, v.raise.closes, v.raise.note, v.aliases],
  );
}

/**
 * Settings → Vehicles: an Admin adds a vehicle. Admin only, checked here as well as by the action's rule;
 * the slug is unique (a taken one is refused, never updated); it sorts after the last vehicle; one
 * audit row (subject_type 'vehicle') says who made it, in the same transaction.
 */
export async function createVehicle(actor: Principal & { id: string }, input: NewVehicle, q?: Queryable): Promise<{ id: string; slug: string; name: string }> {
  if (!can(actor, 'admin')) throw new VehicleRefused('Only an Admin can add a vehicle.');
  const { vehicle, problems } = checkNewVehicle(input);
  if (!vehicle) throw new VehicleRefused(problems.join(' '));
  const work = async (tx: Queryable) => {
    // Serialize creates, so two at once cannot take the same place in the order.
    await tx.query('select pg_advisory_xact_lock(4202611)');
    if (await tx.one('select 1 from platform.vehicle where slug = $1', [vehicle.slug])) throw new VehicleRefused(`A vehicle with the slug "${vehicle.slug}" exists already.`);
    if (await tx.one('select 1 from platform.vehicle where lower(name) = lower($1)', [vehicle.name])) throw new VehicleRefused(`A vehicle named "${vehicle.name}" exists already.`);
    const last = (await tx.one<{ n: number }>('select coalesce(max(sort_order), 0)::int n from platform.vehicle'))!.n;
    const row = await writeVehicle(tx, vehicle, last + 1, 'refuse');
    if (!row) throw new VehicleRefused(`A vehicle with the slug "${vehicle.slug}" exists already.`);
    await appendAudit({ actorId: actor.id, action: 'vehicle.created', subjectType: 'vehicle', subjectId: row.id,
      detail: { slug: vehicle.slug, name: vehicle.name, kind: vehicle.kind, exemption: vehicle.exemption, phase: vehicle.phase,
        target: vehicle.target, raise: { opens: vehicle.raise.opens, closes: vehicle.raise.closes }, aliases: vehicle.aliases.length, sortOrder: last + 1 } }, tx);
    return { id: row.id, slug: vehicle.slug, name: vehicle.name };
  };
  if (q) return work(q);
  return (await getDb()).transaction(work);
}
