import { cookies } from 'next/headers';
import { listVehicles, type Vehicle } from '@/modules/platform';

export const VEHICLE_COOKIE = 'capitalos_vehicle';

export interface VehicleSelection {
  /** null means "all vehicles" — a real choice, not an absence. */
  current: Vehicle | null;
  all: Vehicle[];
}

export async function vehicleSelection(): Promise<VehicleSelection> {
  const all = await listVehicles();
  const slug = (await cookies()).get(VEHICLE_COOKIE)?.value;
  if (!slug || slug === 'all') return { current: null, all };
  return { current: all.find((v) => v.slug === slug) ?? null, all };
}
