import { config } from '@/config/deployment';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { planRoutes } from '@/lib/authz/read/network';
import { routeContacts } from '@/lib/mcp/reads';
import type { AppUser } from '@/modules/platform';
import type { RouteStrength } from '@/modules/network';
import { ADDRESSES_WITHHELD } from './addresses';
import { deskVehicle } from './reads';

/**
 * top_connectors (MCP) and GET /api/outreach/connectors (docs/27 §4b): the people who sit on the most and best warm
 * routes to a vehicle's open LPs. No new scoring model: it reads the routes routes_to reads (modules/network's
 * planRoutes, through the authorization facade, so licensed evidence is redacted as on the routes page) and counts.
 *
 *   - Rows: the vehicle's open pursuits (not passed), on a vehicle the token's owner may read — the queue's rule.
 *   - A route counts only when its verdict is "recommend": held and excluded routes (a restriction, a spent ask cap)
 *     are never counted, so a restriction is never stripped to make a connector look useful (rule 8).
 *   - A connector is anyone between the source (the team, PL) and the LP: the route's connectorIds. Each LP counts
 *     once per connector; the best route score (0–100, uncalibrated, never a probability) is the highest of theirs.
 *   - Planning stops at config.outreach.connectorsBudgetMs and says how many LPs it inspected (rule 7).
 */

const EXAMPLES = 3; // GUESS — enough for the desk to see who they reach, not a list to work from.

export async function topConnectors(user: AppUser, a: { vehicle: string; limit?: number }) {
  const v = await deskVehicle(user, a.vehicle);
  const { rows, asOf } = await pipelineData(v.id);
  // Highest priority first, so a cut-off budget has inspected the LPs that matter most.
  const open = rows.filter((r) => r.vehicleId === v.id && r.status !== 'passed')
    .sort((x, y) => (y.priority ?? -1) - (x.priority ?? -1) || (x.id < y.id ? -1 : 1));
  const started = Date.now();
  const by = new Map<string, { name: string; lps: Map<string, { score: number | null; band: RouteStrength | null }> }>();
  let inspected = 0, reached = 0, notCounted = 0;
  for (const r of open) {
    if (Date.now() - started > config.outreach.connectorsBudgetMs) break;
    const search = await planRoutes(user.handle, r.entityId, 3, v.kind, 'team', undefined, { vehicleId: v.id });
    inspected++;
    const routes = search?.routes ?? [];
    const usable = routes.filter((x) => x.verdict === 'recommend');
    notCounted += routes.length - usable.length;
    if (usable.some((x) => x.connectorIds?.length)) reached++;
    for (const route of usable) {
      const score = route.score?.value ?? null, band = route.score?.band ?? null;
      (route.connectorIds ?? []).forEach((id, i) => {
        const c = by.get(id) ?? { name: route.connectorNames?.[i] ?? 'Unknown', lps: new Map() };
        const prior = c.lps.get(r.id);
        if (!prior || (score ?? -1) > (prior.score ?? -1)) c.lps.set(r.id, { score, band });
        by.set(id, c);
      });
    }
  }
  const ranked = [...by.entries()].map(([entityId, c]) => {
    const lps = [...c.lps.entries()].sort((x, y) => (y[1].score ?? -1) - (x[1].score ?? -1) || (x[0] < y[0] ? -1 : 1));
    return { entityId, name: c.name, lps: lps.length, bestScore: lps[0]?.[1].score ?? null, bestBand: lps[0]?.[1].band ?? null,
      examplePursuitIds: lps.slice(0, EXAMPLES).map(([id]) => id) };
  }).sort((x, y) => y.lps - x.lps || (y.bestScore ?? -1) - (x.bestScore ?? -1) || x.name.localeCompare(y.name) || (x.entityId < y.entityId ? -1 : 1));
  const shown = ranked.slice(0, a.limit ?? 20);
  const c = await routeContacts(user, v.id, shown);
  const complete = inspected === open.length;
  return {
    asOf,
    data: {
      vehicle: v.slug, connectors: shown.map((x) => c.at(x)), total: ranked.length,
      lpsOpen: open.length, lpsInspected: inspected, lpsReached: reached, complete,
      addresses: c.shown ? 'shown' : ADDRESSES_WITHHELD,
    },
    coverage: {
      corpus: `Warm-intro routes (the routes routes_to returns: the team and the PL network, up to three hops) to the open LPs on ${v.name}.`,
      counted: `Only routes the planner recommends; ${notCounted} held or excluded route${notCounted === 1 ? ' was' : 's were'} not counted (rule 8). Each LP counts once per connector.`,
      score: 'bestScore is the best route score through them, 0–100: a relative, uncalibrated estimate, never an investment probability.',
      inspected: complete ? `Every open LP (${open.length}).` : `${inspected} of ${open.length} open LPs, highest priority first, before the time budget ran out. Routes are cached as they are planned, so asking again reaches further.`,
      note: 'A connector who is not listed may still know them: no supported route in the material inspected is not proof that none exists (rule 7).',
    },
  };
}
