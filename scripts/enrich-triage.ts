/**
 * W9 (N64, docs/19): write data/<profile>/enrich/triage.jsonl and print counts — never names.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-triage.ts
 */
import { join } from 'node:path';
import { config } from '../config/deployment';
import { refreshTriageExport } from '../lib/enrich/triage-export';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const t = await refreshTriageExport(dir);
  const by = t.reduce<Record<string, number>>((m, x) => ({ ...m, [x.lane]: (m[x.lane] ?? 0) + 1 }), {});
  console.log(`${t.length} triaged · ${JSON.stringify(by)} · senior ${t.filter((x) => x.senior).length} · already researched ${t.filter((x) => x.researched).length}`);
}
main();
