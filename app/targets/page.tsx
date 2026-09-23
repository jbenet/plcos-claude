import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL, STATUSES, STATUS_LABEL,
  impliedRung, listPursuits, rungIndex, statusCounts, type Pursuit, type PursuitStatus,
} from '@/modules/strategy';
import { READ_LABEL, touchpointSummaries, type TouchpointSummary } from '@/modules/meetings';
import { CLOSE_STATE_LABEL, closeStates, type CloseTrack } from '@/modules/pipeline';
import { usdM } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Where a board opens: the first column with somebody in it, most advanced first. */
const OPEN_ON: PursuitStatus[] = ['discussing', 'committed', 'selected', 'sourcing', 'new', 'passed'];
const SHOWN = 150;

function Ladder({ p }: { p: Pursuit }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {RUNGS.map((r, i) => {
          const ev = p.events.find((e) => e.rung === r);
          const na = ev?.evidenceKind === 'not_applicable';
          return (
            <span
              key={r}
              title={RUNG_LABEL[r]}
              style={{
                width: 22, height: 6, borderRadius: 3,
                background: ev ? (na ? 'var(--line)' : 'var(--green)') : '#EDEAE2',
                outline: i === rungIndex(p.rung) + 1 ? '1.5px solid var(--clay)' : undefined,
                outlineOffset: 1,
              }}
            />
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>{p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file'}</div>
    </>
  );
}

/** What else is known about where they are: why it ended, what's next, what the source said. */
function Where({ p, s, c }: { p: Pursuit; s: TouchpointSummary; c: CloseTrack | undefined }) {
  const bits: string[] = [];
  if (p.status === 'passed') {
    bits.push([p.passedBy ? PASSED_BY_LABEL[p.passedBy] : 'Passed', p.statusReason?.replace('_', ' ')].filter(Boolean).join(' · '));
  }
  if (p.nextStep) bits.push(`Next: ${p.nextStep}${p.nextStepOn ? `, ${shortDate(p.nextStepOn)}` : ''}`);
  return (
    <div style={{ fontSize: 12 }}>
      {c && (
        <div>
          {CLOSE_STATE_LABEL[c.state]} {usdM(c.exposure.amount)}
          {c.state === 'signed' && c.signature ? <span className="muted"> · signed {c.signature.on ? shortDate(c.signature.on) : `per ${c.signature.bySource === 'affinity' ? 'Affinity' : c.signature.bySource}`}</span> : null}
          {c.exposure.track === 'hard' ? <span className="muted"> · {usdM(c.wired)} wired</span> : null}
        </div>
      )}
      {bits.length > 0 && <div>{bits.join(' — ')}</div>}
      {aheadOfStatus(p, s) && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          A meeting is on record ({shortDate(s.meetingDates[s.meetingDates.length - 1]!)}) — Discussing?
        </div>
      )}
      {p.stageSaid && p.source !== 'us' && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Affinity: &ldquo;{p.stageSaid}&rdquo;
          {p.implied.length > 0 && ` — ${p.implied.map((i) => IMPLIED_LABEL[i]).join(', ')}`}
        </div>
      )}
      {p.statusSource === 'us' && p.statusSetAt && (
        <div className="muted" style={{ fontSize: 11.5 }}>set here {shortDate(p.statusSetAt)}{p.statusSetByName ? ` by ${p.statusSetByName}` : ''}</div>
      )}
    </div>
  );
}

/**
 * The log has got ahead of the status: a meeting on record for an LP we still have at Selected
 * or earlier. Shown as a question — the status is a person's call, and it is never moved for them.
 */
function aheadOfStatus(p: Pursuit, s: TouchpointSummary): boolean {
  return (p.status === 'new' || p.status === 'sourcing' || p.status === 'selected') && s.meetingDates.length > 0;
}

/** The log, added up: meetings held, when we last touched, and their read with its date. */
function Touch({ s }: { s: TouchpointSummary }) {
  const d = s.meetingDates;
  return (
    <>
      <td className="mono" style={{ fontSize: 12 }} title={d.map((x) => shortDate(x)).join(', ')}>
        {d.length || <span className="muted">—</span>}
        {d.length > 0 && <div className="muted" style={{ fontSize: 10.5 }}>{shortDate(d[d.length - 1]!)}</div>}
      </td>
      <td style={{ fontSize: 12 }}>
        {s.lastTouch ? shortDate(s.lastTouch) : <span className="muted">—</span>}
        {s.awaitingSince && <div className="muted" style={{ fontSize: 10.5 }}>waiting on them</div>}
      </td>
      <td style={{ fontSize: 12 }}>
        {s.read ? READ_LABEL[s.read.read] : <span className="muted">—</span>}
        {s.read?.on && <div className="muted" style={{ fontSize: 10.5 }}>{shortDate(s.read.on)}</div>}
      </td>
    </>
  );
}

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status: asked }, selection, counts] = await Promise.all([searchParams, vehicleSelection(), statusCounts()]);
  const current = selection.current;
  // All vehicles means the ones being raised: a vehicle kept for its history is shown when it
  // is the one selected, and counted, not mixed in.
  const history = new Set(selection.all.filter((v) => v.phase === 'historical').map((v) => v.id));
  const inScope = (vehicleId: string) => (current ? vehicleId === current.id : !history.has(vehicleId));
  const count = (s: PursuitStatus) => counts.filter((c) => c.status === s && inScope(c.vehicleId)).reduce((a, c) => a + c.n, 0);
  const onHistory = current ? 0 : counts.filter((c) => history.has(c.vehicleId)).reduce((a, c) => a + c.n, 0);
  const status: PursuitStatus =
    STATUSES.some((s) => s.id === asked) ? (asked as PursuitStatus) : OPEN_ON.find((s) => count(s) > 0) ?? 'discussing';

  const rows = (await listPursuits(current?.id ?? null, { status })).filter((p) => inScope(p.vehicleId));
  const sums = await touchpointSummaries(rows.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId })));
  const sum = (p: Pursuit) => sums.get(`${p.entityId}:${p.vehicleId}`)!;
  // The money's state, for the rows that have any: every committed one, and a few others.
  const closes = await closeStates(rows.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId })));
  // Furthest along first: by evidence, then by meetings held, then by what the source says
  // happened; then the most recently in touch, then the name.
  rows.sort(
    (a, b) =>
      rungIndex(b.rung) - rungIndex(a.rung) ||
      sum(b).meetingDates.length - sum(a).meetingDates.length ||
      rungIndex(impliedRung(b.implied)) - rungIndex(impliedRung(a.implied)) ||
      (sum(b).lastTouch?.getTime() ?? 0) - (sum(a).lastTouch?.getTime() ?? 0) ||
      a.entityName.localeCompare(b.entityName),
  );
  const total = STATUSES.reduce((a, s) => a + count(s.id), 0);
  const info = STATUSES.find((s) => s.id === status)!;

  return (
    <Page
      crumbs={[
        { label: current?.name ?? 'All vehicles', href: '/overview' },
        { label: 'Pipeline' },
      ]}
      inspector={
        <>
          <div className="lbl">Six statuses</div>
          <div className="ihead">Where our effort is</div>
          <div className="imeta">Our plan, set by a person, any direction</div>
          {STATUSES.map((s) => (
            <div className="kv" key={s.id} title={s.means}>
              <span>{s.label}</span>
              <span>{count(s.id).toLocaleString('en-US')}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">What a status is not</div>
            <p>
              Not evidence. The ladder under each name is what the records support — a reply, a
              meeting, a number, a countersignature, a wire — and a status never moves it. What
              happened is in the log on each LP&rsquo;s page; how far the money has got is the close
              track.
            </p>
          </div>
          <div className="note">
            Read from Affinity until someone sets one here; after that, Affinity&rsquo;s word is kept
            beside ours, never over it (docs/17).
          </div>
        </>
      }
    >
      <div className="lbl">Module 04 · Discover &amp; qualify</div>
      <h1>Pipeline</h1>
      <p className="sublede">
        Every LP for {current ? current.name : 'the vehicles being raised'}, by where our effort is.
        The ladder beside each is what the evidence supports, which is not the same thing.
      </p>

      <div className="statusboard" role="tablist" aria-label="Status">
        {STATUSES.map((s) => (
          <Link
            key={s.id}
            href={`/targets?status=${s.id}`}
            className={`sb${s.id === status ? ' on' : ''}${s.id === 'passed' ? ' ended' : ''}`}
            role="tab"
            aria-selected={s.id === status}
          >
            <span className="lbl">{s.label}</span>
            <span className="n">{count(s.id).toLocaleString('en-US')}</span>
          </Link>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>{STATUS_LABEL[status]}</h2>
          <span className="lbl">
            {rows.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')} · {current ? current.name : 'all vehicles'}
          </span>
        </div>
        <div className="cbody" style={{ paddingBottom: 4 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{info.means}</p>
        </div>
        {rows.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nobody here</span>
              <h3>No LP is at {STATUS_LABEL[status]}{current ? ` for ${current.name}` : ''}.</h3>
              <p>An empty column, not a failed read.</p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>LP</th>
                {!current && <th style={{ width: 130 }}>Vehicle</th>}
                <th style={{ width: 110 }}>Owner</th>
                <th>Where</th>
                <th style={{ width: 96 }}>Meetings</th>
                <th style={{ width: 110 }}>Last touch</th>
                <th style={{ width: 120 }}>Their read</th>
                <th style={{ width: 176 }}>Ladder</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((p) => (
                <tr key={p.pursuitId} className="clickable">
                  <td>
                    <Link href={`/targets/${p.pursuitId}`}><b>{p.entityName}</b></Link>
                    {p.headline && <div className="muted" style={{ fontSize: 11.5 }}>{p.headline}</div>}
                  </td>
                  {!current && <td className="muted">{p.vehicleName}</td>}
                  <td className="muted">{p.ownerSaid ?? p.ownerName}</td>
                  <td><Where p={p} s={sum(p)} c={closes.get(`${p.entityId}:${p.vehicleId}`)} /></td>
                  <Touch s={sum(p)} />
                  <td><Ladder p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          {rows.length > SHOWN && <><b>The first {SHOWN} of {rows.length.toLocaleString('en-US')}</b>, furthest along first. </>}
          {onHistory > 0 && <>{onHistory.toLocaleString('en-US')} pursuits on vehicles kept for their history are not counted here; select one in the rail to see them. </>}
          <b>What this covers:</b> pursuits recorded in this system, including those read from
          Affinity. Someone being worked without a pursuit does not appear, which is a gap in the
          record rather than an absence of activity.
        </p>
      </div>
    </Page>
  );
}
