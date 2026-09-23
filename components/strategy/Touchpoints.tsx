import { shortDate } from '@/lib/time';
import {
  CHANNEL_LABEL, DIRECTION_LABEL, READ_LABEL, type Touchpoint, type TouchpointSummary,
} from '@/modules/meetings';
import { TouchpointForm } from './TouchpointForm';

const SHOWN = 10;
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];

/** "first 21 Aug, second 10 Sep" — the twelve stages' job, done by counting. */
export function meetingLine(s: TouchpointSummary): string {
  const d = s.meetingDates;
  if (!d.length) return 'No meeting on record';
  const named = d.slice(0, 3).map((x, i) => `${ORDINAL[i]} ${shortDate(x)}`).join(', ');
  return `${d.length} ${d.length === 1 ? 'meeting' : 'meetings'} on record — ${named}${d.length > 3 ? `, the latest ${shortDate(d[d.length - 1]!)}` : ''}`;
}

function source(t: Touchpoint): string {
  if (t.source === 'us') return 'logged here';
  if (t.sourceRef?.startsWith('interaction:')) return 'Affinity';
  return t.source;
}

function Row({ t }: { t: Touchpoint }) {
  const on = t.on ?? t.scheduledFor;
  return (
    <div className="anote">
      <div className="p2">
        {on ? shortDate(on) : 'undated'}{!t.on && t.scheduledFor ? ' · scheduled' : ''} · {CHANNEL_LABEL[t.channel]}
        {t.direction ? ` · ${DIRECTION_LABEL[t.direction]}` : ''} · {t.vehicleName ?? 'no vehicle in particular'}
        {t.viaOrganization ? ` · with ${t.viaOrganization}` : ''} · {source(t)}
      </div>
      <div className="t">
        {t.summary ?? (
          <span className="muted">
            {t.attendees.length ? `With ${t.attendees.join(', ')}` : t.ownerName === 'Not on the team' ? 'Who from our side: not recorded' : t.ownerName}
          </span>
        )}
        {t.read && <span className="flag f-mute" style={{ marginLeft: 8 }}>{READ_LABEL[t.read]}{t.readByName ? ` — ${t.readByName}` : ''}</span>}
      </div>
    </div>
  );
}

/**
 * What has happened with this LP (N51, docs/17): the dated log, and what it adds up to. The
 * counts are derived here, never set — so a second meeting is a second row, not a stage.
 */
export function Touchpoints(props: {
  touches: Touchpoint[]; summary: TouchpointSummary;
  pursuitId: string; entityId: string; vehicleId: string; vehicleName: string;
}) {
  const { touches, summary: s } = props;
  return (
    <div className="card">
      <div className="chead">
        <h2>Touchpoints</h2>
        <span className="lbl">{touches.length} · {s.meetingDates.length} {s.meetingDates.length === 1 ? 'meeting' : 'meetings'}</span>
      </div>
      <div className="cbody">
        <div className="fact"><span>Meetings</span><span>{meetingLine(s)}</span></div>
        <div className="fact">
          <span>Last touch</span>
          <span>{s.lastTouch ? `${shortDate(s.lastTouch)}${s.lastTouchChannel ? ` · ${CHANNEL_LABEL[s.lastTouchChannel].toLowerCase()}` : ''}` : 'none on record'}</span>
        </div>
        {s.awaitingSince && <div className="fact"><span>Waiting on them</span><span>since {shortDate(s.awaitingSince)} — we reached out, nothing from them since</span></div>}
        {s.nextMeeting && <div className="fact"><span>Next meeting</span><span>{shortDate(s.nextMeeting)}</span></div>}
        <div className="fact">
          <span>Their read</span>
          <span>{s.read ? `${READ_LABEL[s.read.read]} — ${s.read.byName ?? 'unattributed'}${s.read.on ? `, ${shortDate(s.read.on)}` : ''}` : 'nobody has recorded one'}</span>
        </div>
        {s.lastResearched && <div className="fact"><span>Last researched</span><span>{shortDate(s.lastResearched)}</span></div>}
        {s.withFirm.total > 0 && (
          <div className="fact">
            <span>With their firm</span>
            <span className="muted">
              {s.withFirm.total} more, not counted above{s.withFirm.lastTouch ? ` · last ${shortDate(s.withFirm.lastTouch)}` : ''}
              {s.withFirm.nextMeeting ? ` · next ${shortDate(s.withFirm.nextMeeting)}` : ''} — they may be with a colleague
            </span>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {touches.slice(0, SHOWN).map((t) => <Row key={t.touchpointId} t={t} />)}
          {touches.length > SHOWN && (
            <details className="more">
              <summary>{touches.length - SHOWN} older</summary>
              {touches.slice(SHOWN).map((t) => <Row key={t.touchpointId} t={t} />)}
            </details>
          )}
        </div>
        <details className="more" style={{ marginTop: 8 }}>
          <summary>Log a touchpoint</summary>
          <TouchpointForm pursuitId={props.pursuitId} entityId={props.entityId} vehicleId={props.vehicleId} vehicleName={props.vehicleName} />
        </details>
      </div>
      <p className="cover">
        <b>What this covers:</b> touchpoints logged here, and those Affinity has — each list
        entry&rsquo;s last email and meetings, and meeting, call and email notes — as of the last
        translation. One tied to no vehicle counts for every open pursuit of this LP. A meeting
        nobody logged and no calendar saw is not here.
      </p>
    </div>
  );
}
