'use client';

import { useState } from 'react';
import type { Route } from '@/modules/network/client';
import { VERDICT_LABEL } from '@/modules/network/client';
import { routeGraphLayout, routeNodeIds, routeReading } from './route-display';

/** Shared entity nodes; every drawn route has an adjacent keyboard-accessible disclosure. */
export function RouteGraph({ routes, fromName, targetName, selected, routeIds }: {
  routes: Route[]; fromName: string; targetName: string; selected: number; routeIds?: number[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { nodes, height, width } = routeGraphLayout(routes);
  const positions = new Map(nodes.map((n) => [n.id, n]));
  const active = hovered === null ? null : routes[hovered];
  const activeReading = active ? routeReading(active) : null;
  return <div className="route-map" onMouseLeave={() => setHovered(null)} onKeyDown={(e) => { if (e.key === 'Escape') setHovered(null); }}>
    <div className="route-map-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-label={`Routes to ${targetName}. One node per person. Full details in the comparison list.`}>
        {routes.map((route, ri) => {
          const points = routeNodeIds(route).map((id) => positions.get(id)!);
          const reading = routeReading(route);
          const unavailable = route.verdict !== 'recommend';
          const strong = !unavailable && reading.band === 'strong';
          const on = ri === (hovered ?? selected);
          const colour = unavailable ? 'var(--muted)' : strong ? 'var(--green)' : 'var(--accent)';
          // Separate overlapping paths slightly so each route remains individually hoverable.
          const d = points.slice(0, -1).map((p, i) => {
            const q = points[i + 1]!;
            const bend = (ri - (routes.length - 1) / 2) * 7;
            return `M ${p.x} ${p.y} C ${(p.x + q.x) / 2} ${p.y + bend}, ${(p.x + q.x) / 2} ${q.y + bend}, ${q.x} ${q.y}`;
          }).join(' ');
          return <a key={ri} href={`#route-${routeIds?.[ri] ?? ri}`} aria-label={`Route ${ri + 1}: ${route.fromName ?? fromName} → ${route.hops.map((h) => h.toName).join(' → ')}. Strength ${reading.score}, ${VERDICT_LABEL[route.verdict]}. Inspect in list.`}
            onMouseEnter={() => setHovered(ri)} onFocus={() => setHovered(ri)} onBlur={() => setHovered(null)}
            onClick={() => { const detail = document.getElementById(`route-${routeIds?.[ri] ?? ri}`); if (detail instanceof HTMLDetailsElement) detail.open = true; }}>
            <path d={d} fill="none" stroke={colour} strokeWidth={1 + reading.score / 22} opacity={hovered !== null && !on ? 0.18 : on ? 1 : 0.65}
              strokeDasharray={unavailable ? '5 4' : undefined} />
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
          </a>;
        })}
        {nodes.map((n) => <g key={n.id} data-entity={n.id} pointerEvents="none">
          <circle cx={n.x} cy={n.y} r={5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
          <text x={n.x} y={n.y - 13} textAnchor="middle" fill="var(--ink)" fontSize="11" fontFamily="var(--sans)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>{n.name}</text>
        </g>)}
      </svg>
    </div>
    {active && activeReading && <div className="route-hover" role="status">
      <b>{active.fromName ?? fromName} → {active.hops.map((h) => h.toName).join(' → ')}</b>
      <p>{VERDICT_LABEL[active.verdict]} · {activeReading.score}/100 {activeReading.provisional ? 'provisional strength' : 'strength'} · tier {active.weakestTier}</p>
      <p>{active.reasons.join(' ')}</p>
      {activeReading.factors.slice(0, 3).map((f, i) => <p key={i}>{f.label}: {f.value} · {f.basis}</p>)}
      <small>Activate the path to open its evidence in the list. Escape dismisses this card.</small>
    </div>}
    <p className="route-map-key">Thicker = stronger estimate · strong routes highlighted · dashed = held or unavailable. Hover or focus a path for details.</p>
  </div>;
}
