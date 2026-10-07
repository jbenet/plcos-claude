/**
 * Re-pin a strategy to a newer finding that adds nothing it hasn't read (7 Oct 2026: 203 strategies were stale on thin
 * refreshes of findings they had read). Each line of the list is a strategy file (relative to enrich/strategy), its
 * LP's current finding and the finding it was written from (relative to enrich/raw, or absolute), separated by tabs.
 * A strategy is re-pinned only when `repinBlockers` finds nothing: no new fact, investor type or capacity band, and no
 * correction since it was written. `made.inputs.finding` takes the newer finding's date and `made.revised` says so;
 * `made.at` stays. Anything else is listed with its reason, for a rewrite.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-repin.ts <list> [--vehicles <vehicles.json>] [--dry]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { config } from '../config/deployment';
import { repinBlockers, type Strategy } from '../lib/enrich/strategy';

async function main() {
  const args = process.argv.slice(2);
  const list = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--vehicles');
  if (!list) { console.error('usage: enrich-repin.ts <list> [--vehicles <vehicles.json>] [--dry]'); process.exit(2); }
  const dry = args.includes('--dry');
  const enrich = join(process.cwd(), config.data.root, 'enrich');
  const vehiclesFile = args.includes('--vehicles') ? args[args.indexOf('--vehicles') + 1]! : join(enrich, 'vehicles.json');
  const kinds = new Map<string, string | null>();
  try { for (const v of JSON.parse(await readFile(vehiclesFile, 'utf8')) as Array<{ slug: string; name?: string; kind?: string | null }>) { kinds.set(v.slug.toLowerCase(), v.kind ?? null); if (v.name) kinds.set(v.name.toLowerCase(), v.kind ?? null); } }
  catch { /* unknown kinds count an SPV-only correction, as isStale does */ }
  const raw = (p: string) => (isAbsolute(p) ? p : join(enrich, 'raw', p));
  const now = new Date().toISOString();
  let repinned = 0;
  const held: Record<string, number> = {};
  for (const line of (await readFile(list, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [file, newerFile, pinnedFile] = line.split('\t');
    if (!file || !newerFile || !pinnedFile) { console.log(`  skipped: a line needs three tab-separated paths (${line.slice(0, 60)})`); continue; }
    const path = join(enrich, 'strategy', file);
    const s = JSON.parse(await readFile(path, 'utf8')) as Strategy;
    const newer = JSON.parse(await readFile(raw(newerFile), 'utf8'));
    const pinned = JSON.parse(await readFile(raw(pinnedFile), 'utf8'));
    const blockers = repinBlockers(s, pinned, newer, kinds.get(s.ask?.vehicle?.toLowerCase() ?? '') ?? null);
    if (blockers.length) { for (const b of blockers.map((x) => x.replace(/^\d+ new facts?$/, 'new facts'))) held[b] = (held[b] ?? 0) + 1; console.log(`  held ${file}: ${blockers.join('; ')}`); continue; }
    s.made.inputs = { ...(s.made.inputs ?? { finding: null }), finding: newer.researched.at };
    s.made.revised = [...(Array.isArray(s.made.revised) ? s.made.revised : s.made.revised ? [s.made.revised] : []), { at: now, by: 'rule (scripts/enrich-repin.ts)',
      rule: `Re-pinned to the finding of ${String(newer.researched.at).slice(0, 10)}: it adds no fact, investor type or capacity band to the one this was written from (${String(pinned.researched?.at ?? '').slice(0, 10)}), and no correction since.` }];
    if (!dry) await writeFile(path, JSON.stringify(s, null, 2));
    repinned++;
  }
  console.log(`repin: ${repinned} re-pinned${dry ? ' (dry run, nothing written)' : ''} · held ${JSON.stringify(held)}`);
}

main();
