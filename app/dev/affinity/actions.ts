'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { testConnection } from '@/lib/connectors/affinity';

/** Two GET requests. The page re-renders with what Affinity said, or why it could not ask. */
export async function runConnectionTest(): Promise<void> {
  const user = await (await auth()).currentUser();
  await testConnection(user.id);
  revalidatePath('/dev/affinity');
  revalidatePath('/dev/connectors');
}

/** One request per list, plus a few: lists, their fields, the account's users. No entries. */
export async function runDiscovery(): Promise<void> {
  const { discoverLists } = await import('@/lib/connectors/affinity/discover');
  const user = await (await auth()).currentUser();
  await discoverLists(user.id);
  revalidatePath('/dev/affinity');
  revalidatePath('/dev/affinity/lists');
}

/** Starts the first slice in this server's process and returns at once; the page watches it. */
export async function runSliceAction(formData: FormData): Promise<void> {
  const { startSlice } = await import('@/lib/connectors/affinity/slice');
  const user = await (await auth()).currentUser();
  // A go-ahead on a held run carries the estimate it was shown, and the run proceeds only
  // within that estimate plus a quarter — an approval of a number, not of whatever it costs.
  const approved = Number(formData.get('approvedEstimate') ?? 0);
  const skipRelationships = formData.get('scope') === 'notes';
  startSlice(user.id, {
    ...(approved > 0 ? { approvedUpTo: Math.ceil(approved * 1.25) } : {}),
    skipRelationships,
  });
  revalidatePath('/dev/affinity/slice');
}

/** Writes the inventory to data/<profile>/reports/ — aggregates only, like the page. */
export async function writeInventoryReport(): Promise<void> {
  const { inventory, writeReport } = await import('@/lib/connectors/affinity/inventory');
  await writeReport(await inventory());
  revalidatePath('/dev/affinity/inventory');
}

/**
 * Writes data/<profile>/mapping.jsonc — proposed where it is new, kept where a person edited it.
 * The first list the init file names for a vehicle is its pipeline; any other is history.
 */
export async function writeMappingAction(): Promise<void> {
  const { inventory } = await import('@/lib/connectors/affinity/inventory');
  const { writeMapping } = await import('@/lib/connectors/affinity/mapping');
  const { sliceTargets } = await import('@/lib/connectors/affinity/slice');
  const targets = await sliceTargets();
  const firstOf = new Map<string, number>();
  for (const t of targets) if (t.vehicleSlug && !firstOf.has(t.vehicleSlug)) firstOf.set(t.vehicleSlug, t.list.id);
  const roles = Object.fromEntries(targets.map((t) => [t.list.id, t.vehicleSlug && firstOf.get(t.vehicleSlug) !== t.list.id ? 'history' : 'pipeline'])) as Record<number, 'pipeline' | 'history'>;
  await writeMapping(await inventory(), roles);
  revalidatePath('/dev/affinity/mapping');
  revalidatePath('/dev/affinity/inventory');
}

/** Compares each vehicle's older lists with the one in use, and writes the names to a report. */
export async function writeComparisonAction(): Promise<void> {
  const { compareLists, writeComparison } = await import('@/lib/connectors/affinity/compare');
  await writeComparison(await compareLists());
  revalidatePath('/dev/affinity/inventory');
}
