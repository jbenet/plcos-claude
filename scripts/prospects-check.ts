/**
 * Check prospect files with the importer's own rules before handing them over (27 Sep 2026: runs kept
 * writing rows the importer refused: object `strategic`, empty `sources`, null `capacity`).
 *
 *   DATA_PROFILE=real npx tsx scripts/prospects-check.ts enrich/prospects/2026-09-27-x.jsonl [...]
 *
 * Paths are relative to the real data root's parent folder, or absolute. Prints counts and line
 * numbers with reasons, never row contents. Exits 1 when any row is invalid.
 */
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { config } from '../config/deployment';
import { parseProspectFile } from '../lib/enrich/prospects';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: prospects-check.ts <file.jsonl> [...]'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const path = isAbsolute(f) ? f : join(config.data.root, f.replace(/^data\/real\//, ''));
  const { records, invalid } = parseProspectFile({ file: basename(path), text: readFileSync(path, 'utf8'), inProgress: false } as never);
  bad += invalid.length;
  console.log(`${basename(path)}: ${records.length} valid, ${invalid.length} invalid`);
  for (const x of invalid.slice(0, 20)) console.log(`  line ${x.line}: ${x.reason}`);
}
process.exit(bad ? 1 : 0);
