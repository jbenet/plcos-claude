/**
 * Write the fictional enrichment fixtures (fixtures/enrich/demo.json) under data/demo/enrich/,
 * keyed by the demo database's own entity ids, found by name in the exported research set (N64).
 * Refuses the real profile: it writes files the import would map in.
 *
 *   npx tsx scripts/enrich-demo.ts        (after exporting the demo research set)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';

async function main() {
  if (config.data.profile !== 'demo') { console.error('Refusing: the enrichment fixtures are for the demo profile only.'); process.exit(1); }
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const set = (await readFile(join(dir, 'research-set.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { key: string; name: string });
  if (!set.length) { console.error('No research set yet: export it from /dev/enrich on the demo server first.'); process.exit(1); }
  const keyOf = new Map(set.map((c) => [c.name, c.key]));
  const fx = JSON.parse(await readFile(join(process.cwd(), 'fixtures', 'enrich', 'demo.json'), 'utf8')) as {
    findings: Array<{ name: string }>; strategies: Array<{ name: string }>; network: unknown;
  };
  for (const d of ['raw', 'strategy', 'us']) await mkdir(join(dir, d), { recursive: true });
  let f = 0, s = 0;
  for (const x of fx.findings) { const k = keyOf.get(x.name); if (k) { await writeFile(join(dir, 'raw', `${k}.json`), JSON.stringify({ key: k, ...x }, null, 1)); f++; } }
  for (const x of fx.strategies) { const k = keyOf.get(x.name); if (k) { await writeFile(join(dir, 'strategy', `${k}.json`), JSON.stringify({ key: k, ...x }, null, 1)); s++; } }
  await writeFile(join(dir, 'us', 'network.json'), JSON.stringify(fx.network, null, 1));
  await writeFile(join(dir, 'us', 'team.json'), JSON.stringify({ team: [] }, null, 1));
  console.log(`demo fixtures: ${f} findings, ${s} strategies, and our side, under ${join(config.data.root, 'enrich')}`);
}
main();
