import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineView } from '../components/floor/LineView';
import { MapView } from '../components/floor/MapView';
import { RadarView } from '../components/floor/RadarView';
import { NetworkView } from '../components/floor/NetworkView';
import { CalendarWindow } from '../components/calendar/CalendarWindow';
import { EMPTY_FILTER, parseFloorFilter } from '../components/floor/FloorContext';
import { filterProjection } from '../components/floor/projection';
import type { FloorItem, FloorState } from '../lib/floor-client';
import type { BoardState, Territory } from '../lib/board-client';
import type { Lenses } from '../lib/lenses-client';
import type { Check } from './properties/harness';

export function visualizationScaleProperties(check: Check) {
  // Invented scale fixture: counts are deliberately larger than a detail page.
  const items: FloorItem[] = Array.from({ length: 2400 }, (_, i) => ({
    key: `p-${i}`, entityId: `e-${i}`, entityName: `Example ${i}`, vehicleSlug: i % 2 ? 'blue' : 'red',
    vehicleName: i % 2 ? 'Blue fund' : 'Red fund', ownerName: 'Example owner', pursuitId: `p-${i}`,
    status: i % 3 ? 'sourcing' : 'discussing', statusBasis: 'Invented fixture', needsEvidence: null,
    rung: null, ladderRung: null, rungIndex: -1, nextRung: null, track: i % 4 ? 'soft' : 'hard',
    amount: 100, probability: null, cashReceived: false, sizeBasis: 'Invented fixture', temp: 'unmoved', tempBasis: 'No dated record',
    lastMoveAt: null, daysSinceMove: null, blocked: null, urgent: null, urgentAt: null, conflict: false,
    restricted: false, openTicket: null, headline: null, path: [], walkedAt: [], stalled: false,
  }));
  const state: FloorState = { scopeSlug: null, scopeName: 'Example funds', items, asOf: new Date(), vehicles: [],
    money: ['red', 'blue'].map(slug => ({ slug, name: slug, hard: 0, soft: 0, items: 1200 })), schedule: [], alarms: [],
    coverage: { corpus: 'Invented fixture', notInspected: [] },
    agents: { running: 0, awaitingAcceptance: 0, refused: 0, acceptedToday: 0, breaker: { frozen: false, statement: 'Fixture' }, queue: [], humanQueued: 0, agentQueued: 0, humanWip: 0, agentWip: 0 },
  };
  const territory = (entityId: string, name: string): Territory => ({ entityId, name, segment: 'Example', capacity: null, affinity: null, propensity: null, timeToDecision: null, band: 'Not scored', scoreBasis: 'No score', cheque: null, chequeBasis: 'Unknown', holding: 'open', explored: 'named', ownerName: null, rung: null, edges: 0, vehicleName: null });
  const board: BoardState = { territories: [...items.map(i => territory(i.entityId, i.entityName)), territory('discovery', 'Discovery only')], rows: [], resources: [], goodwill: [], stations: [], moves: [], fog: { scored: 0, researched: 0, named: 2401, note: 'Fixture preview' } };
  const lenses: Lenses = {
    network: { nodes: items.map(i => ({ id: `t:${i.key}`, name: i.entityName, role: 'target', note: '', vehicleName: i.vehicleName, amount: 100, actions: 0 })), links: [], paths: items.map(i => ({ fromId: 'owner', viaId: 'connector', targetKey: i.key, label: i.entityName, owner: 'Owner', advocate: 'Connector', target: i.entityName, state: 'unconfirmed', why: 'Tier C fixture' })), note: 'Fixture' },
    leverage: { prerequisites: [{ key: 'gate', label: 'Fixture gate', family: 'approval', owner: null, state: 'review', because: 'Fixture', href: '/approvals', dependents: items.map(i => ({ key: i.key, label: i.entityName, vehicleName: i.vehicleName, amount: 100, urgent: false, blocked: false })) }], totals: { prerequisites: 1, dependents: 2400, inReview: 1 }, note: 'Fixture' },
    coverage: { rows: items.map(i => ({ key: i.key, entityId: i.entityId, name: i.entityName, vehicleName: i.vehicleName, ownerName: i.ownerName, amount: 100, cells: { check: { mark: 'recorded', note: 'Fixture' } }, recorded: 1 })), totals: [{ key: 'check', recorded: 2400, of: 2400 }], note: 'Fixture' },
    radar: { dots: [], offRadar: items.map(i => ({ key: i.key, entityId: i.entityId, name: i.entityName, vehicleName: i.vehicleName, ownerName: i.ownerName, amount: 100, days: null, temp: 'unmoved', blocked: false, urgent: false })), bands: [], asOf: new Date(), note: 'Fixture' },
    strip: { lanes: [], days: 29, back: 14, asOf: new Date(), note: 'Fixture' },
  };
  const selected = filterProjection(state, board, lenses, { ...EMPTY_FILTER, vehicle: 'red', status: 'discussing' });
  check('0066 vehicle/status filters conserve counts across views', selected.state.items.length === 400 && selected.lenses.network.paths.length === 400 && selected.lenses.coverage.totals[0]?.recorded === 400 && selected.lenses.leverage.totals.dependents === 400 && selected.lenses.radar.offRadar.length === 400, 'The same 400 invented pursuits reach each detail view and summary.');
  check('0066 hard and soft remain separate inside one vehicle', selected.state.money.length === 1 && selected.state.money[0]?.hard === 20000 && selected.state.money[0]?.soft === 20000, 'No combined or cross-vehicle monetary total is introduced.');
  const discovery = filterProjection(state, board, lenses, { ...EMPTY_FILTER, find: 'Discovery only', band: 'Not scored' });
  check('0066 discovery-only map names survive text and band filters', discovery.state.items.length === 0 && discovery.board.territories.length === 1 && discovery.board.territories[0]?.entityId === 'discovery', 'Map discovery records need not have a pursuit.');
  const empty = filterProjection(state, board, lenses, { ...EMPTY_FILTER, vehicle: 'absent' });
  check('0066 empty filter clears all dependent counts and paths', empty.state.items.length === 0 && empty.lenses.network.paths.length === 0 && empty.lenses.coverage.totals[0]?.of === 0 && empty.lenses.leverage.totals.dependents === 0, 'Empty means no matches; no stale totals remain.');
  check('0066 malformed URL filters recover safely', [parseFloorFilter('null'), parseFloorFilter('{'), parseFloorFilter('{"find":42,"status":"invented","signal":[]}')].every(f => f.find === '' && f.status === 'all' && f.signal === 'all'), 'Malformed links cannot crash filtering or invent a pipeline state.');
  for (const [name, element] of [
    ['Line', createElement(LineView, { state })],
    ['Map', createElement(MapView, { board })],
    ['Radar', createElement(RadarView, { radar: lenses.radar })],
    ['Network', createElement(NetworkView, { network: lenses.network })],
  ] as const) {
    const html = renderToStaticMarkup(element);
    check(`0066 ${name} renders a bounded summary for 2400 pursuits`, html.length < 50000 && [...html.matchAll(/<tr\b/g)].length < 40,
      'Actual rendered markup stays small; detail lists page instead of expanding with the fixture.');
  }
  const calendar = renderToStaticMarkup(createElement(CalendarWindow, {
    rows: items.map(i => ({ id: i.key, lane: 'meetings' as const, label: i.entityName, detail: null, from: '2026-09-21T00:00:00Z', to: null, vehicle: i.vehicleName, standing: 'ahead' as const, href: null })),
    first: '2026-09-21T00:00:00Z', weeks: 16,
  }));
  check('0066 coincident calendar records collapse into one weekly count', calendar.includes('2400') && calendar.length < 10000 && [...calendar.matchAll(/<tr\b/g)].length === 2,
    '2400 invented meetings in one week produce one activity row, not 2400 overlapping Gantt rows.');

}
