import { currentUser } from '@/lib/auth';
import { buildCache, liveRevisions } from '@/lib/build-cache';
import { getDb } from '@/lib/db';
import * as raw from '@/modules/strategy';
import { licensedAccess, redactSpv, spvRowMark } from './r3';
export * from '@/modules/strategy';
export async function vehicleStrategy(...args: Parameters<typeof raw.vehicleStrategy>) {
  // Without an explicit `now`, the cached build the list shares (modules/strategy/vehicle.ts).
  const [user, data] = await Promise.all([currentUser(), args.length === 1 || args[1] === undefined ? raw.strategyOf(args[0]) : raw.vehicleStrategy(...args)]);
  if (!data || licensedAccess(user)) return data;
  return { ...data, rows: data.rows.map(row => row.usingDakota
    ? { ...row, pursuit: pursuitForDisplay(user, row.pursuit), capacity: null, capacityBand: undefined, capacityBasis: 'Licensed capacity restricted.', score: null }
    : { ...row, pursuit: pursuitForDisplay(user, row.pursuit) }) };
}
export async function spvReadings(...args: Parameters<typeof raw.spvReadings>) {
  const [user, rows] = await Promise.all([currentUser(), raw.spvReadings(...args)]);
  return new Map([...rows].map(([id, row]) => [id, redactSpv(user, row)]));
}
export async function spvMarks(...args: Parameters<typeof raw.spvMarks>) {
  const rows = await spvReadings(...args);
  return new Map([...rows].map(([id, row]) => [id, spvRowMark(row)]));
}
/**
 * Every LP's SPV reading on a vehicle's plan, kept per data revision (16 Oct 2026): the strategy page read 4,000 of
 * them on each visit, 18 ms of SQL before it could draw. Redacted per viewer below, after the shared cache. Keyed on
 * the live revision: the readings join research.claim, which moves it and not the read one (network 024).
 */
const planSpv = buildCache(async (vehicleId: string) => {
  const data = await raw.strategyOf(vehicleId);
  return data ? raw.spvReadings(await getDb(), data.rows.map((r) => r.pursuit.entityId)) : new Map<string, raw.SpvReading>();
}, 16, liveRevisions);
/** spvMarks for the LPs of strategyOf(vehicleId), from the cache above. */
export async function planSpvMarks(vehicleId: string) {
  const [user, rows] = await Promise.all([currentUser(), planSpv(vehicleId)]);
  return new Map([...rows].map(([id, row]) => [id, spvRowMark(redactSpv(user, row))]));
}
export async function lpContactsFor(...args: Parameters<typeof raw.lpContactsFor>) {
  const user = await currentUser();
  return raw.lpContactsFor(args[0], args[1], { ...args[2], excludeDakota: !licensedAccess(user) || args[2]?.excludeDakota });
}

function pursuitForDisplay<T extends raw.Pursuit | null>(user: Awaited<ReturnType<typeof currentUser>>, row: T): T {
  if (!row || licensedAccess(user) || row.source !== 'dakota') return row;
  return { ...row, statusReason: null, headline: null, plan: [] };
}
export async function getPursuit(...args: Parameters<typeof raw.getPursuit>) {
  return pursuitForDisplay(await currentUser(), await raw.getPursuit(...args));
}
export async function listPursuits(...args: Parameters<typeof raw.listPursuits>) {
  const user = await currentUser();
  return (await raw.listPursuits(...args)).map(row => pursuitForDisplay(user, row));
}
export async function pursuitFor(...args: Parameters<typeof raw.pursuitFor>) {
  return pursuitForDisplay(await currentUser(), await raw.pursuitFor(...args));
}
