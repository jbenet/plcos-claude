import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { AutoRefresh } from '@/components/ui/AutoRefresh';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago } from '@/lib/time';
import { affinityReady } from '@/lib/connectors/affinity';
import { MEETINGS_CAP, MEETINGS_CAP_REST, WINDOW, meetingsInventory, meetingsRunning, type MeetingsRunDetail } from '@/lib/connectors/affinity/meetings';
import { latestRun } from '@/modules/sources';
import { readMeetingsAction, translateAction } from '../actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');

export default async function Meetings() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [run, lastGood, inv, translated] = await Promise.all([
    latestRun('affinity', 'meetings'), latestRun('affinity', 'meetings', 'ok'), meetingsInventory(), latestRun('affinity', 'translate'),
  ]);
  const running = meetingsRunning();
  const interrupted = run?.status === 'running' && !running;
  const d = (run?.detail ?? {}) as MeetingsRunDetail;
  const good = (lastGood?.detail ?? {}) as MeetingsRunDetail;
  const stale = !!lastGood && (!translated || translated.startedAt < lastGood.startedAt);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Meetings' }]}
      inspector={
        <>
          <div className="lbl">The calendar</div>
          <div className="ihead">Every meeting, dated</div>
          <div className="imeta">From Affinity&rsquo;s calendar sync</div>
          <div className="scope">
            <div className="lbl">Why</div>
            <p>
              A list entry carries one last event and one next event. The calendar carries every
              meeting, with who was in it — so an LP&rsquo;s first meeting, their second and their
              next are dates, not a word on a list.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Capped, because it cannot be counted</div>
            <p>
              Affinity gives no count for meetings, so a read stops at {MEETINGS_CAP} requests (Juan: fewer
              than a hundred) and says so. The first starts at {WINDOW.slice(0, 10)}, so the cap is not spent
              on the oldest years. After that, only what changed.
            </p>
          </div>
          <div className="note">
            Titles and attendees stay in <code>sources.raw_record</code>. A touchpoint copies the
            date, the kind, and who from the team was there — no title, no outside names.
          </div>
        </>
      }
    >
      {running && <AutoRefresh seconds={3} />}
      <div className="lbl">
        <Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/notes">Notes</Link> ·{' '}
        <Link href="/dev/affinity/mapping">Mapping</Link>
      </div>
      <h1>The calendar</h1>
      <p className="sublede">
        Every meeting on the team&rsquo;s calendars since {WINDOW.slice(0, 4)}, a hundred to a request, each
        with its attendees. Translated, a meeting with someone in the tool becomes their touchpoint.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>Read from <code>fixtures/affinity/meetings.json</code>: ten invented meetings.</p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Read</h2>
          <span className="lbl">
            {running ? 'reading now' : run ? `${interrupted ? 'interrupted' : run.status} · ${ago(run.startedAt)}${run.runByName ? ` · ${run.runByName}` : ''}` : 'never read'}
          </span>
        </div>
        <div className="cbody">
          {lastGood && (
            <div className="fact">
              <span>Last complete read</span>
              <span>
                {ago(lastGood.startedAt)} · {good.mode === 'since' ? `what changed since ${day(good.since)}` : `everything since ${day(good.window)}`} ·{' '}
                {n(lastGood.records)} read, {n(lastGood.newRecords)} new or changed · {n(lastGood.requests)} of {n(good.cap ?? MEETINGS_CAP)} requests
              </span>
            </div>
          )}
          {run && run.id !== lastGood?.id && <div className="fact"><span>{running ? 'So far' : 'Latest'}</span><span>{run.note ?? '—'}</span></div>}
          {d.stoppedAtCap && !running && (
            <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
              <b>Stopped at the cap.</b> There are more meetings than {n(d.cap ?? MEETINGS_CAP)} requests reach. What was read is
              kept; reading the rest needs a larger cap, which is your call.
              {ready.ready && (
                <form action={readMeetingsAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="mode" value="rest" />
                  <button className="btn p" type="submit">Read the whole window: at most {n(MEETINGS_CAP_REST)} requests</button>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Juan, 23 Sep: &ldquo;you can sync the remaining meetings too&rdquo;.</span>
                </form>
              )}
            </div>
          )}
          {interrupted && <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}><b>Cut off.</b> The server restarted mid-read; what landed is kept.</div>}
          {!running && (
            <div className="acts" style={{ marginTop: 12 }}>
              <form action={readMeetingsAction} style={{ flex: 1 }}>
                {!lastGood && <input type="hidden" name="mode" value="full" />}
                <button className="btn p" type="submit" disabled={!ready.ready} style={{ width: '100%' }}>
                  {lastGood ? 'Read what changed since the last read' : `Read the calendar since ${WINDOW.slice(0, 4)}: at most ${MEETINGS_CAP} requests`}
                </button>
              </form>
              {lastGood && (
                <form action={readMeetingsAction}>
                  <input type="hidden" name="mode" value="full" />
                  <button className="btn" type="submit" disabled={!ready.ready}>Read the window again</button>
                </form>
              )}
            </div>
          )}
          {!ready.ready && <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{ready.why}</p>}
          {stale && (
            <form action={translateAction} style={{ marginTop: 10 }}>
              <button className="btn c" type="submit">Translate: turn the meetings into touchpoints</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Local; not one request to Affinity.</span>
            </form>
          )}
        </div>
      </div>

      {inv && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="lbl">Meetings kept</div><div className="n">{n(inv.total)}</div><div className="f">{day(inv.first)} to {day(inv.last)}</div></div>
            <div className="kpi"><div className="lbl">With someone outside</div><div className="n">{n(inv.external)}</div><div className="f">the rest are the team alone</div></div>
            <div className="kpi"><div className="lbl">Still ahead</div><div className="n">{n(inv.ahead)}</div><div className="f">as of the last read</div></div>
            <div className="kpi"><div className="lbl">Logged by hand</div><div className="n">{n(inv.manual)}</div><div className="f">the rest came from calendar sync</div></div>
          </div>
          <div className="card">
            <div className="chead"><h2>When</h2><span className="lbl">by the year each started</span></div>
            <table className="list"><tbody>{inv.byYear.map((y) => <tr key={y.year}><td className="mono">{y.year}</td><td className="right mono">{n(y.n)}</td></tr>)}</tbody></table>
            <p className="cover">
              <b>Coverage:</b> the meetings Affinity has captured from the calendars it syncs, since{' '}
              {WINDOW.slice(0, 10)}, as far as the key&rsquo;s owner can see them. A meeting on a calendar
              Affinity does not sync is not here.{inv.truncated ? ` ${n(inv.truncated)} had over a hundred attendees; the first hundred were read.` : ''}
            </p>
          </div>
        </>
      )}
    </Page>
  );
}
