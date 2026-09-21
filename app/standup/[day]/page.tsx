import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { PinButton } from '@/components/standup/PinButton';
import { EntityLink } from '@/components/entity/EntityLink';
import { usdM } from '@/lib/money';
import { longDate, shortDate, timeOfDay } from '@/lib/time';
import {
  listDays, liveMetrics, standupFor, SOURCE_LABEL, STATUS_LABEL,
  type Item, type ItemStatus, type Metric,
} from '@/modules/standup';

export const dynamic = 'force-dynamic';

const STATUS_FLAG: Record<ItemStatus, string> = {
  open: 'f-ev', done: 'f-ok', carried: 'f-mute', dropped: 'f-mute',
};

const LINEAR_FLAG: Record<string, string> = {
  Done: 'f-ok', 'In Review': 'f-ev', 'In Progress': 'f-ev', Todo: 'f-mute', Triage: 'f-mute',
};

function value(m: Metric): string {
  if (m.unit === 'usd') return usdM(m.value);
  if (m.unit === 'ratio') return `${Math.round(m.value * 100)}%`;
  return String(m.value);
}

function ItemRow({ i }: { i: Item }) {
  const days = i.carriedFrom
    ? Math.round((Date.now() - i.carriedFrom.getTime()) / 86_400_000)
    : 0;
  return (
    <div className="sitem">
      <span className={`flag ${STATUS_FLAG[i.status]}`}>{STATUS_LABEL[i.status]}</span>
      <div className="st">
        <b>{i.title}</b>
        {i.detail && <p>{i.detail}</p>}
        <div className="smeta">
          <span>{i.ownerName ?? 'unassigned'}</span>
          {i.vehicleName && <span>{i.vehicleName}</span>}
          {i.carriedFrom && (
            <span className="carried">
              carried from {shortDate(i.carriedFrom)}
              {days > 1 ? ` · ${days} days` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function Standup({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) notFound();

  const s = await standupFor(day);
  if (!s) notFound();

  const days = await listDays();
  const metrics = s.live ? await liveMetrics() : s.metrics;

  const byVehicle = new Map<string, Metric[]>();
  const crossCutting: Metric[] = [];
  for (const m of metrics) {
    if (m.vehicleName === null) crossCutting.push(m);
    else {
      const list = byVehicle.get(m.vehicleName) ?? [];
      list.push(m);
      byVehicle.set(m.vehicleName, list);
    }
  }

  const blocked = s.actions.filter((a) => a.blocker);
  const carried = s.today.filter((i) => i.carriedFrom).length;
  const doneYesterday = s.previous?.items.filter((i) => i.status === 'done').length ?? 0;
  const openYesterday = s.previous?.items.filter((i) => i.status !== 'done' && i.status !== 'dropped') ?? [];

  return (
    <Page
      crumbs={[
        { label: SECTION.overview },
        { label: 'Daily standup', href: '/standup' },
        { label: longDate(s.day) },
      ]}
      inspector={
        <>
          <div className="lbl">This day</div>
          <div className="ihead">{longDate(s.day)}</div>
          <div className="imeta">
            {s.capturedAt
              ? `Pinned ${timeOfDay(s.capturedAt)} by ${s.capturedByName ?? 'someone'}`
              : 'Not pinned — the numbers below are live'}
          </div>

          <div className="kv"><span>Focus this week</span><span>{s.week.length}</span></div>
          <div className="kv"><span>On today</span><span>{s.today.length}</span></div>
          <div className="kv"><span>Carried forward</span><span>{carried}</span></div>
          <div className="kv"><span>Actions</span><span>{s.actions.length}</span></div>
          <div className="kv"><span>Blocked</span><span>{blocked.length}</span></div>

          <div className="scope">
            <div className="lbl">Why a past day does not move</div>
            <p>
              The numbers are pinned into the day when it is captured, and a past day never
              recomputes. A standup page that recalculates in November is a new opinion wearing
              an old date, and it makes &ldquo;we agreed this on the 19th&rdquo; unfalsifiable.
            </p>
          </div>

          <div className="lbl" style={{ marginTop: 14 }}>Other days</div>
          {days.map((x) => {
            const iso = x.day.toISOString().slice(0, 10);
            return (
              <Link className="prov" href={`/standup/${iso}`} key={iso}>
                <div className="p1">
                  {longDate(x.day)}
                  {iso === day ? ' · here' : ''}
                </div>
                <div className="p2">
                  {x.capturedAt ? `pinned ${timeOfDay(x.capturedAt)}` : 'live, not pinned'}
                </div>
              </Link>
            );
          })}
        </>
      }
    >
      <div className="lbl">Overview · Daily standup</div>
      <div className="dayhead">
        <h1>{longDate(s.day)}</h1>
        <div className="daynav">
          {s.prevDay
            ? <Link className="btn" href={`/standup/${s.prevDay.toISOString().slice(0, 10)}`}>← {shortDate(s.prevDay)}</Link>
            : <span className="btn" aria-disabled>← earliest</span>}
          {s.nextDay
            ? <Link className="btn" href={`/standup/${s.nextDay.toISOString().slice(0, 10)}`}>{shortDate(s.nextDay)} →</Link>
            : <span className="btn" aria-disabled>latest →</span>}
        </div>
      </div>
      {s.headline && <p className="sublede">{s.headline}</p>}

      {/* ---------- what the numbers are ---------- */}
      <div className={`pinbar ${s.live ? 'live' : 'pinned'}`}>
        <div>
          <b>{s.live ? 'Live numbers' : 'Pinned numbers'}</b>
          <p>
            {s.live
              ? 'Nobody has captured this day yet, so these are computed now and will move under you. Pin them at the start of the meeting and the page becomes a record instead of a view.'
              : `Frozen at ${timeOfDay(s.capturedAt!)} on ${shortDate(s.day)} by ${s.capturedByName ?? 'someone'}. They are not today's numbers and they will never become today's numbers.`}
          </p>
        </div>
        {s.live && <PinButton day={day} />}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Every vehicle, side by side</h2>
          <span className="lbl">no total row · soft is never added to hard</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th style={{ width: 118 }} className="right">Hard</th>
              <th style={{ width: 118 }} className="right">Soft</th>
              <th style={{ width: 128 }} className="right">Gap to target</th>
              <th>What the hard number rests on</th>
            </tr>
          </thead>
          <tbody>
            {[...byVehicle.entries()].map(([name, list]) => {
              const get = (prefix: string) => list.find((m) => m.key.startsWith(prefix));
              const hard = get('hard');
              const soft = get('soft');
              const gap = get('gap');
              return (
                <tr key={name}>
                  <td><b>{name}</b></td>
                  <td className="right mono" style={{ color: 'var(--green)' }}>
                    {hard ? value(hard) : '—'}
                  </td>
                  <td className="right mono muted">{soft ? value(soft) : '—'}</td>
                  <td className="right mono">{gap ? value(gap) : '—'}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{hard?.detail ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="cover">
          <b>One row per vehicle and no total row.</b> Soft sits in its own column because it is
          its own track — the headline for any vehicle is the hard number, and no figure on this
          page adds across the rows.
        </p>
      </div>

      {crossCutting.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Across every vehicle</h2>
            <span className="lbl">counts, not money</span>
          </div>
          <div className="kpis">
            {crossCutting.map((m) => (
              <div className="kpi" key={m.key}>
                <div className="lbl">{m.label}</div>
                <div className="n">{value(m)}</div>
                <div className="f">{m.detail}</div>
              </div>
            ))}
          </div>
          <p className="cover">
            <b>These are counts.</b> Four approvals and one conflict are four decisions and one
            collision — they are not a sum of anything, and no figure on this page adds money
            across vehicles.
          </p>
        </div>
      )}

      {/* ---------- the week, then the two days ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Focus this week</h2>
          <span className="lbl">
            {s.week.length} item{s.week.length === 1 ? '' : 's'}
            {s.week.filter((i) => i.carriedFrom).length > 0
              ? ` · ${s.week.filter((i) => i.carriedFrom).length} carried`
              : ''}
          </span>
        </div>
        <div className="cbody weekrow">
          {s.week.length === 0
            ? <p className="muted">Nothing set for the week yet.</p>
            : s.week.map((i) => <ItemRow key={i.itemId} i={i} />)}
        </div>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>{s.previous ? `Yesterday — ${shortDate(s.previous.day)}` : 'Yesterday'}</h2>
            <span className="lbl">
              {s.previous ? `${doneYesterday} done · ${openYesterday.length} still open` : 'no earlier day'}
            </span>
          </div>
          <div className="cbody">
            {!s.previous ? (
              <p className="muted">This is the earliest day recorded.</p>
            ) : (
              s.previous.items.map((i) => <ItemRow key={i.itemId} i={i} />)
            )}
          </div>
          <p className="cover">
            <b>Read as it was written.</b> Nothing here re-derives its status from today&rsquo;s
            data, so an item that says <i>open</i> was open when that meeting ended.
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Today</h2>
            <span className="lbl">
              {s.today.length} item{s.today.length === 1 ? '' : 's'}
              {carried > 0 ? ` · ${carried} carried forward` : ''}
            </span>
          </div>
          <div className="cbody">
            {s.today.length === 0
              ? <p className="muted">Nothing on today yet.</p>
              : s.today.map((i) => <ItemRow key={i.itemId} i={i} />)}
          </div>
          <p className="cover">
            <b>Carrying is visible on purpose.</b> An item on its third day is a different
            conversation from one on its first, and the amber says which.
          </p>
        </div>
      </div>

      {/* ---------- actions ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What to do, in order</h2>
          <span className="lbl">
            {s.actions.length} action{s.actions.length === 1 ? '' : 's'}
            {blocked.length > 0 ? ` · ${blocked.length} blocked` : ''}
          </span>
        </div>
        <table className="list acts-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ width: 300 }}>Action</th>
              <th>Why it is on the list</th>
              <th style={{ width: 128 }}>Suggested owner</th>
              <th style={{ width: 168 }}>Standing</th>
            </tr>
          </thead>
          <tbody>
            {s.actions.map((a) => (
              <tr key={a.actionId} className={a.blocker ? 'blockedrow' : undefined}>
                <td className="mono muted">{a.rank}</td>
                <td>
                  <b>{a.title}</b>
                  {a.vehicleName && <div className="muted" style={{ fontSize: 11 }}>{a.vehicleName}</div>}
                </td>
                <td className="muted">{a.why}</td>
                <td>
                  {a.ownerName ?? <span className="muted">unassigned</span>}
                  <div className="muted" style={{ fontSize: 10.5 }}>suggested</div>
                </td>
                <td>
                  {a.blocker ? (
                    <>
                      <span className="flag f-block">Blocked</span>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{a.blocker}</div>
                      {a.blockedOn && <div className="muted" style={{ fontSize: 10.5 }}>on: {a.blockedOn}</div>}
                    </>
                  ) : (
                    <span className="flag f-ok">Can start</span>
                  )}
                  {a.gate && <div className="flag f-mute" style={{ marginTop: 4 }}>needs {a.gate}</div>}
                  {a.dueOn && <div className="mono" style={{ fontSize: 10.5, marginTop: 3 }}>by {shortDate(a.dueOn)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>The owner is a suggestion, not an assignment.</b> Nothing on this page writes to
          anybody&rsquo;s queue. Where an action would need an approval the ticket kind is named
          on the row, so the standup cannot propose something that would fail closed at the
          command.
        </p>
      </div>

      {/* ---------- external ---------- */}
      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Linear</h2>
            <span className="lbl">mocked — no connector before L13</span>
          </div>
          <table className="list">
            <tbody>
              {s.linear.map((e) => (
                <tr key={e.externalId}>
                  <td style={{ width: 74 }} className="mono muted">{e.ref}</td>
                  <td>
                    <b>{e.title}</b>
                    {e.detail && <div className="muted" style={{ fontSize: 11 }}>{e.detail}</div>}
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {e.who ?? 'unassigned'} · {shortDate(e.occurredAt)}
                    </div>
                  </td>
                  <td style={{ width: 96 }}>
                    <span className={`flag ${LINEAR_FLAG[e.state] ?? 'f-mute'}`}>{e.state}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            <b>Fixture data.</b> No Linear client is installed and none will be before L13 — and
            the custom-field schema this would map onto is still UNVERIFIED in all three design
            packages. This pane shows the shape the summary will take, labelled so nobody mistakes
            it for a sync.
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Recent outreach</h2>
            <span className="lbl">mocked — Affinity is not attached</span>
          </div>
          <table className="list">
            <tbody>
              {s.outreach.map((e) => (
                <tr key={e.externalId}>
                  <td>
                    <b>{e.title}</b>
                    {e.detail && <div className="muted" style={{ fontSize: 11 }}>{e.detail}</div>}
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {e.who ?? '—'} · {shortDate(e.occurredAt)}
                    </div>
                  </td>
                  <td style={{ width: 150 }}>
                    <span className="flag f-mute">{e.state}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            <b>Fixture data, and the state on the right is the consent ladder rung</b> — not a
            CRM status. When Affinity is attached it will fill the same shape through the
            Connector seam, and the rung will still be the thing a piece of evidence justifies
            rather than a field somebody set.
          </p>
        </div>
      </div>

      <p className="cover">
        <b>What this page covers:</b> the {metrics.length} numbers{' '}
        {s.live ? 'as computed just now' : `as pinned at ${timeOfDay(s.capturedAt!)}`}, {s.week.length}{' '}
        weekly and {s.today.length} daily items, {s.actions.length} actions, and{' '}
        {s.linear.length + s.outreach.length} rows of fixture data from two systems that are not
        connected. <b>Nothing here is a forecast</b>, and nothing on it has been sent to anyone.
      </p>
    </Page>
  );
}
