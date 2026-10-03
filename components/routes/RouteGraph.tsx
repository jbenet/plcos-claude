'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Route } from '@/modules/network/client';
import { VERDICT_LABEL } from '@/modules/network/client';
import { Pager, usePage } from '@/components/floor/Paging';
import { routeGraphArcLabels, routeGraphArcs, routeGraphLayout, routeReading } from './route-display';

/** Shared entity nodes; every drawn route has an adjacent keyboard-accessible disclosure. */
export function RouteGraph({ routes: allRoutes, fromName, targetName, selected: allSelected, routeIds: allRouteIds, portfolioFounders = {}, pageSize = 8, anchors: allAnchors, label, centerOn }: {
  routes: Route[]; fromName: string; targetName: string; selected: number; routeIds?: number[]; portfolioFounders?: Record<string, string[]>;
  /** Routes drawn per page; the "through" map draws routes in and ties out together. */
  pageSize?: number;
  /** Element id each route's arcs open, in place of `route-<id>`. */
  anchors?: string[];
  /** Replaces "Routes to <target>" in the map's accessible name. */
  label?: string;
  /** Entity the map scrolls to first, when it is wider than its box. */
  centerOn?: string;
}) {
  const paging = usePage(allRoutes.map((route, index) => ({ route, index })), pageSize, Math.floor(allSelected / pageSize));
  useEffect(() => { paging.setPage(Math.floor(allSelected / pageSize)); }, [allSelected, paging.setPage, pageSize]);
  const routes = paging.rows.map(x => x.route);
  const routeIds = paging.rows.map(x => allRouteIds?.[x.index] ?? x.index);
  const anchors = paging.rows.map((x, i) => allAnchors?.[x.index] ?? `route-${routeIds[i]}`);
  const selected = paging.rows.findIndex(x => x.index === allSelected);
  const [hovered, setHovered] = useState<string | null>(null);
  const arrowId = useId().replaceAll(':', '');
  // Where the pointer is, inside the map. Keyboard focus has none, so the card keeps its corner (issue 0059).
  const [at, setAt] = useState<{ x: number; y: number; w: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const { nodes, height, width } = routeGraphLayout(routes, availableWidth);
  const arcs = routeGraphArcs(routes);
  const labels = routeGraphArcLabels(arcs, nodes, height);
  const positions = new Map(nodes.map((n) => [n.id, n]));
  const centerX = centerOn ? positions.get(centerOn)?.x : undefined;
  useEffect(() => {
    const box = scrollRef.current;
    if (box && centerX !== undefined) box.scrollLeft = Math.max(0, centerX - box.clientWidth / 2);
  }, [centerX, width]);
  const activeArc = arcs.find((arc) => arc.key === hovered);
  const activeIndex = activeArc?.routeIndices.includes(selected) ? selected : activeArc?.routeIndices[0];
  const active = activeIndex === undefined ? null : routes[activeIndex];
  const activeReading = active ? routeReading(active) : null;
  return <div className="route-map" onMouseLeave={() => { setHovered(null); setAt(null); }}
    onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }); }} onKeyDown={(e) => { if (e.key === 'Escape') setHovered(null); }}>
    <Pager {...paging} setPage={page => { paging.setPage(page); setHovered(null); }} label="routes in map; full comparison below" />
    <div className="route-map-scroll" ref={scrollRef}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-label={`${label ?? `Routes to ${targetName}`}. One node per entity and one scored arc per directed relationship. Possible matching identity records share a node; source records remain separate. Full details in the comparison list.`}>
        <defs><marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker></defs>
        {arcs.map((arc) => {
          const ri = arc.routeIndices.includes(selected) ? selected : arc.routeIndices[0]!;
          const unavailable = arc.routeIndices.every((index) => routes[index]!.verdict !== 'recommend');
          const on = hovered !== null ? hovered === arc.key : arc.routeIndices.includes(selected);
          const colour = unavailable ? 'var(--muted)' : on ? 'var(--green)' : 'var(--accent)';
          const p = positions.get(arc.from)!, q = positions.get(arc.to)!;
          const midX = (p.x + q.x) / 2;
          const position = labels.get(arc.key)!;
          const d = `M ${p.x} ${p.y} C ${midX} ${p.y}, ${midX} ${q.y}, ${q.x} ${q.y}`;
          const scoreLabel = arc.score === null ? 'Unscored' : `${Number(arc.score.toFixed(2))}/5`;
          const label = `${p.name} → ${q.name}: ${scoreLabel}, grade ${arc.grade}. ${arc.routeIndices.length} ${arc.routeIndices.length === 1 ? 'route' : 'routes'} use this relationship. Inspect in list.`;
          return <a key={arc.key} data-from={arc.from} data-to={arc.to} href={`#${anchors[ri]}`} aria-label={label}
            onMouseEnter={() => setHovered(arc.key)} onFocus={() => { setHovered(arc.key); setAt(null); }} onBlur={() => setHovered(null)}
            onClick={() => { const detail = document.getElementById(anchors[ri]!); if (detail instanceof HTMLDetailsElement) detail.open = true; }}>
            <path d={d} fill="none" stroke={colour} strokeWidth={1.5 + (arc.score ?? 0) / 2} opacity={hovered !== null && !on ? 0.18 : on ? 1 : 0.65}
              strokeDasharray={unavailable ? '5 4' : undefined} markerEnd={`url(#${arrowId})`} />
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
            <title>{label}</title>
            {Math.abs(position.y + 7 - position.anchorY) > 3 && <line x1={position.x} y1={position.anchorY} x2={position.x} y2={position.y + 4} stroke="var(--muted)" strokeWidth={0.7} opacity={0.6} pointerEvents="none" />}
            <text x={position.x} y={position.y} textAnchor="middle" fontFamily="var(--mono)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={5} pointerEvents="none">
              <tspan fill="var(--ink)" fontSize="12" fontWeight="600">{scoreLabel}</tspan>
              <tspan fill="var(--muted)" fontSize="10" fontWeight="400"> · {arc.grade}</tspan>
            </text>
          </a>;
        })}
        {nodes.map((n) => <g key={n.id} data-entity={n.id} data-layer={n.depth} pointerEvents="none">
          <title>{`${n.name}${portfolioFounders[n.id]?.length ? ` · PLC portfolio founder: ${portfolioFounders[n.id]!.join(', ')}` : ''}`}</title>
          <circle cx={n.x} cy={n.y} r={portfolioFounders[n.id]?.length ? 7 : 5} fill="var(--surface)" stroke={portfolioFounders[n.id]?.length ? 'var(--green)' : 'var(--ink)'} strokeWidth={2} />
          <text x={n.x} y={n.y - 13} textAnchor="middle" fill="var(--ink)" fontSize="11" fontFamily="var(--sans)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>{n.name}</text>
          {portfolioFounders[n.id]?.length ? <text x={n.x} y={n.y + 22} textAnchor="middle" fill="var(--green)" fontSize="10" fontFamily="var(--sans)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>PLC portfolio founder</text> : null}
        </g>)}
      </svg>
    </div>
    {active && activeReading && <div className="route-hover" role="status"
      style={at ? { left: Math.max(8, Math.min(at.x - 24, at.w - 448)), top: at.y + 18, bottom: 'auto', pointerEvents: 'none' } : undefined}>
      <b>{active.fromName ?? fromName} → {active.hops.map((h) => h.toName).join(' → ')}</b>
      <p><b>{activeReading.provisional ? 'Unscored route' : `${Number((activeReading.score / 20).toFixed(2))}/5 route score`}</b> · grades {active.hops.map((hop) => hop.edge.tier).join(' ')} · {VERDICT_LABEL[active.verdict]}</p>
      {activeArc && <p>{activeArc.routeIndices.length} {activeArc.routeIndices.length === 1 ? 'route shares' : 'routes share'} this relationship · {activeArc.edgeIds.length} {activeArc.edgeIds.length === 1 ? 'evidence edge' : 'evidence edges'}. The arc labels the strongest recorded tie.</p>}
      <p>{active.reasons.join(' ')}</p>
      {activeReading.factors.slice(0, 3).map((f, i) => <p key={i}>{f.label}: {f.value} · {f.basis}</p>)}
      <small>Activate the arc to open a route and its evidence in the list. Escape dismisses this card.</small>
    </div>}
    <p className="route-map-key">Possible matching records share one node; identities remain unmerged. Hop score /5 first, grade second · one arrow per relationship · thicker = stronger tie · dashed = all routes held or unavailable. Hover or focus an arc for details.</p>
  </div>;
}
