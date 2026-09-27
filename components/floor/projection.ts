import type { BoardState } from '@/lib/board-client';
import type { FloorState } from '@/lib/floor-client';
import type { Lenses } from '@/lib/lenses-client';
import { matches, type FloorFilter } from './FloorContext';

/** Keep every summary and its detail rows on the same population. */
export function filterProjection(state: FloorState, board: BoardState, lenses: Lenses, filter: FloorFilter) {
  const bandByEntity = new Map(board.territories.map(t => [t.entityId, t.band]));
  const items = state.items.filter((i) => matches(i, filter) && (filter.band === 'all' || (bandByEntity.get(i.entityId) ?? 'Not inspected') === filter.band));
  const keep = new Set(items.map((i) => i.key));
  const entities = new Set(items.map((i) => i.entityId));
  const money = state.money.map((m) => ({
    ...m,
    hard: items.filter((i) => i.vehicleSlug === m.slug && i.track === 'hard').reduce((n, i) => n + (i.amount ?? 0), 0),
    soft: items.filter((i) => i.vehicleSlug === m.slug && i.track === 'soft').reduce((n, i) => n + (i.amount ?? 0), 0),
    items: items.filter((i) => i.vehicleSlug === m.slug).length,
  })).filter((m) => m.items > 0);
  const filteredState: FloorState = { ...state, items, money };
  const filteredBoard: BoardState = {
    ...board,
    rows: board.rows.filter((r) => keep.has(r.key)),
    territories: board.territories.filter(t => {
      const pursuitConstraint = filter.vehicle !== 'all' || filter.owner !== 'everyone' || filter.signal !== 'all' || filter.status !== 'all';
      if (pursuitConstraint && !entities.has(t.entityId)) return false;
      if (filter.band !== 'all' && t.band !== filter.band) return false;
      const query = filter.find.trim().toLowerCase();
      return !query || [t.name, t.segment, t.ownerName ?? '', t.band].join(' ').toLowerCase().includes(query) || entities.has(t.entityId);
    }),
  };
  const targetIds = new Set(lenses.network.nodes.filter(n => n.role === 'target' && keep.has(n.id.slice(2))).map(n => n.id));
  const adjacent = new Set(lenses.network.links.filter(l => targetIds.has(l.to)).map(l => l.from));
  const networkLinks = lenses.network.links.filter(l => targetIds.has(l.to) || adjacent.has(l.to));
  const linkedIds = new Set(networkLinks.flatMap(l => [l.from, l.to]));
  const coverageRows = lenses.coverage.rows.filter(r => keep.has(r.key));
  const prerequisites = lenses.leverage.prerequisites.map(p => ({ ...p, dependents: p.dependents.filter(d => keep.has(d.key)) })).filter(p => p.dependents.length);
  const filteredLenses: Lenses = {
    ...lenses,
    network: {
      ...lenses.network,
      nodes: lenses.network.nodes.filter(n => targetIds.has(n.id) || linkedIds.has(n.id)),
      links: networkLinks,
      paths: lenses.network.paths.filter(p => keep.has(p.targetKey)),
    },
    leverage: {
      ...lenses.leverage,
      prerequisites,
      totals: { prerequisites: prerequisites.length, dependents: new Set(prerequisites.flatMap(p => p.dependents.map(d => d.key))).size, inReview: prerequisites.filter(p => p.state === 'review').length },
    },
    coverage: { ...lenses.coverage, rows: coverageRows, totals: lenses.coverage.totals.map(t => ({ ...t, of: coverageRows.length, recorded: coverageRows.filter(r => r.cells[t.key]?.mark === 'recorded').length })) },
    radar: {
      ...lenses.radar,
      dots: lenses.radar.dots.filter((d) => keep.has(d.key)),
      offRadar: lenses.radar.offRadar.filter((d) => keep.has(d.key)),
    },
  };
  return { state: filteredState, board: filteredBoard, lenses: filteredLenses };
}
