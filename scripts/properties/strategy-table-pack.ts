/** Invented rows only: the strategy page's LP table packs repeated text once, and loses nothing. */
import { isDeepStrictEqual } from 'node:util';
import { packRows, unpackRows } from '../../components/strategy/pack';
import type { StrategyTableRow } from '../../components/strategy/StrategyTable';
import type { Check } from './harness';

export function strategyTablePackProperties(check: Check) {
  const views = ['all', 'risk', 'research', 'route'];
  const base = '/invented/pipeline/';
  const row = (i: number): StrategyTableRow => ({
    id: `invented-${i}`, name: `Invented LP ${i}`, href: `${base}invented-${i}`, action: i % 3 ? 'Find and assess a route' : `Invented next step ${i}`,
    group: i % 2 ? 'Fill evidence gaps' : 'Recorded next actions', status: i % 2 ? 'sourcing' : 'discussing', owner: i % 4 ? 'Invented owner' : 'Not on the team',
    rank: i % 5 ? i : null, priority: i % 7 ? null : 1234.5, expected: i % 7 ? null : 2469, evidencePriority: i % 50,
    capacity: i % 3 ? null : 250000, likelihood: i % 3 ? null : 0.3, route: i % 6 ? null : 0.8, days: i % 3 ? null : 45,
    views: views.filter((_, v) => v === 0 || (i + v) % 3 === 0), risks: i % 2 ? ['Owner unavailable', `${i} days without recorded activity`] : [],
    held: i % 11 === 0,
    basis: {
      angle: i % 4 ? null : `An invented angle ${i}`, capacity: 'No supported capacity estimate.', likelihood: null,
      route: i % 6 ? null : `A → B · tier B · ${i} found`, decision: null, conversion: [i % 3, i % 5, 1.25],
      work: [['Research missing', 5], ['Strategy missing', 5]], due: null, proposed: i % 3 ? null : 'Someone · next week',
      strategy: null, plan: i % 4 ? [] : [['Invented move', 'Invented reason']],
    },
  });
  const rows = Array.from({ length: 400 }, (_, i) => row(i));
  const packed = packRows(rows, views, base);
  const back = unpackRows(JSON.parse(JSON.stringify(packed)));
  check('0082 LP table rows survive packing exactly', isDeepStrictEqual(back, rows),
    `${rows.length} invented rows, with nulls, repeated risks, views and plans, round-trip through JSON unchanged`);
  const saved = 1 - JSON.stringify(packed).length / JSON.stringify(rows).length;
  check('0082 packing sends repeated text once', packed.strings.length < rows.length && saved > 0.2,
    `${packed.strings.length} distinct strings for ${rows.length} rows; ${Math.round(saved * 100)}% smaller`);
  let refused = false;
  try { packRows([{ ...rows[0]!, href: '/elsewhere' }], views, base); } catch { refused = true; }
  check('0082 a row whose link breaks the shared prefix is refused, not rewritten', refused, 'a link is never silently changed');
}
