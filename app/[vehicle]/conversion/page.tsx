import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { Info } from '@/components/ui/Info';
import { vehicleSelection } from '@/lib/session';
import { conversionData } from '@/lib/authz/read/conversion';
import {
  WAY_IN, WAY_IN_LABEL, cohorts, funnel, milestonesOf, moneyOverTime, segmentPanel, throughput, waiting, wilson,
  type Row,
} from '@/lib/conversion/model';
import { formatDate } from '@/lib/time';
import { CohortTable, FunnelChart, MoneyLine, SegmentCard, WaitingCard, WeekBars } from './parts';
import s from './conversion.module.css';

export const dynamic = 'force-dynamic';

const pc = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : '—');

/**
 * Outreach conversion (docs/33; Juan, 14 Oct 2026): "need a tool to understand how outreach is converting per
 * vehicle … what good graphs can show us what's working / not working." One vehicle's funnel, cohorts, segments,
 * who is stuck, weekly throughput and money; `/all/conversion` compares vehicles side by side, never summed.
 * The facts are lib/conversion/data.ts (kept per data generation); the arithmetic, lib/conversion/model.ts.
 */
async function Conversion({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  if (slug === 'all') return <AllVehicles vehicles={all.filter((v) => v.phase === 'active' && v.kind !== 'grant_rail')} />;
  const vehicle = all.find((v) => v.slug === slug);
  if (!vehicle) notFound();

  const data = await conversionData(vehicle.id);
  const now = new Date();
  const rows: Row[] = data.pursuits.map((p) => ({ p, m: milestonesOf(p) }));
  const steps = funnel(rows);
  const reached = rows.filter((r) => r.m.dates.reached);
  const replied = reached.filter((r) => r.m.dates.replied).length;
  const met = reached.filter((r) => r.m.dates.met).length;
  const committed = rows.filter((r) => r.m.dates.committed).length;
  const wait = waiting(rows, now);
  const noReply = wait.noReply.reduce((t, b) => t + b.rows.length, 0);
  const weeks = throughput(rows, now);
  const money = moneyOverTime(rows);
  const ci = wilson(replied, reached.length);
  const label = (key: string) => (v: string) => data.dims.find((d) => d.key === key)?.labels[v] ?? v;
  const panels = [
    segmentPanel(rows, 'wayIn', 'Way in', (r) => r.m.wayIn, (v) => WAY_IN_LABEL[v as keyof typeof WAY_IN_LABEL] ?? 'Not known', WAY_IN),
    segmentPanel(rows, 'sender', 'Who reached out', (r) => r.m.sender, (v) => (v === 'unknown' ? 'Not known' : v)),
    ...data.dims.map((d) => segmentPanel(rows, d.key, d.title, (r) => r.p.segments[d.key] ?? null, label(d.key), d.order)),
  ].filter((p) => p.segments.length > 1 || (p.segments[0] && p.segments[0].value !== 'unknown'));
  const href = (id: string) => `/${vehicle.slug}/pipeline/${id}`;
  const asOf = formatDate(new Date(data.asOf), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  return (
    <Page crumbs={[{ label: vehicle.name, href: `/${vehicle.slug}/overview` }, { label: 'Conversion' }]}>
      <div className="lbl">Conversion · {vehicle.name}</div>
      <h1>How outreach is converting</h1>
      <p className="sublede">
        Every LP on {vehicle.name}, by how far they got after we first reached them.{' '}
        <Info label="How steps are dated">
          <span className="ip">Each step is dated by evidence: a mail, a meeting, an amount. Where the evidence is silent, a status
          change fills in and is counted as “from status”. A status read from Affinity has no date of change, so LPs moved there are dated by
          when their status was last set here.</span>
          <span className="ip">Mail comes from Affinity and from juanmail’s comms trace. Auto-replies and group events are left out.</span>
        </Info>
      </p>

      <div className={`kpis ${s.kpis}`}>
        <div className="kpi"><div className="n">{reached.length.toLocaleString('en-US')}</div><div className="f">LPs reached of {rows.length.toLocaleString('en-US')} on the list</div></div>
        <div className="kpi"><div className="n">{pc(replied, reached.length)}</div>
          <div className="f">replied{ci && reached.length >= 10 ? ` · likely ${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%` : ''}</div></div>
        <div className="kpi"><div className="n">{pc(met, reached.length)}</div><div className="f">of those reached met us</div></div>
        <div className="kpi"><div className="n g">{committed}</div><div className="f">committed</div></div>
        <div className="kpi soft"><div className="n">{noReply}</div><div className="f">waiting on a first reply</div></div>
      </div>

      {rows.length === 0 ? (
        <div className="card"><div className="cbody"><div className="empty">
          <span className="stat unavailable"><i />Nothing to count</span>
          <h3>No LP is in {vehicle.name}’s pipeline yet.</h3>
        </div></div></div>
      ) : (
        <>
          <div className="card">
            <div className="chead"><h2>Where LPs stop</h2><span className="lbl">all time</span></div>
            <div className="cbody"><FunnelChart steps={steps} /></div>
          </div>

          <div className="card">
            <div className="chead">
              <h2>Is it getting better?</h2>
              <span className="lbl">LPs first reached each week, and how far they have got</span>
            </div>
            <CohortTable cohorts={cohorts(rows, now)} />
          </div>

          <div className="card">
            <div className="chead">
              <h2>What converts</h2>
              <span className="lbl">
                reply rate among LPs reached{' '}
                <Info label="How to read the rates">
                  <span className="ip">The dot is the share that replied; the bar behind it is where the true rate likely sits (95%). Wide bars
                  mean too few LPs to tell. Groups under 10 show counts only.</span>
                  <span className="ip">Hover a dot for the meeting rate too. These show what went with a reply, not what caused it.</span>
                </Info>
              </span>
            </div>
            <div className="cbody"><div className={s.grid}>{panels.map((p) => <SegmentCard key={p.key} panel={p} />)}</div></div>
          </div>

          <div className="card">
            <div className="chead"><h2>Who is stuck</h2><span className="lbl">open LPs, by days waiting</span></div>
            <div className="cbody"><div className={s.grid}>
              <WaitingCard title="No reply yet" bins={wait.noReply} href={href} empty="Everyone reached has replied or passed." />
              <WaitingCard title="Met, nothing next" bins={wait.noNext} href={href} empty="Every LP met has a dated next step, or has committed or passed." />
            </div></div>
          </div>

          <div className="card">
            <div className="chead"><h2>The effort, week by week</h2><span className="lbl">last 12 weeks</span></div>
            <div className="cbody"><div className={s.smalls}>
              <WeekBars weeks={weeks} of={(w) => w.sent} title="Mail and asks we sent" tone="ink" />
              <WeekBars weeks={weeks} of={(w) => w.replies} title="Messages back" tone="purple" />
              <WeekBars weeks={weeks} of={(w) => w.meetings} title="Meetings and calls held" tone="green" />
              <WeekBars weeks={weeks} of={(w) => w.forward} title="LPs moved forward" tone="amber" />
            </div></div>
          </div>

          <div className="card">
            <div className="chead"><h2>Money</h2><span className="lbl">hard and soft, never added</span></div>
            <div className="cbody"><div className={s.smalls}>
              <MoneyLine points={money} of={(p) => p.hard} title="Hard: signed and countersigned" target={data.target} tone="green" now={now} />
              <MoneyLine points={money} of={(p) => p.soft} title="Soft: indicated, not committed" target={null} tone="amber" now={now} />
            </div></div>
          </div>

          <div className="card">
            <div className="chead"><h2>Dataroom views</h2><span className="lbl">DocSend</span></div>
            <div className="cbody"><div className="empty">
              <span className="stat unavailable"><i />Source unavailable</span>
              <h3>DocSend is not connected yet.</h3>
              <p>Once it is, this shows who opened the dataroom, how far they read, whether reading went with a meeting, and who read it
                recently with no follow-up from us. Views are curiosity, not commitment.</p>
            </div></div>
          </div>
        </>
      )}

      <p className="cover"><b>Read:</b> {asOf} UTC, recounted when the records change. Plan in docs/33.</p>
    </Page>
  );
}

/** Each raising vehicle's funnel in one row: compared side by side, never added up. */
async function AllVehicles({ vehicles }: { vehicles: Array<{ id: string; slug: string; name: string }> }) {
  const sets = await Promise.all(vehicles.map(async (v) => {
    const rows = (await conversionData(v.id)).pursuits.map((p) => ({ p, m: milestonesOf(p) }));
    const reached = rows.filter((r) => r.m.dates.reached);
    return { v, n: rows.length, reached: reached.length,
      replied: reached.filter((r) => r.m.dates.replied).length, met: reached.filter((r) => r.m.dates.met).length,
      committed: rows.filter((r) => r.m.dates.committed).length };
  }));
  return (
    <Page crumbs={[{ label: 'All vehicles', href: '/overview' }, { label: 'Conversion' }]}>
      <div className="lbl">Conversion · all vehicles</div>
      <h1>How outreach is converting</h1>
      <p className="sublede">Each raise on its own row. Open one for its funnel, cohorts and who is stuck.</p>
      <div className="card">
        <table className={`list ${s.vehicles}`}>
          <thead><tr><th>Vehicle</th><th className="right">On the list</th><th className="right">Reached</th><th className="right">Replied</th><th className="right">Met</th><th className="right">Committed</th></tr></thead>
          <tbody>
            {sets.map((x) => (
              <tr key={x.v.id}>
                <td><Link href={`/${x.v.slug}/conversion`}><b>{x.v.name}</b></Link></td>
                <td className="right">{x.n.toLocaleString('en-US')}</td>
                <td className="right">{x.reached.toLocaleString('en-US')}</td>
                <td className="right">{pc(x.replied, x.reached)}</td>
                <td className="right">{pc(x.met, x.reached)}</td>
                <td className="right">{x.committed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

export default coalescePage('/[vehicle]/conversion', Conversion);
