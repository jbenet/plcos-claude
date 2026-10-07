import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readStrategyFiles } from './strategy-files';

export type CheckVehicle = { slug: string; name: string; kind?: string };
/** File-only checker uses the vehicle catalog exported from the database. */
export async function checkedStrategyFiles(dir: string, vehicles: CheckVehicle[], refuse: (file: string, problems: string[]) => void) {
  const known = new Set(vehicles.map(v => v.slug));
  for (const entry of await readdir(join(dir, 'strategy'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !known.has(entry.name)) refuse(entry.name, ['unknown vehicle folder; use a known vehicle slug']);
  }
  const records = await readStrategyFiles(dir, refuse);
  const scoped = records.flatMap(r => {
    if (r.folder && !known.has(r.folder)) return [];
    if (r.folder && r.folder !== r.s.ask.vehicle) { refuse(r.file, ['vehicle folder must equal ask.vehicle']); return []; }
    const named = r.s.ask.vehicle.trim().toLowerCase();
    const matches = vehicles.filter(v => [v.slug.toLowerCase(), v.name.toLowerCase()].includes(named));
    if (matches.length !== 1) { refuse(r.file, ['ask.vehicle must identify exactly one known vehicle']); return []; }
    return [{ ...r, vehicle: matches[0]!.slug }];
  });
  const pairs = new Map<string, typeof scoped>();
  for (const r of scoped) {
    const key = JSON.stringify([r.s.key, r.vehicle]);
    pairs.set(key, [...(pairs.get(key) ?? []), r]);
  }
  for (const group of pairs.values()) if (group.length > 1) for (const r of group) refuse(r.file, ['multiple files for the same LP and vehicle']);
  return scoped;
}

// Common prose labels that can also be records. Keep this short and explicit.
const STOP_NAMES = new Set(['family office', 'private equity', 'venture capital', 'limited partner', 'general partner']);
export function nameMention(text: string, name: string): number {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || STOP_NAMES.has(words.join(' ').toLowerCase())) return -1;
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return text.search(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu'));
}
