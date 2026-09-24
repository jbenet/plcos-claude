/**
 * W11, the connector plan (docs/19, iteration 3): writes data/<profile>/enrich/connectors.json from
 * the candidates, the paths, the triage and the strategies, and prints counts only.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-connectors.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { connectorPlans } from '../lib/enrich/connectors';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const plans = await connectorPlans(dir);
  await writeFile(join(dir, 'connectors.json'), JSON.stringify(plans, null, 2) + '\n', 'utf8');
  const asks = plans.reduce((n, p) => n + p.asks.length, 0);
  const prospects = new Set(plans.flatMap((p) => p.prospects.map((x) => x.key))).size;
  const byStatus = plans.reduce<Record<string, number>>((m, p) => ({ ...m, [p.connector.status]: (m[p.connector.status] ?? 0) + 1 }), {});
  console.log(`connectors: ${plans.length} with prospects next to them (${JSON.stringify(byStatus)}) · ${prospects} prospects · ${asks} asks this quarter (at most ${config.guard.asksPerConnectorPerQuarter} each, a guess) · ${plans.filter((p) => p.when === 'after they sign').length} wait for a signature · ${plans.reduce((n, p) => n + p.toConfirm, 0)} ties to confirm first`);
}
main();
