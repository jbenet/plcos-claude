import { getDb, type Queryable } from '@/lib/db';
import { can, type Principal } from '@/lib/authz';
import { appendAudit } from './repo';
import { checkNewVehicle, checkRaiseWindow, type NewVehicle, type VehicleRowInput } from './client';

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
 * A raise window an Admin set in the app (setRaiseWindow, audit action `vehicle.raise_window`) is the app's from
 * then on: the init file and the Affinity translation, which both rewrite the window from the file, leave it
 * alone. On the cloud server nobody edits the init file, so the app is the only place the date can move.
 */
export const RAISE_SET_IN_APP = `exists (select 1 from platform.audit_log a where a.action = 'vehicle.raise_window'
  and a.subject_type = 'vehicle' and a.subject_id = platform.vehicle.id::text)`;

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
       raise_opens_on = case when ${RAISE_SET_IN_APP} then platform.vehicle.raise_opens_on else excluded.raise_opens_on end,
       raise_closes_on = case when ${RAISE_SET_IN_APP} then platform.vehicle.raise_closes_on else excluded.raise_closes_on end,
       raise_window_note = case when ${RAISE_SET_IN_APP} then platform.vehicle.raise_window_note else excluded.raise_window_note end,
       aliases = excluded.aliases` : 'on conflict (slug) do nothing'}
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

/**
 * An Admin moves an existing vehicle's raise window (opens, closes, note) — Juan, 8 Oct 2026: "move date to
 * Oct 9" for an SPV whose close was in the init file, which nobody edits on the cloud server. Admin only; only
 * the window changes, never the slug, kind, exemption or target; one `vehicle.raise_window` audit row with the
 * window before and after, which also marks the window as the app's (RAISE_SET_IN_APP).
 */
export async function setRaiseWindow(actor: Principal & { id: string }, slug: string,
  input: { opens?: string | null; closes?: string | null; note?: string | null }, q?: Queryable):
  Promise<{ slug: string; name: string; opens: string | null; closes: string | null; note: string | null }> {
  if (!can(actor, 'admin')) throw new VehicleRefused('Only an Admin can change a raise window.');
  const { window, problems } = checkRaiseWindow(input);
  if (!window) throw new VehicleRefused(problems.join(' '));
  const work = async (tx: Queryable) => {
    const before = await tx.one<{ id: string; name: string; opens: string | null; closes: string | null; note: string | null }>(
      `select id::text, name, raise_opens_on::text opens, raise_closes_on::text closes, raise_window_note note
         from platform.vehicle where slug = $1 for update`, [slug]);
    if (!before) throw new VehicleRefused(`No vehicle has the slug "${slug}".`);
    await tx.query('update platform.vehicle set raise_opens_on = $2, raise_closes_on = $3, raise_window_note = $4 where id = $1',
      [before.id, window.opens, window.closes, window.note]);
    await appendAudit({ actorId: actor.id, action: 'vehicle.raise_window', subjectType: 'vehicle', subjectId: before.id,
      detail: { slug, before: { opens: before.opens, closes: before.closes, note: before.note }, after: window } }, tx);
    return { slug, name: before.name, ...window };
  };
  if (q) return work(q);
  return (await getDb()).transaction(work);
}
