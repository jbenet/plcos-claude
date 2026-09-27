'use client';

import { useState } from 'react';
import type { Network, NetNode } from '@/lib/lenses-client';
import { LINK_STATE_LABEL } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { Pager, PagedRows, usePage } from './Paging';
import { compactUsd } from './shared';

const clusterOf = (node: NetNode) => node.role === 'target' ? `Pursuits · ${node.vehicleName}` : node.role === 'owner' ? 'Team' : 'Connectors';
export function NetworkView({ network }: { network: Network }) {
  const { select } = useFloor();
  const [cluster, setCluster] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [strength, setStrength] = useState('all');
  const byId = new Map(network.nodes.map(n => [n.id, n]));
  const clusters = [...new Set(network.nodes.map(clusterOf))];
  const nodes = network.nodes.filter(n => (!cluster || clusterOf(n) === cluster) && n.name.toLowerCase().includes(query.toLowerCase()));
  const links = network.links.filter(l => (!focus || l.from === focus || l.to === focus)
    && (strength === 'all' || l.state === strength)
    && (!cluster || [byId.get(l.from), byId.get(l.to)].some(n => n && clusterOf(n) === cluster))
    && (!query || [byId.get(l.from), byId.get(l.to)].some(n => n?.name.toLowerCase().includes(query.toLowerCase()))));
  const paths = network.paths.filter(p => {
    const ids = [p.fromId, p.viaId, `t:${p.targetKey}`];
    return (!focus || ids.includes(focus)) && (strength === 'all' || p.state === strength)
      && (!cluster || ids.some(id => { const node = byId.get(id); return node && clusterOf(node) === cluster; }))
      && (!query || p.label.toLowerCase().includes(query.toLowerCase()));
  });
  const edges = usePage(links, 12);
  const inspect = (node: NetNode) => {
    setFocus(node.id); edges.setPage(0);
    if (node.role === 'target') select({ kind: 'item', key: node.id.slice(2) });
  };
  return <div className="vizsummary">
    <p>Recorded network preview grouped by role and vehicle. Expand a group, then a person or organization, to inspect its neighborhood. At most twelve edges are drawn at once; every preview edge remains available below.</p>
    <p className="cover">{network.note} <a href="/routes">Search warm routes</a> for paths beyond this preview.</p>
    <div className="vizbins">{clusters.map(c => <button className="vizcell" key={c} aria-pressed={cluster === c} onClick={() => { setCluster(cluster === c ? null : c); setFocus(null); edges.setPage(0); }}><span>{c}</span><b>{network.nodes.filter(n => clusterOf(n) === c).length}</b><small>Expand group</small></button>)}</div>
    <div className="vizpager"><label>Find node <input type="search" value={query} onChange={e => { setQuery(e.target.value); setFocus(null); edges.setPage(0); }} /></label>
      <label>Edge evidence <select value={strength} onChange={e => { setStrength(e.target.value); edges.setPage(0); }}><option value="all">All evidence</option>{Object.entries(LINK_STATE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button className="btn" onClick={() => { setCluster(null); setFocus(null); setQuery(''); setStrength('all'); edges.setPage(0); }}>Reset network</button>
    </div>
    {(cluster || query) && <PagedRows key={`${cluster}:${query}`} rows={nodes} label="nodes">{page => <div className="vizbins">{page.map(n => <button key={n.id} className="vizcell" aria-pressed={focus === n.id} onClick={() => inspect(n)}><b>{n.name}</b><small>{n.note} · {n.actions} actions · {compactUsd(n.amount)}</small></button>)}</div>}</PagedRows>}
    <h3>{focus ? `Neighborhood of ${byId.get(focus)?.name}` : 'Recorded edges'} · {links.length}</h3>
    <Pager {...edges} label="edges in this preview" />
    {!!edges.rows.length && <svg className="flsvg viznetwork" viewBox={`0 0 1000 ${edges.rows.length * 38 + 20}`} role="img" aria-label="Current page of edges; the table below contains the same endpoints and evidence">
      {edges.rows.map((l, i) => <g key={i}><text x="10" y={i * 38 + 27} fill="var(--ink)" fontSize="12">{byId.get(l.from)?.name}</text><line x1="330" x2="640" y1={i * 38 + 23} y2={i * 38 + 23} stroke={l.state === 'restricted' ? 'var(--clay)' : 'var(--muted)'} strokeDasharray={l.state === 'unconfirmed' ? '5 4' : undefined} /><text x="480" y={i * 38 + 17} textAnchor="middle" fill="var(--ink)" fontSize="10">{l.tier ?? 'Ask'} · {l.state}</text><text x="660" y={i * 38 + 27} fill="var(--ink)" fontSize="12">{byId.get(l.to)?.name}</text></g>)}
    </svg>}
    <table className="list"><thead><tr><th>From</th><th>To</th><th>Evidence</th></tr></thead><tbody>{edges.rows.map((l, i) => <tr key={i}><td><button className="covname" onClick={() => inspect(byId.get(l.from)!)}>{byId.get(l.from)?.name}</button></td><td><button className="covname" onClick={() => inspect(byId.get(l.to)!)}>{byId.get(l.to)?.name}</button></td><td>{LINK_STATE_LABEL[l.state]} · tier {l.tier ?? 'not applicable'} · strength {l.weight}. {l.why}</td></tr>)}</tbody></table>
    {!links.length && <p>No matching edges in this preview. This is not evidence that no route exists; broaden these filters or search warm routes.</p>}
    <details><summary>Recorded two-edge paths in this filtered preview ({paths.length})</summary><PagedRows key={`${cluster}:${focus}:${strength}:${query}`} rows={paths} label="preview paths">{page => <ul>{page.map((p, i) => <li key={i}>{p.label} · {LINK_STATE_LABEL[p.state]} · {p.why}</li>)}</ul>}</PagedRows></details>
  </div>;
}
