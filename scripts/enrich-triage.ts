/**
 * W9 (N64, docs/19): write data/<profile>/enrich/triage.jsonl and print counts — never names.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-triage.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { triage } from '../lib/enrich/triage';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const t = await triage(dir);
  await writeFile(join(dir, 'triage.jsonl'), t.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  const by = t.reduce<Record<string, number>>((m, x) => ({ ...m, [x.lane]: (m[x.lane] ?? 0) + 1 }), {});
  console.log(`${t.length} triaged · ${JSON.stringify(by)} · senior ${t.filter((x) => x.senior).length} · already researched ${t.filter((x) => x.researched).length}`);
  const reasons = t.flatMap((x) => x.reasons.map((r) => r.split(':')[0]!));
  const rc = reasons.reduce<Record<string, number>>((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {});
  console.log(Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v} × ${k}`).join('\n'));
}
main();
