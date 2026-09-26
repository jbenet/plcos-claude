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
import { connectionCoverage } from '../lib/enrich/connection-summary';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const { paths, lpKeys, researched } = await findPaths(dir);
  await writeFile(join(dir, 'connections.jsonl'), paths.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8');
  const by = (k: (p: (typeof paths)[number]) => string) => paths.reduce<Record<string, number>>((a, p) => ({ ...a, [k(p)]: (a[k(p)] ?? 0) + 1 }), {});
  const coverage = connectionCoverage(paths, lpKeys);
  console.log(`${paths.length} paths for ${coverage.reached} of ${coverage.total} LPs (${researched} researched); ${coverage.nonLpEndpoints} non-LP endpoints`);
  console.log(`Warehouse paths: ${paths.filter((p) => p.warehouse).length}; LPs reached: ${coverage.warehouseReached}; via intermediaries: ${coverage.viaIntermediaries}`);
  console.log(`by tier ${JSON.stringify(by((p) => p.tier))} · by kind ${JSON.stringify(by((p) => p.kind))} · by other ${JSON.stringify(by((p) => p.other.type))}`);
  console.log(`LPs with an A or B path: ${coverage.warm} · with only C or D: ${coverage.onlyCD}`);
}
main();
