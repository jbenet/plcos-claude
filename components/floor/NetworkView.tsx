'use client';

import { useMemo, useState } from 'react';
import type { Network } from '@/lib/lenses-client';
import { LINK_STATE_LABEL } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { initials, shortName } from './shared';

/**
 * View 11 — the network.
 *
 * Us on the left, the people who could carry an ask in the middle, the money on the right.
 * A line is a **recorded** edge or an ask somebody actually carried; a dashed line is a clue
 * that has not been confirmed, and a clay line is a restriction standing in the way.
 *
 * The thing this view refuses to do is imply reach it cannot evidence. Two people at the
 * same conference are not a path, and a path drawn at full confidence is worse than no
 * drawing at all — somebody will plan a quarter around it.
 */

const W = 1000;
const OWNER_X = 74;
const ADVOCATE_X = 300;
const TARGET_X0 = 560;
const ROW = 34;
const PAD = 26;

export function NetworkView({ network }: { network: Network }) {
  const { select } = useFloor();
  const [focus, setFocus] = useState<string | null>(null);

  const owners = network.nodes.filter((n) => n.role === 'owner');
  const advocates = network.nodes.filter((n) => n.role === 'advocate');
  const targets = network.nodes.filter((n) => n.role === 'target');
  const vehicles = [...new Set(targets.map((t) => t.vehicleName ?? '—'))];

  const pos = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>();
    owners.forEach((o, i) => p.set(o.id, { x: OWNER_X, y: PAD + 30 + i * ROW }));
    advocates.forEach((a, i) => p.set(a.id, { x: ADVOCATE_X, y: PAD + 30 + i * ROW }));
    let y = PAD + 22;
    const perRow = 7;
    const boxes: Array<{ name: string; top: number; height: number; count: number }> = [];
    for (const v of vehicles) {
      const mine = targets.filter((t) => (t.vehicleName ?? '—') === v);
      const rows = Math.ceil(mine.length / perRow);
      const height = rows * 46 + 26;
      mine.forEach((t, i) => p.set(t.id, {
        x: TARGET_X0 + 30 + (i % perRow) * 56,
        y: y + 34 + Math.floor(i / perRow) * 46,
      }));
      boxes.push({ name: v, top: y, height, count: mine.length });
      y += height + 10;
    }
    return { p, boxes, bottom: y };
  }, [owners, advocates, targets, vehicles]);

  const height = Math.max(
    pos.bottom + PAD,
    PAD + 40 + Math.max(owners.length, advocates.length) * ROW,
  );

  const lit = (id: string) => {
    if (!focus) return true;
    if (id === focus) return true;
    return network.links.some((l) => (l.from === focus && l.to === id) || (l.to === focus && l.from === id));
  };
  const linkLit = (from: string, to: string) => !focus || from === focus || to === focus;

  const onNode = (id: string) => {
    setFocus(focus === id ? null : id);
    const node = network.nodes.find((n) => n.id === id)!;
    if (node.role === 'owner') select({ kind: 'person', name: node.name });
    else if (node.role === 'target') select({ kind: 'item', key: id.slice(2) });
    else {
      const theirs = network.paths.filter((p) => p.advocate === node.name);
      select({
        kind: 'note',
        title: node.name,
        lines: [
          { label: 'Role', value: node.note },
          { label: 'Asks carried', value: String(node.actions) },
          ...(theirs.length === 0
            ? [{ label: 'Paths', value: 'No recorded path runs through them yet.' }]
            : theirs.map((p) => ({ label: p.state, value: `${p.label} — ${p.why}` }))),
        ],
      });
    }
  };

  return (
    <div className="floordark netview">
      <svg viewBox={`0 0 ${W} ${height}`} className="flsvg" role="img"
           aria-label="Who can carry an ask to whom, and which paths are confirmed">
        <text x={2} y={16} className="flsh" fill="var(--fl-muted)">TEAM</text>
        <text x={ADVOCATE_X - 26} y={16} className="flsh" fill="var(--fl-muted)">WHO COULD CARRY IT</text>
        <text x={TARGET_X0} y={16} className="flsh" fill="var(--fl-muted)">TARGETS · SIZE IS THE POTENTIAL CHEQUE</text>

        {pos.boxes.map((b) => (
          <g key={b.name}>
            <rect x={TARGET_X0} y={b.top} width={W - TARGET_X0 - 4} height={b.height}
                  rx={7} className="netbox" />
            <text x={TARGET_X0 + 8} y={b.top + 15} className="netv">{b.name}</text>
            <text x={W - 10} y={b.top + 15} className="flls" textAnchor="end" fill="var(--fl-muted)">
              {b.count} pursuits
            </text>
          </g>
        ))}

        {network.links.map((l, i) => {
          const a = pos.p.get(l.from);
          const b = pos.p.get(l.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={i}
              className={`netlink s-${l.state}${linkLit(l.from, l.to) ? '' : ' dim'}`}
              strokeWidth={0.6 + l.weight * 1.8}
              d={`M${a.x + 12},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 12},${b.y}`}
            >
              <title>{`${LINK_STATE_LABEL[l.state]}\n${l.why}`}</title>
            </path>
          );
        })}

        {[...owners, ...advocates].map((n) => {
          const p = pos.p.get(n.id)!;
          return (
            <g key={n.id} className={`netnode${lit(n.id) ? '' : ' dim'}${focus === n.id ? ' on' : ''}`}
               onClick={() => onNode(n.id)}>
              <title>{`${n.name} · ${n.note}`}</title>
              <rect x={p.x - 12} y={p.y - 12} width={n.role === 'owner' ? 150 : 210} height={24}
                    rx={12} className={`netpill r-${n.role}`} />
              <circle cx={p.x} cy={p.y} r={9} className={`netdot r-${n.role}`} />
              <text x={p.x} y={p.y + 3.2} className="netini" textAnchor="middle">{initials(n.name)}</text>
              <text x={p.x + 15} y={p.y - 1} className="netname">{shortName(n.name, 20)}</text>
              <text x={p.x + 15} y={p.y + 8} className="netnote">
                {n.role === 'owner' ? `${n.actions} in flight` : shortName(n.note, 26)}
              </text>
            </g>
          );
        })}

        {targets.map((t) => {
          const p = pos.p.get(t.id)!;
          const top = Math.max(...targets.map((x) => x.amount ?? 0), 1);
          const r = 8 + Math.sqrt((t.amount ?? 0) / top) * 8;
          return (
            <g key={t.id} className={`netnode${lit(t.id) ? '' : ' dim'}${focus === t.id ? ' on' : ''}`}
               onClick={() => onNode(t.id)}>
              <title>{`${t.name} · ${t.vehicleName}\n${t.note}`}</title>
              <circle cx={p.x} cy={p.y} r={r} className={`netdot r-target${t.actions ? ' blocked' : ''}`} />
              <text x={p.x} y={p.y + 3.2} className="netini" textAnchor="middle">{initials(t.name)}</text>
              <text x={p.x} y={p.y + r + 9} className="netunder" textAnchor="middle">
                {shortName(t.name, 9)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="fllegend">
        <span>Solid = recorded edge or a carried ask</span>
        <span>Dashed = unconfirmed clue, tier C or D</span>
        <span><i className="sw" style={{ background: 'var(--fl-clay)' }} /> restriction in the way</span>
        <span>Line width = recorded tie strength, not affection</span>
        <span>Click anything to isolate its paths</span>
      </div>
    </div>
  );
}
