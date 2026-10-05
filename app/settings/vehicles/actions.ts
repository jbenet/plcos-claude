'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * Settings → Vehicles: an Admin adds a vehicle (5 Oct 2026: on the cloud server the init file sits on a
 * volume nobody edits). Admin only, a refusal audit-logged (lib/authz/server.ts); the rules — a unique,
 * url-safe slug, an exemption that is chosen, never defaulted — are checked in modules/platform/vehicles.ts,
 * inside the transaction that writes the row and its audit entry.
 */
export type VehicleResult = { ok: true; message: string; slug: string } | { ok: false; error: string } | null;

export async function createVehicleAction(_prev: VehicleResult, formData: FormData): Promise<VehicleResult> {
  const user = await requireAction('app/settings/vehicles/actions.ts#createVehicleAction', _prev, formData);
  const { vehiclesWritable } = await import('./writable');
  const refusal = vehiclesWritable();
  if (refusal) return { ok: false, error: refusal };
  const { createVehicle, VehicleRefused } = await import('@/modules/platform');
  const field = (k: string) => String(formData.get(k) ?? '');
  try {
    const v = await createVehicle(user, {
      name: field('name'), slug: field('slug'), kind: field('kind'), exemption: field('exemption'), phase: field('phase'),
      target: field('target'), opens: field('opens'), closes: field('closes'), aliases: field('aliases'),
    });
    // The rail, the vehicle pickers and every list of vehicles read the table live per request; the
    // page caches key on network.read_revision, which a write to platform.vehicle advances. This drops
    // Next's rendered copies too, as an init reload does.
    revalidatePath('/', 'layout');
    return { ok: true, message: `${v.name} is added. It is in the rail now, at /${v.slug}/overview.`, slug: v.slug };
  } catch (e) {
    if (e instanceof VehicleRefused) return { ok: false, error: e.message };
    throw e;
  }
}
