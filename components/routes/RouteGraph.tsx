import type { Route } from '@/modules/network/client';

const VERDICT_COLOR: Record<string, string> = {
  recommend: 'var(--green)',
  hold: 'var(--amber)',
  not_a_route: '#B8B2A6',
  excluded: 'var(--clay)',
};

/**
 * The canvas. It is the second presentation, not the first — the path list beside it
 * carries the same information, is keyboard-navigable, and is what this screen is
 * designed around. Selecting a path in either one highlights it in both.
 */
export function RouteGraph({
  routes, fromName, targetName, selected,
}: {
  routes: Route[];
  fromName: string;
  targetName: string;
  selected: number;
}) {
  const maxHops = Math.max(1, ...routes.map((r) => r.hops.length));
  const colX = (i: number) => 76 + (i * 480) / maxHops;
  const rowY = (i: number) => 44 + i * 64;
  const height = Math.max(180, rowY(routes.length - 1) + 44);
  const targetX = colX(maxHops);

  return (
    <svg
      viewBox={`0 0 660 ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Route graph from ${fromName} to ${targetName}. The path list beside this carries the same information.`}
      style={{ display: 'block' }}
    >
      <text x={8} y={rowY(Math.floor((routes.length - 1) / 2)) + 4} className="gn gme" fontSize="11">
        {fromName}
      </text>
      <circle cx={58} cy={rowY(Math.floor((routes.length - 1) / 2))} r={5} fill="var(--ink)" />

      {routes.map((route, ri) => {
        const y = rowY(ri);
        const on = ri === selected;
        const colour = VERDICT_COLOR[route.verdict] ?? 'var(--muted)';
        const mid = rowY(Math.floor((routes.length - 1) / 2));
        const points = [
          { x: 58, y: mid },
          ...route.hops.slice(0, -1).map((_, i) => ({ x: colX(i + 1), y })),
          { x: targetX, y: mid },
        ];
        return (
          <g key={ri} opacity={on ? 1 : 0.42}>
            {points.slice(0, -1).map((p, i) => {
              const q = points[i + 1]!;
              const hop = route.hops[i];
              return (
                <g key={i}>
                  <path
                    d={`M ${p.x} ${p.y} C ${(p.x + q.x) / 2} ${p.y}, ${(p.x + q.x) / 2} ${q.y}, ${q.x} ${q.y}`}
                    fill="none"
                    stroke={colour}
                    strokeWidth={on ? 2 : 1.25}
                    strokeDasharray={route.verdict === 'not_a_route' || route.verdict === 'excluded' ? '4 3' : undefined}
                  />
                  {hop && (
                    <text
                      x={(p.x + q.x) / 2}
                      y={(p.y + q.y) / 2 - 5}
                      textAnchor="middle"
                      fontFamily="var(--mono)"
                      fontSize="9"
                      fill={colour}
                    >
                      {hop.edge.tier}
                    </text>
                  )}
                </g>
              );
            })}
            {route.hops.slice(0, -1).map((hop, i) => (
              <g key={hop.edge.edgeId}>
                <circle cx={colX(i + 1)} cy={y} r={on ? 5 : 4} fill={colour} />
                <text
                  x={colX(i + 1)}
                  y={y - 11}
                  textAnchor="middle"
                  fontFamily="var(--sans)"
                  fontSize="10.5"
                  fill="var(--ink)"
                >
                  {hop.toName}
                </text>
              </g>
            ))}
          </g>
        );
      })}

      <circle cx={targetX} cy={rowY(Math.floor((routes.length - 1) / 2))} r={6} fill="var(--clay)" />
      <text
        x={targetX + 12}
        y={rowY(Math.floor((routes.length - 1) / 2)) + 4}
        fontFamily="var(--sans)"
        fontSize="11"
        fill="var(--ink)"
      >
        {targetName}
      </text>
    </svg>
  );
}
