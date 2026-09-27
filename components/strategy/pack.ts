/**
 * The LP table ships every pursuit of a vehicle to the browser (thousands, on the real data) so that
 * search and sorting are instant. Most of its text repeats from row to row (the same risk labels,
 * the same "no supported capacity estimate"), so strings travel once, in a table, and rows carry
 * their indices; the coverage views travel as a bitmask and the link as a shared prefix.
 * Packing and unpacking are exact inverses; no text is shortened or dropped.
 */
import type { StrategyTableRow } from './StrategyTable';
import type { SpvRowMark } from '@/modules/strategy/client';

type S = number;
export interface PackedRow {
  id: string; name: string; action: string; group: S; status: S; owner: S; rank: number | null;
  priority: number | null; expected: number | null; evidencePriority: number;
  capacity: number | null; likelihood: number | null; route: number | null; days: number | null;
  views: number; risks: S[]; held: boolean;
  /** SPV stance: stance, known count, why, basis, conflict (1) or not (0), the short why. */
  spv: [S, number | null, S | null, S, 0 | 1, S | null];
  basis: {
    angle: S | null; capacity: S; likelihood: S | null; route: S | null; decision: S | null;
    conversion: [number, number, number]; work: Array<[S, number]>; due: S | null; proposed: S | null; strategy: S | null;
    plan: Array<[S, S]>;
  };
}
export interface PackedTable { rows: PackedRow[]; strings: string[]; views: string[]; hrefBase: string }

export function packRows(rows: StrategyTableRow[], views: string[], hrefBase: string): PackedTable {
  const strings: string[] = []; const index = new Map<string, number>();
  const s = (v: string): S => { let i = index.get(v); if (i === undefined) { i = strings.length; strings.push(v); index.set(v, i); } return i; };
  const n = (v: string | null): S | null => v === null ? null : s(v);
  if (views.length > 31) throw new Error('Too many coverage views for a bitmask.');
  return {
    strings, views, hrefBase,
    rows: rows.map(r => {
      if (r.href !== hrefBase + r.id) throw new Error('A row link does not follow the shared prefix.');
      const b = r.basis;
      return {
        id: r.id, name: r.name, action: r.action, group: s(r.group), status: s(r.status), owner: s(r.owner), rank: r.rank,
        priority: r.priority, expected: r.expected, evidencePriority: r.evidencePriority,
        capacity: r.capacity, likelihood: r.likelihood, route: r.route, days: r.days,
        views: r.views.reduce((m, v) => views.includes(v) ? m | (1 << views.indexOf(v)) : m, 0),
        risks: r.risks.map(s), held: r.held,
        spv: [s(r.spv.stance), r.spv.minDeals, n(r.spv.why), s(r.spv.basis), r.spv.conflict ? 1 : 0, n(r.spv.short)],
        basis: {
          angle: n(b.angle), capacity: s(b.capacity), likelihood: n(b.likelihood), route: n(b.route), decision: n(b.decision),
          conversion: b.conversion, work: b.work.map(([w, p]) => [s(w), p]), due: n(b.due), proposed: n(b.proposed),
          strategy: n(b.strategy), plan: b.plan.map(([m, why]) => [s(m), s(why)]),
        },
      };
    }),
  };
}

export function unpackRows({ rows, strings, views, hrefBase }: PackedTable): StrategyTableRow[] {
  const s = (i: S) => strings[i]!;
  const n = (i: S | null) => i === null ? null : strings[i]!;
  return rows.map(r => ({
    id: r.id, name: r.name, href: hrefBase + r.id, action: r.action, group: s(r.group), status: s(r.status), owner: s(r.owner), rank: r.rank,
    priority: r.priority, expected: r.expected, evidencePriority: r.evidencePriority,
    capacity: r.capacity, likelihood: r.likelihood, route: r.route, days: r.days,
    views: views.filter((_, i) => r.views & (1 << i)), risks: r.risks.map(s), held: r.held,
    spv: { stance: s(r.spv[0]) as SpvRowMark['stance'], minDeals: r.spv[1], why: n(r.spv[2]), basis: s(r.spv[3]) as SpvRowMark['basis'], conflict: r.spv[4] === 1, short: n(r.spv[5]) },
    basis: {
      angle: n(r.basis.angle), capacity: s(r.basis.capacity), likelihood: n(r.basis.likelihood), route: n(r.basis.route),
      decision: n(r.basis.decision), conversion: r.basis.conversion, work: r.basis.work.map(([w, p]) => [s(w), p]),
      due: n(r.basis.due), proposed: n(r.basis.proposed), strategy: n(r.basis.strategy),
      plan: r.basis.plan.map(([m, why]) => [s(m), s(why)]),
    },
  }));
}
