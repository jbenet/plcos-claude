/**
 * The LP table ships every pursuit of a vehicle to the browser (thousands, on the real data) so that
 * search and sorting are instant. Most of its text repeats from row to row (the same risk labels,
 * the same "no supported capacity estimate"), so strings travel once, in a table, and rows carry
 * their indices; the coverage views travel as a bitmask and the link as a shared prefix.
 * Packing and unpacking are exact inverses; no text is shortened or dropped. A row's basis is not here: it is read
 * when the row opens (lib/strategy-basis.ts, 15 Oct 2026).
 */
import type { StrategyTableRow } from './StrategyTable';
import type { SpvRowMark } from '@/modules/strategy/client';
import { packRows as packColumns, unpackRows as unpackColumns, type PackedRows } from '@/lib/packed-rows';

type S = number;
export interface PackedRow {
  id: string; name: string; action: string; group: S; status: S; owner: S; rank: number | null;
  priority: number | null; expected: number | null; evidencePriority: number;
  capacity: number | null; likelihood: number | null; route: number | null; days: number | null;
  views: number; risks: S[]; held: boolean;
  /** SPV stance: stance, known count, why, basis, conflict (1) or not (0), the short why. */
  spv: [S, number | null, S | null, S, 0 | 1, S | null];
}
export interface PackedTable { rows: PackedRows; strings: string[]; views: string[]; hrefBase: string }

export function packRows(rows: StrategyTableRow[], views: string[], hrefBase: string): PackedTable {
  const strings: string[] = []; const index = new Map<string, number>();
  const s = (v: string): S => { let i = index.get(v); if (i === undefined) { i = strings.length; strings.push(v); index.set(v, i); } return i; };
  const n = (v: string | null): S | null => v === null ? null : s(v);
  if (views.length > 31) throw new Error('Too many coverage views for a bitmask.');
  return {
    strings, views, hrefBase,
    rows: packColumns(rows.map((r): PackedRow => {
      if (r.href !== hrefBase + r.id) throw new Error('A row link does not follow the shared prefix.');
      return {
        id: r.id, name: r.name, action: r.action, group: s(r.group), status: s(r.status), owner: s(r.owner), rank: r.rank,
        priority: r.priority, expected: r.expected, evidencePriority: r.evidencePriority,
        capacity: r.capacity, likelihood: r.likelihood, route: r.route, days: r.days,
        views: r.views.reduce((m, v) => views.includes(v) ? m | (1 << views.indexOf(v)) : m, 0),
        risks: r.risks.map(s), held: r.held,
        spv: [s(r.spv.stance), r.spv.minDeals, n(r.spv.why), s(r.spv.basis), r.spv.conflict ? 1 : 0, n(r.spv.short)],
      };
    })),
  };
}

export function unpackRows({ rows, strings, views, hrefBase }: PackedTable): StrategyTableRow[] {
  const s = (i: S) => strings[i]!;
  const n = (i: S | null) => i === null ? null : strings[i]!;
  return unpackColumns<PackedRow>(rows).map(r => ({
    id: r.id, name: r.name, href: hrefBase + r.id, action: r.action, group: s(r.group), status: s(r.status), owner: s(r.owner), rank: r.rank,
    priority: r.priority, expected: r.expected, evidencePriority: r.evidencePriority,
    capacity: r.capacity, likelihood: r.likelihood, route: r.route, days: r.days,
    views: views.filter((_, i) => r.views & (1 << i)), risks: r.risks.map(s), held: r.held,
    spv: { stance: s(r.spv[0]) as SpvRowMark['stance'], minDeals: r.spv[1], why: n(r.spv[2]), basis: s(r.spv[3]) as SpvRowMark['basis'], conflict: r.spv[4] === 1, short: n(r.spv[5]) },
  }));
}
