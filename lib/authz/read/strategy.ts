import { currentUser } from '@/lib/auth';
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
