import { listAsks, listConflicts } from '@/modules/coordination';
import { listOpenTickets } from '@/modules/governance';
import { vehicleTotals } from '@/modules/pipeline';
import { listPursuits } from '@/modules/strategy';
import type { Metric } from './types';

/**
 * Today's numbers, computed now.
 *
 * These become the pin when somebody captures the day. Every one of them is per vehicle or
 * explicitly cross-vehicle-by-count — **there is no blended money figure here**, and a
 * count of asks is not a sum of dollars.
 */
export async function liveMetrics(): Promise<Metric[]> {
  const [totals, tickets, asks, conflicts, pursuits] = await Promise.all([
    vehicleTotals(), listOpenTickets(), listAsks(null), listConflicts('open'), listPursuits(null),
  ]);

  const out: Metric[] = [];

  for (const t of totals) {
    out.push({
      key: `hard:${t.vehicleSlug}`, label: 'Hard', value: t.hard, unit: 'usd',
      vehicleSlug: t.vehicleSlug, vehicleName: t.vehicleName,
      detail: `Signed and countersigned. ${t.cash > 0 ? `$${(t.cash / 1e6).toFixed(1)}M has wired.` : 'Nothing has wired yet.'}`,
    });
    out.push({
      key: `soft:${t.vehicleSlug}`, label: 'Soft', value: t.soft, unit: 'usd',
      vehicleSlug: t.vehicleSlug, vehicleName: t.vehicleName,
      detail: 'A separate track. Never added to hard, here or anywhere else.',
    });
    out.push({
      key: `gap:${t.vehicleSlug}`, label: 'Gap to target', value: t.gapToTarget ?? 0, unit: 'usd',
      vehicleSlug: t.vehicleSlug, vehicleName: t.vehicleName,
      detail: t.gapToTarget === null ? 'No target set for this vehicle.' : 'Hard-only basis.',
    });
  }

  out.push({
    key: 'tickets', label: 'Approvals waiting', value: tickets.length, unit: 'count',
    vehicleSlug: null, vehicleName: null,
    detail: 'Open tickets across every vehicle. A count of decisions, not of money.',
  });
  out.push({
    key: 'conflicts', label: 'Open conflicts', value: conflicts.length, unit: 'count',
    vehicleSlug: null, vehicleName: null,
    detail: 'Cross-vehicle collisions awaiting adjudication. Each one owes a dated follow-up to its loser.',
  });
  out.push({
    key: 'asks', label: 'Asks on file', value: asks.length, unit: 'count',
    vehicleSlug: null, vehicleName: null,
    detail: 'Every ask recorded, at any stage.',
  });
  out.push({
    key: 'pursuits', label: 'Pursuits open', value: pursuits.length, unit: 'count',
    vehicleSlug: null, vehicleName: null,
    detail: 'Open target workspaces. Rung by rung, not weighted.',
  });

  return out;
}
