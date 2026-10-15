import type { StrategyRowBasis } from '@/components/strategy/StrategyTable';
import type { StrategyAction } from '@/lib/authz/read/strategy';
import { shortDate } from '@/lib/time';

const date = (d: Date | null | undefined) => d ? shortDate(d) : 'date unknown';

/**
 * Why an LP sits where it does on a vehicle's plan: the text a row of "LPs by next action" shows when it is opened.
 * It is read when a row opens (app/[vehicle]/strategy/basis), not sent with every row: on the real data it was most
 * of the plan page's 2 MB (15 Oct 2026). Search never read it.
 */
export function strategyBasis(r: StrategyAction): StrategyRowBasis {
  return {
    angle: r.suggestion?.data.angle ?? r.pursuit.headline ?? null,
    capacity: `${r.capacityBasis}${r.capacityBand ? ` ${r.capacityBand}` : ''}`,
    likelihood: r.propensity?.basis ?? null,
    route: r.route ? `${r.route.path || 'No path recorded'} · tier ${r.route.tier ?? 'unknown'} · ${r.route.count} found ${date(r.route.at)}${r.route.current ? '' : ' · needs refresh'}` : null,
    decision: r.decision?.basis ?? null,
    conversion: [r.conversion.forward, r.conversion.observed, Number(r.conversion.factor.toFixed(2))],
    work: r.workFactors.map(f => [f.label, f.points] as [string, number]),
    due: r.pursuit.nextStepOn ? date(r.pursuit.nextStepOn) : null,
    proposed: r.suggestion?.data.next?.who || r.suggestion?.data.next?.when ? `${r.suggestion?.data.next?.who ?? 'someone'} · ${r.suggestion?.data.next?.when ?? 'no date'}` : null,
    strategy: r.suggestion ? `${r.suggestion.status} · ${r.suggestion.made_by} · ${date(new Date(r.suggestion.made_at))} · confidence ${r.suggestion.data.confidence ?? 'unknown'}` : null,
    plan: r.pursuit.plan.map(p => [p.move, p.because] as [string, string]),
  };
}
