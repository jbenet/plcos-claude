/**
 * W3 (N64, docs/19): write data/<profile>/enrich/connections.jsonl from the files, and print
 * counts — never names.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-connect.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { findPaths } from '../lib/enrich/connect';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const { paths, lps, researched } = await findPaths(dir);
  await writeFile(join(dir, 'connections.jsonl'), paths.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8');
  const by = (k: (p: (typeof paths)[number]) => string) => paths.reduce<Record<string, number>>((a, p) => ({ ...a, [k(p)]: (a[k(p)] ?? 0) + 1 }), {});
  const lpsWith = (t: string[]) => new Set(paths.filter((p) => t.includes(p.tier)).map((p) => p.lp)).size;
  console.log(`${paths.length} paths for ${new Set(paths.map((p) => p.lp)).size} of ${lps} LPs (${researched} researched)`);
  console.log(`by tier ${JSON.stringify(by((p) => p.tier))} · by kind ${JSON.stringify(by((p) => p.kind))} · by other ${JSON.stringify(by((p) => p.other.type))}`);
  console.log(`LPs with an A or B path: ${lpsWith(['A', 'B'])} · with only C or D: ${lpsWith(['C', 'D']) - new Set(paths.filter((p) => ['A', 'B'].includes(p.tier) && paths.some((q) => q.lp === p.lp && ['C', 'D'].includes(q.tier))).map((p) => p.lp)).size}`);
}
main();
