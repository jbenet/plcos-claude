'use client';

import { useMemo, useState } from 'react';
import type { LinkState, NetLink, NetNode, Network } from '@/lib/lenses-client';
import { LINK_STATE_LABEL } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { n } from './scale';
import { compactUsd, initials, shortName } from './shared';
import s from './floor.module.css';

/**
 * View 11 — the network.
 *
 * Us on the left, the people who could carry an ask in the middle, the money on the right.
 * A line is a **recorded** edge or an ask somebody actually carried; a dashed line is weaker
 * evidence (tier C or D), and a clay line is a restriction standing in the way.
 *
 * The thing this view refuses to do is imply reach it cannot evidence. Two people at the
 * same conference are not a path, and a path drawn at full confidence is worse than no
 * drawing at all — somebody will plan a quarter around it.
 *
 * At volume (issue 0066) there are two thousand pursuits and dozens of connectors, and a line
 * to each is a hairball. So the middle column is the connectors who reach the most pursuits,
 * ranked, with how many each reaches; the right column is the pursuits with the most
 * confirmed lines into them, largest cheque breaking ties; everything else is counted, not
 * drawn. Selecting anyone redraws the columns around them. The table under the drawing holds
 * every connector-to-pursuit line in this preview.
 */

const W = 1000;
const OWNER_X = 30;
const ADV_X = 330;
const TGT_X = 660;
const ROW = 32;
const TOP = 40;
const ADVOCATES = 10;
const TARGETS = 12;

const STATE_RANK: Record<LinkState, number> = { confirmed: 0, unconfirmed: 1, restricted: 2 };

export function NetworkView({ network }: { network: Network }) {
  const { select } = useFloor();
  const [focus, setFocus] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<LinkState | 'all'>('all');

  const byId = useMemo(() => new Map(network.nodes.map((x) => [x.id, x])), [network.nodes]);
  const owners = network.nodes.filter((x) => x.role === 'owner');
  const teamLinks = network.links.filter((l) => l.from.startsWith('u:'));
  /** Connector → pursuit: the lines that answer "who can carry an ask to whom". */
  const reach = network.links.filter((l) => l.from.startsWith('a:') && l.to.startsWith('t:')
    && (evidence === 'all' || l.state === evidence));

  const reachOf = useMemo(() => {
    const m = new Map<string, NetLink[]>();
    for (const l of reach) { const b = m.get(l.from); if (b) b.push(l); else m.set(l.from, [l]); }
    return m;
  }, [reach]);
  const intoTarget = useMemo(() => {
    const m = new Map<string, NetLink[]>();
    for (const l of reach) { const b = m.get(l.to); if (b) b.push(l); else m.set(l.to, [l]); }
    return m;
  }, [reach]);

  const focusNode = focus ? byId.get(focus) ?? null : null;
  const confirmedCount = (ls: NetLink[]) => ls.filter((l) => l.state === 'confirmed').length;

  // The middle column: connectors ranked by how many pursuits they reach, or, with a focus,
  // the ones touching it.
  // A line whose end is not in this preview's nodes cannot be drawn or named; the table still lists it.
  const allAdvocates = [...reachOf.keys()].filter((id) => byId.has(id))
    .sort((a, b) => reachOf.get(b)!.length - reachOf.get(a)!.length
      || confirmedCount(reachOf.get(b)!) - confirmedCount(reachOf.get(a)!)
      || (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));
  const advocateIds = !focusNode ? allAdvocates
    : focusNode.role === 'advocate' ? [focusNode.id]
    : focusNode.role === 'owner' ? allAdvocates.filter((a) => teamLinks.some((l) => l.from === focusNode.id && l.to === a))
    : (intoTarget.get(focusNode.id) ?? []).map((l) => l.from).filter((a, i, all) => all.indexOf(a) === i && byId.has(a));
  const advocates = advocateIds.slice(0, ADVOCATES);
  const advocatesHidden = advocateIds.length - advocates.length;

  // The right column: pursuits reached through the drawn connectors, most confirmed first.
  const targetPool = new Map<string, NetLink[]>();
  for (const a of focusNode?.role === 'target' ? advocateIds : advocates) {
    for (const l of reachOf.get(a) ?? []) {
      if (focusNode?.role === 'target' && l.to !== focusNode.id) continue;
      const b = targetPool.get(l.to); if (b) b.push(l); else targetPool.set(l.to, [l]);
    }
  }
  const targetIds = [...targetPool.keys()].filter((id) => byId.has(id)).sort((a, b) =>
    STATE_RANK[bestState(targetPool.get(a)!)] - STATE_RANK[bestState(targetPool.get(b)!)]
    || targetPool.get(b)!.length - targetPool.get(a)!.length
    || (byId.get(b)?.amount ?? -1) - (byId.get(a)?.amount ?? -1)
    || (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));
  const targets = targetIds.slice(0, TARGETS);
  const targetsHidden = targetIds.length - targets.length;

  const allTargets = network.nodes.filter((x) => x.role === 'target');
  const reachedTargets = intoTarget.size;
  const unreached = allTargets.length - reachedTargets;

  const rows = Math.max(owners.length, advocates.length + (advocatesHidden ? 1 : 0), targets.length + (targetsHidden ? 1 : 0), 3);
  const height = TOP + rows * ROW + 16;
  const pos = new Map<string, { x: number; y: number }>();
  owners.forEach((o, i) => pos.set(o.id, { x: OWNER_X, y: TOP + i * ROW + ROW / 2 }));
  advocates.forEach((a, i) => pos.set(a, { x: ADV_X, y: TOP + i * ROW + ROW / 2 }));
  targets.forEach((t, i) => pos.set(t, { x: TGT_X, y: TOP + i * ROW + ROW / 2 }));

  const drawn = [
    ...teamLinks.filter((l) => pos.has(l.from) && pos.has(l.to)),
    ...reach.filter((l) => pos.has(l.from) && pos.has(l.to)),
  ];
  const lit = (id: string) => !focus || id === focus
    || drawn.some((l) => (l.from === focus && l.to === id) || (l.to === focus && l.from === id));

  const onNode = (node: NetNode) => {
    setFocus(focus === node.id ? null : node.id);
    if (node.role === 'owner') select({ kind: 'person', name: node.name });
    else if (node.role === 'target') select({ kind: 'item', key: node.id.slice(2) });
    else {
      const theirs = reachOf.get(node.id) ?? [];
      select({
        kind: 'note',
        title: node.name,
        lines: [
          { label: 'Role', value: node.note },
          { label: 'Asks carried', value: String(node.actions) },
          { label: 'Reaches', value: `${n(theirs.length)} pursuits in this preview, ${n(confirmedCount(theirs))} with permission or evidence on file` },
        ],
      });
    }
  };
  const key = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

  // The list: every connector → pursuit line, confirmed first, in the current focus.
  const listLinks = useMemo(() => {
    const inFocus = !focusNode ? reach
      : focusNode.role === 'advocate' ? reach.filter((l) => l.from === focusNode.id)
      : focusNode.role === 'target' ? reach.filter((l) => l.to === focusNode.id)
      : reach.filter((l) => teamLinks.some((t) => t.from === focusNode.id && t.to === l.from));
    return [...inFocus].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]
      || (byId.get(b.to)?.amount ?? -1) - (byId.get(a.to)?.amount ?? -1)
      || (byId.get(a.to)?.name ?? '').localeCompare(byId.get(b.to)?.name ?? ''));
  }, [reach, focusNode, teamLinks, byId]);
  const teamFor = (advocate: string) => [...new Set(teamLinks.filter((l) => l.to === advocate).map((l) => byId.get(l.from)?.name).filter(Boolean))].join(', ');

  return (
    <div className={`floordark netview ${s.dark}`}>
      <div className={s.netbar}>
        <div className={s.chips} role="group" aria-label="Which lines">
          {(['all', 'confirmed', 'unconfirmed', 'restricted'] as const).map((st) => (
            <button key={st} className={s.chip} aria-pressed={evidence === st} onClick={() => setEvidence(st)}>
              {st === 'all' ? 'Every recorded line' : st === 'confirmed' ? 'Permission or evidence' : st === 'unconfirmed' ? 'Weaker, tier C or D' : 'Restricted'}
              <b>{n(st === 'all' ? network.links.filter((l) => l.from.startsWith('a:') && l.to.startsWith('t:')).length
                : network.links.filter((l) => l.from.startsWith('a:') && l.to.startsWith('t:') && l.state === st).length)}</b>
            </button>
          ))}
        </div>
        {focusNode && (
          <button className={s.chip} onClick={() => setFocus(null)}>Showing {shortName(focusNode.name, 28)} · show everyone</button>
        )}
      </div>

      <div className={s.wide}><svg viewBox={`0 0 ${W} ${height}`} className="flsvg" role="img"
           aria-label="Who can carry an ask to whom, and which lines are confirmed. The table below lists every line.">
        <text x={2} y={16} className="flsh" fill="var(--fl-muted)">TEAM</text>
        <text x={ADV_X - 12} y={16} className="flsh" fill="var(--fl-muted)">
          WHO COULD CARRY IT · {n(allAdvocates.length)} REACH SOMEONE
        </text>
        <text x={TGT_X - 12} y={16} className="flsh" fill="var(--fl-muted)">
          PURSUITS · {n(reachedTargets)} OF {n(allTargets.length)} HAVE A LINE
        </text>

        {drawn.map((l, i) => {
          const a = pos.get(l.from)!;
          const b = pos.get(l.to)!;
          const x1 = a.x + (l.from.startsWith('u:') ? 150 : 250);
          const x2 = b.x - 12;
          const mx = (x1 + x2) / 2;
          return (
            <path key={i}
                  className={`netlink s-${l.state}${!focus || l.from === focus || l.to === focus ? '' : ' dim'}`}
                  strokeWidth={0.6 + l.weight * 1.8}
                  d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`}>
              <title>{`${byId.get(l.from)?.name} → ${byId.get(l.to)?.name}\n${LINK_STATE_LABEL[l.state]}\n${l.why}`}</title>
            </path>
          );
        })}

        {owners.map((o) => {
          const p = pos.get(o.id)!;
          const mine = teamLinks.filter((l) => l.from === o.id).length;
          return (
            <g key={o.id} className={`netnode${lit(o.id) ? '' : ' dim'}${focus === o.id ? ' on' : ''}`}
               role="button" tabIndex={0} aria-label={`${o.name}: ${o.actions} in flight`}
               onClick={() => onNode(o)} onKeyDown={key(() => onNode(o))}>
              <title>{`${o.name} · ${o.note}\n${o.actions} in flight · ${mine} recorded lines to connectors`}</title>
              <rect x={p.x - 12} y={p.y - 12} width={162} height={24} rx={12} className="netpill r-owner" />
              <circle cx={p.x} cy={p.y} r={9} className="netdot r-owner" />
              <text x={p.x} y={p.y + 3.2} className="netini" textAnchor="middle">{initials(o.name)}</text>
              <text x={p.x + 15} y={p.y - 1} className="netname">{shortName(o.name, 20)}</text>
              <text x={p.x + 15} y={p.y + 8} className="netnote">{n(o.actions)} in flight · {n(mine)} lines</text>
            </g>
          );
        })}

        {advocates.map((id) => {
          const a = byId.get(id)!;
          const p = pos.get(id)!;
          const theirs = reachOf.get(id) ?? [];
          return (
            <g key={id} className={`netnode${lit(id) ? '' : ' dim'}${focus === id ? ' on' : ''}`}
               role="button" tabIndex={0} aria-label={`${a.name}: reaches ${theirs.length} pursuits`}
               onClick={() => onNode(a)} onKeyDown={key(() => onNode(a))}>
              <title>{`${a.name} · ${a.note}\nReaches ${theirs.length} pursuits, ${confirmedCount(theirs)} confirmed`}</title>
              <rect x={p.x - 12} y={p.y - 12} width={262} height={24} rx={12} className="netpill r-advocate" />
              <circle cx={p.x} cy={p.y} r={9} className="netdot r-advocate" />
              <text x={p.x} y={p.y + 3.2} className="netini" textAnchor="middle">{initials(a.name)}</text>
              <text x={p.x + 15} y={p.y - 1} className="netname">{shortName(a.name, 24)}</text>
              <text x={p.x + 15} y={p.y + 8} className="netnote">{a.note}</text>
              <text x={p.x + 244} y={p.y + 3.5} className={s.netcount} textAnchor="end">{n(theirs.length)}</text>
            </g>
          );
        })}
        {advocatesHidden > 0 && (
          <text x={ADV_X} y={TOP + advocates.length * ROW + ROW / 2 + 3} className="netnote">
            +{n(advocatesHidden)} more connectors · in the table below
          </text>
        )}

        {targets.map((id) => {
          const t = byId.get(id)!;
          const p = pos.get(id)!;
          const into = targetPool.get(id)!;
          const state = bestState(into);
          return (
            <g key={id} className={`netnode${lit(id) ? '' : ' dim'}${focus === id ? ' on' : ''}`}
               role="button" tabIndex={0} aria-label={`${t.name}: ${into.length} lines, ${LINK_STATE_LABEL[state]}`}
               onClick={() => onNode(t)} onKeyDown={key(() => onNode(t))}>
              <title>{`${t.name} · ${t.vehicleName}\n${t.note}\n${compactUsd(t.amount)} · ${into.length} lines drawn`}</title>
              <rect x={p.x - 12} y={p.y - 12} width={W - TGT_X + 6} height={24} rx={12} className="netpill" />
              <circle cx={p.x} cy={p.y} r={9} className={`netdot r-target${t.actions ? ' blocked' : ''}`} />
              <text x={p.x} y={p.y + 3.2} className="netini" textAnchor="middle">{initials(t.name)}</text>
              <text x={p.x + 15} y={p.y - 1} className="netname">{shortName(t.name, 26)}</text>
              <text x={p.x + 15} y={p.y + 8} className="netnote">{shortName(t.note, 44)}</text>
              <text x={W - 12} y={p.y + 3.5} className={s.netcount} textAnchor="end">{compactUsd(t.amount)}</text>
            </g>
          );
        })}
        {targetsHidden > 0 && (
          <text x={TGT_X} y={TOP + targets.length * ROW + ROW / 2 + 3} className="netnote">
            +{n(targetsHidden)} more reached through {focusNode ? 'this selection' : 'these connectors'} · in the table below
          </text>
        )}
        {targets.length === 0 && (
          <text x={TGT_X} y={TOP + ROW / 2 + 3} className="netnote">No recorded line reaches a pursuit here.</text>
        )}
      </svg></div>

      <p className={s.netnote}>
        <b>{n(unreached)} of {n(allTargets.length)} pursuits have no recorded line in this preview.</b>{' '}
        That is a statement about our records, not about their network. {network.note}{' '}
        <a href="/routes">Search warm routes</a> for paths beyond this preview.
      </p>

      <div className="fllegend">
        <span>Solid = permission or evidence on file</span>
        <span>Dashed = weaker evidence, tier C or D</span>
        <span><i className="sw" style={{ background: 'var(--fl-clay)' }} /> restriction in the way</span>
        <span>Line width = recorded tie strength, not affection</span>
        <span>The number on a connector = pursuits they reach</span>
        <span>Select anyone to redraw around them</span>
      </div>

      <div className={s.lightpanel}>
        <div className={s.listhead}>
          <h3>Every line from a connector to a pursuit</h3>
          <span>{focusNode ? `Touching ${focusNode.name}` : 'Everyone in this preview'} · confirmed first, then the largest cheque</span>
        </div>
        <PagedRows key={`${focus}:${evidence}`} rows={listLinks} size={12} label="lines" quiet>{(page) => (
          <div className="scroller">
            <table className="list">
              <thead><tr><th>Connector</th><th>Pursuit</th><th>Our side</th><th>Evidence</th></tr></thead>
              <tbody>{page.map((l, i) => {
                const a = byId.get(l.from);
                const t = byId.get(l.to);
                return (
                  <tr key={`${l.from}-${l.to}-${i}`}>
                    <td>{a && <button className="covname" onClick={() => onNode(a)}><b>{a.name}</b></button>}</td>
                    <td>{t && <button className="covname" onClick={() => onNode(t)}><b>{t.name}</b></button>}<div className="muted">{t?.vehicleName} · {compactUsd(t?.amount ?? null)}</div></td>
                    <td>{teamFor(l.from) || <span className="muted">No recorded line from the team</span>}</td>
                    <td>{LINK_STATE_LABEL[l.state]}{l.tier ? ` · tier ${l.tier}` : ''}<div className="muted">{l.why}</div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}</PagedRows>
        {listLinks.length === 0 && <p className="muted">No recorded line matches. That is not evidence that no route exists; search warm routes.</p>}
      </div>
    </div>
  );
}

function bestState(links: NetLink[]): LinkState {
  return links.reduce<LinkState>((best, l) => (STATE_RANK[l.state] < STATE_RANK[best] ? l.state : best), 'restricted');
}
