import Link from '@/components/ui/AppLink';
import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { shortDate } from '@/lib/time';
import { loadLp } from '../_lp/lp-data';
import { AcceptNext, Compose, DesignBar, Facts, Feed, Head, Info, Plan, Routes, Strategies } from '../_lp/parts';
import s from '../_lp/lp.module.css';

export const dynamic = 'force-dynamic';

/**
 * Design B, conversation first (11 Oct 2026, docs/strategy/lp-pages.md): the email trail is the record (Juan,
 * 5 Oct), so the thread leads and the plan, the checks and the facts sit in a narrow column beside it. A trial
 * beside the current page; it reads the same records.
 */
async function DesignB({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadLp(id);
  const p = d.pursuit;
  const path = `/targets/${p.pursuitId}/b`;
  return (
    <Page crumbs={[{ label: p.vehicleName, href: '/overview' }, { label: 'Pipeline', href: `/targets?status=${p.status}` }, { label: p.entityName }]}>
      <DesignBar id={p.pursuitId} current="b" />
      <Head d={d} />
      <div className={s.split}>
        <div>
          <section className="card">
            <div className="chead">
              <h2>{d.thread ? <Clip2 text={d.thread.subject ?? 'Thread'} /> : 'Contact'}</h2>
              <span className="lbl">{d.feed.length} on record{d.thread ? ` · ${d.thread.holder ?? 'nobody'} holds it` : ''}</span>
            </div>
            <div className={s.pad}>
              <Feed d={d} limit={25} />
              <p className={s.m} style={{ fontSize: 12, margin: '10px 0 0' }}><Link href={`/targets/${p.pursuitId}#timeline`}>Full timeline with notes</Link></p>
            </div>
          </section>
          <Compose d={d} path={path} />
          <details className={s.more}><summary>Strategies</summary><div style={{ marginTop: 10 }}><Strategies d={d} /></div></details>
        </div>
        <aside className={s.side}>
          <section className="card"><div className={s.pad}>
            <div className={s.sec}>Plan</div>
            <Plan d={d} compact />
            <div className={s.acts}><AcceptNext d={d} /></div>
            <div className={s.sec}>Last word</div>
            <div style={{ fontSize: 13 }}>
              {d.owes?.by === 'us' ? <b style={{ color: 'var(--clay)' }}>We owe them, since {shortDate(d.owes.since)}</b>
                : d.owes?.by === 'them' ? <>They owe us, since {shortDate(d.owes.since)}</>
                  : <span className={s.m}>Nobody owes a reply{d.summary.lastTouch ? ` · last ${shortDate(d.summary.lastTouch)}` : ''}</span>}
            </div>
            <div className={s.sec}>Routes</div>
            <Routes d={d} limit={3} />
            <div className={s.sec}>On file <Info text="Hover a line for its source, date and confidence." /></div>
            <Facts d={d} limit={5} />
          </div></section>
        </aside>
      </div>
    </Page>
  );
}

function Clip2({ text }: { text: string }) {
  return <span title={text} style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{text}</span>;
}

export default coalescePage('/targets/[id]/b', DesignB);
