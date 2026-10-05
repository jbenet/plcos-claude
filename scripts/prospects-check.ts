/**
 * Check prospect files with the importer's own rules before handing them over (27 Sep 2026: runs kept
 * writing rows the importer refused: object `strategic`, empty `sources`, null `capacity`).
 *
 *   DATA_PROFILE=real npx tsx scripts/prospects-check.ts [--vehicle <slug>]... enrich/prospects/2026-09-27-x.jsonl [...]
 *
 * Paths are relative to the real data root's parent folder, or absolute. Prints counts and line
 * numbers with reasons, never row contents. Exits 1 when any row is invalid.
 *
 * Each row's `vehicle` must be a slug this Mac knows: the vehicles in the last research export
 * (enrich/vehicles.json, written from the database) and in the init file. No database is opened. A vehicle
 * just added on the cloud server (Settings → Vehicles) is not here yet: `--vehicle <slug>`, repeatable,
 * treats that slug as known, and the run says so. The cloud server checks every slug again on a push
 * (scripts/cloud-push.sh prospects <file>), against its own vehicles.
 */
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { config } from '../config/deployment';
import { prospectFileProblems } from '../lib/enrich/prospect-rows';
import { parseJsonc } from '../lib/jsonc';

function knownSlugs(): { slugs: Set<string>; from: string[] } {
  const slugs = new Set<string>(), from: string[] = [];
  try {
    const exported = JSON.parse(readFileSync(join(config.data.root, 'enrich', 'vehicles.json'), 'utf8')) as Array<{ slug?: unknown }>;
    for (const v of exported) if (typeof v?.slug === 'string') slugs.add(v.slug);
    from.push('enrich/vehicles.json');
  } catch { /* no research export here yet */ }
  try {
    // The init file's vehicles: the slugs only, parsed as the init loader parses it.
    const init = parseJsonc(readFileSync(join(config.data.root, 'init.jsonc'), 'utf8')) as { vehicles?: Array<{ slug?: unknown }> };
    for (const v of init.vehicles ?? []) if (typeof v?.slug === 'string') slugs.add(v.slug);
    if (init.vehicles?.length) from.push('init.jsonc');
  } catch { /* no init file in this profile */ }
  return { slugs, from };
}

const args = process.argv.slice(2), files: string[] = [], flagged: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vehicle') {
    const slug = args[++i] ?? '';
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(slug)) { console.error(`--vehicle needs a slug (lowercase letters, digits, dashes); got "${slug}"`); process.exit(2); }
    flagged.push(slug);
  } else if (args[i]!.startsWith('--')) { console.error(`unknown option ${args[i]}`); process.exit(2); }
  else files.push(args[i]!);
}
if (!files.length) { console.error('usage: prospects-check.ts [--vehicle <slug>]... <file.jsonl> [...]'); process.exit(2); }

const { slugs, from } = knownSlugs();
const known = from.length || flagged.length ? new Set([...slugs, ...flagged]) : null;
if (flagged.length) console.log(`note: treating ${flagged.map((s) => `"${s}"`).join(', ')} as known vehicle${flagged.length === 1 ? '' : 's'} (--vehicle)${flagged.some((s) => slugs.has(s)) ? '' : '; not in this Mac\'s records yet'}. The cloud server checks ${flagged.length === 1 ? 'it' : 'them'} again when you push.`);
if (!known) console.log('note: vehicle slugs not checked here: no research export (enrich/vehicles.json) or init file to check them against, and no --vehicle. The cloud server checks them on a push.');
let bad = 0;
for (const f of files) {
  const path = isAbsolute(f) ? f : join(config.data.root, f.replace(/^data\/real\//, ''));
  const { rows, problems } = prospectFileProblems(basename(path), readFileSync(path, 'utf8'), known);
  const lines = new Set(problems.map((p) => p.line)).size;
  bad += problems.length;
  console.log(`${basename(path)}: ${rows - problems.filter((p) => p.vehicle !== undefined).length} valid, ${lines} invalid`);
  for (const x of problems.slice(0, 20)) console.log(`  line ${x.line}: ${x.reason}`);
}
process.exit(bad ? 1 : 0);
