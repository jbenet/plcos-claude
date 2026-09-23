import { shortDate } from '@/lib/time';
import {
  CHANNEL_LABEL, DIRECTION_LABEL, READ_LABEL, type Touchpoint, type TouchpointSummary,
} from '@/modules/meetings';
import type { ShownRead } from '@/lib/reads';
import { decideReadingAction } from '@/app/targets/actions';
import { TouchpointForm } from './TouchpointForm';

/** What a touchpoint was about, read when the page is shown: the meeting's title, its note. */
export interface TouchContext {
  title?: string | null;
  summary?: string | null;
  summaryBy?: string | null;
  text?: string | null;
  health?: boolean;
}

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

function Row({ t, c }: { t: Touchpoint; c?: TouchContext }) {
  const on = t.on ?? t.scheduledFor;
  const who = t.attendees.length ? `With ${t.attendees.join(', ')}` : t.ownerName === 'Not on the team' ? 'Who from our side: not recorded' : t.ownerName;
  return (
    <div className="anote">
      <div className="p2">
        {on ? shortDate(on) : 'undated'}{!t.on && t.scheduledFor ? ' · scheduled' : ''} · {CHANNEL_LABEL[t.channel]}
        {t.direction ? ` · ${DIRECTION_LABEL[t.direction]}` : ''} · {t.vehicleName ?? 'no vehicle in particular'}
        {t.viaOrganization ? ` · with ${t.viaOrganization}` : ''} · {source(t)}
      </div>
      {c?.title && <div className="t"><b>{c.title}</b></div>}
      {c?.text ? (
        // The note behind it, closed like a message in a thread: a sentence, then all of it.
        c.health ? (
          <details className="thread">
            <summary><span className="warnline">Its note mentions someone&rsquo;s health — open to read</span></summary>
            <div className="t full">{c.text}</div>
          </details>
        ) : (
          <details className="thread">
            <summary>
              <span className="t">{c.summary}</span>
              {c.summaryBy === 'claude' && <span className="byline"> · summary by Claude</span>}
              <span className="open">the note</span>
            </summary>
            <div className="t full">{c.text}</div>
          </details>
        )
      ) : (
        <div className="t"><span className="muted">{t.summary ?? who}</span></div>
      )}
      {c?.text && <div className="p2" style={{ marginTop: 3 }}>{who}</div>}
      {t.read && <span className="flag f-mute" style={{ marginTop: 4, display: 'inline-block' }}>{READ_LABEL[t.read]}{t.readByName ? ` — ${t.readByName}` : ''}</span>}
    </div>
  );
}

/** Their read, a person's or a suggestion from a note — and, for a suggestion, the two answers. */
function TheirRead({ r, pursuitId }: { r: ShownRead | null; pursuitId: string }) {
  if (!r) return <>nobody has recorded one</>;
  if (!r.suggested && r.noteId) {
    return <>{READ_LABEL[r.read]} — confirmed by {r.byName ?? 'someone'} from a note of {r.on ? shortDate(r.on) : 'an unknown date'}{r.basis ? `: “${r.basis}”` : ''}</>;
  }
  if (!r.suggested) return <>{READ_LABEL[r.read]} — {r.byName ?? 'unattributed'}{r.on ? `, ${shortDate(r.on)}` : ''}</>;
  return (
    <span>
      <span className="suggested">{READ_LABEL[r.read]}</span>
      <span className="muted"> — suggested by {r.byName} from a note of {r.on ? shortDate(r.on) : 'an unknown date'}{r.basis ? `: “${r.basis}”` : ''}. Not confirmed.</span>
      <span className="readacts">
        <form action={decideReadingAction}>
          <input type="hidden" name="noteId" value={r.noteId ?? ''} />
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <input type="hidden" name="decision" value="confirm" />
          <button className="btn" type="submit">Confirm</button>
        </form>
        <form action={decideReadingAction}>
          <input type="hidden" name="noteId" value={r.noteId ?? ''} />
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <input type="hidden" name="decision" value="dismiss" />
          <button className="btn" type="submit">Not right</button>
        </form>
      </span>
    </span>
  );
}

/**
 * What has happened with this LP (N51, docs/17): the dated log, and what it adds up to. The
 * counts are derived here, never set — so a second meeting is a second row, not a stage.
 */
export function Touchpoints(props: {
  touches: Touchpoint[]; summary: TouchpointSummary;
  pursuitId: string; entityId: string; vehicleId: string; vehicleName: string;
  /** The last calendar read stopped at its cap: some meetings are not here yet (rule 7). */
  calendarPartial?: boolean;
  context?: Record<string, TouchContext>;
  read?: ShownRead | null;
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
          <span><TheirRead r={props.read ?? (s.read ? { ...s.read, suggested: false, basis: null, noteId: null } : null)} pursuitId={props.pursuitId} /></span>
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
          {touches.slice(0, SHOWN).map((t) => <Row key={t.touchpointId} t={t} c={props.context?.[t.touchpointId]} />)}
          {touches.length > SHOWN && (
            <details className="more">
              <summary>{touches.length - SHOWN} older</summary>
              {touches.slice(SHOWN).map((t) => <Row key={t.touchpointId} t={t} c={props.context?.[t.touchpointId]} />)}
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
        {props.calendarPartial && <> <b>The calendar read stopped at its cap,</b> so some meetings Affinity has are not here yet.</>}
      </p>
    </div>
  );
}
