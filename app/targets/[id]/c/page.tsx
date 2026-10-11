import Link from '@/components/ui/AppLink';
import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { shortDate } from '@/lib/time';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { loadLp } from '../_lp/lp-data';
import { AcceptNext, Clip, DesignBar, Facts, Feed, Ladder, Routes, StrategyShort } from '../_lp/parts';
import { STATUS_LABEL } from '@/lib/authz/read/strategy';
import s from '../_lp/lp.module.css';

export const dynamic = 'force-dynamic';

/**
 * Design C, dossier (11 Oct 2026, docs/strategy/lp-pages.md): the same fixed rows on every LP, one line each, and
 * each row opens its detail in place. No prose. A trial beside the current page; it reads the same records.
 */
const LEVEL: Record<string, string> = { high: 'high', medium: 'medium', low: 'low', unknown: '?' };

async function DesignC({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadLp(id);
  const p = d.pursuit;
  const st = d.strategy?.data ?? null;
  const next = p.nextStep ?? st?.next.what ?? null;
  const restricted = d.restrictions.map((r) => r.scope === 'blanket' ? 'Do not approach' : r.scope === 'channel' ? `Not by ${r.channel ?? 'this channel'}` : `Not through ${r.connectorName ?? 'a connector'}`);
  const watch = [...restricted, ...(d.kind === 'spv' && d.spv?.stance === 'does-not' ? ['Doesn’t do SPVs'] : []), ...(d.needsEvidence ? ['Needs evidence'] : []), ...(st?.risks ?? [])];

  return (
    <Page crumbs={[{ label: p.vehicleName, href: '/overview' }, { label: 'Pipeline', href: `/targets?status=${p.status}` }, { label: p.entityName }]}>
      <DesignBar id={p.pursuitId} current="c" />
      <div className={s.crumb}>{p.vehicleName}</div>
      <h1 className={s.name} style={{ marginBottom: 12 }}><Link href={`/orgs/${p.entityId}`}>{p.entityName}</Link></h1>
      <section className="card">
        <table className={s.dossier}>
          <tbody>
            <tr><th>Status</th><td>{STATUS_LABEL[p.status]} <Ladder rung={p.rung} /> <span className={s.m}>· {p.statusSource === 'us' ? 'set here' : `Affinity “${p.stageSaid ?? '?'}”`}</span></td></tr>
            <tr><th>Next</th><td>{next ? <details><summary><b>{next.length > 90 ? `${next.slice(0, 88)}…` : next}</b>{p.nextStepOn ? <span className={s.m}> · {shortDate(p.nextStepOn)}</span> : st && !p.nextStep ? <span className={s.m}> · {st.next.who}, {st.next.when} · suggested</span> : null}</summary><div>{next}</div><AcceptNext d={d} /></details> : <span className={s.m}>None set</span>}</td></tr>
            <tr><th>Last word</th><td><details><summary>{d.owes?.by === 'us' ? <b style={{ color: 'var(--clay)' }}>We owe a reply · {shortDate(d.owes.since)}</b> : d.owes?.by === 'them' ? <>They owe a reply · {shortDate(d.owes.since)}</> : <span className={s.m}>Nobody owes{d.summary.lastTouch ? ` · last ${shortDate(d.summary.lastTouch)}` : ''}</span>}<span className={s.m}> · {d.feed.length} on record</span></summary><Feed d={d} limit={12} /></details></td></tr>
            <tr><th>Way in</th><td><details><summary>{d.best ? <><span className={`tier t${d.best.weakestTier}`} style={{ display: 'inline-grid', width: 20, height: 20, verticalAlign: 'middle' }}>{d.best.weakestTier}</span> {[d.best.fromName ?? d.routes?.fromName, ...d.best.hops.map((h) => h.toName)].filter(Boolean).join(' → ')}</> : <span className={s.m}>No route found</span>}<span className={s.m}> · {d.routeList.length} routes</span></summary><Routes d={d} limit={8} /></details></td></tr>
            <tr><th>Ask</th><td>{st ? <>{st.ask.shape}{st.ask.range ? ` · ${st.ask.range}` : ''} <span className={s.m}>· {st.list} · confidence {st.confidence}</span></> : <span className={s.m}>No strategy yet</span>}</td></tr>
            <tr><th>Money</th><td>{d.money.length ? d.money.join(' · ') : <span className={s.m}>Nothing recorded</span>}</td></tr>
            {st && <tr><th>Fit</th><td>Capacity {capacityBandLabel(st.scores.capacity.band)} · affinity {LEVEL[st.scores.affinity.level]} · propensity {LEVEL[st.scores.propensity.level]} · timing {st.scores.timeToDecision.band}</td></tr>}
            {st && <tr><th>Why</th><td><details><summary><Clip text={st.angle} /></summary>{d.strategy && <StrategyShort d={d} pursuitId={p.pursuitId} vehicleName={p.vehicleName} data={st} status={d.strategy.status} madeBy={d.strategy.madeBy} madeAt={d.strategy.madeAt} />}</details></td></tr>}
            <tr><th>Who</th><td><details><summary>{p.headline ? <Clip text={p.headline} /> : <span className={s.m}>{d.claims.length} facts on file</span>}</summary><Facts d={d} limit={12} /></details></td></tr>
            {watch.length > 0 && <tr><th>Watch</th><td><details><summary style={{ color: restricted.length ? 'var(--clay)' : undefined }}>{watch[0]!.length > 80 ? `${watch[0]!.slice(0, 78)}…` : watch[0]}{watch.length > 1 ? <span className={s.m}> · +{watch.length - 1}</span> : null}</summary><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{watch.map((w, i) => <li key={i}>{w}</li>)}</ul></details></td></tr>}
            {d.others.length > 0 && <tr><th>Other vehicles</th><td>{d.others.map((o, i) => <span key={o.pursuitId}>{i > 0 ? ' · ' : ''}<Link href={`/targets/${o.pursuitId}/c`}>{o.name}</Link> <span className={s.m}>{o.status}</span></span>)}</td></tr>}
            <tr><th>Do</th><td><Link href={`/targets/${p.pursuitId}/a?tab=email`}>Draft email</Link> · <Link href={`/targets/${p.pursuitId}#timeline`}>Log update</Link> · <Link href={`/targets/${p.pursuitId}/a?tab=research`}>Research</Link></td></tr>
          </tbody>
        </table>
      </section>
    </Page>
  );
}

export default coalescePage('/targets/[id]/c', DesignC);
