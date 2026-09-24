import Link from 'next/link';
import { ago, shortDate } from '@/lib/time';
import {
  CHANNEL_LABEL, DIRECTION_LABEL, READ_LABEL, type Touchpoint, type TouchpointSummary,
} from '@/modules/meetings';
import type { ShownRead } from '@/lib/reads';
import type { NoteView } from '@/lib/connectors/affinity/notes';
import { WHAT_LABEL, type What } from '@/lib/connectors/affinity/readings';
import { decideReadingAction } from '@/app/targets/actions';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import { TouchpointForm } from './TouchpointForm';

/** What a touchpoint was about, read when the page is shown: the meeting's title, its note. */
export interface TouchContext {
  title?: string | null;
  /** The note Affinity ties to the same meeting, call or email, shown inside the row. */
  noteId?: number | null;
  summary?: string | null;
  summaryBy?: string | null;
  what?: What | null;
  text?: string | null;
  health?: boolean;
}

const SHOWN = 12;
const CLIP = 360;
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];

/** "first 21 Aug, second 10 Sep" — the twelve stages' job, done by counting. */
export function meetingLine(s: TouchpointSummary): string {
  const d = s.meetingDates;
  if (!d.length) return 'No meeting on record';
  const named = d.slice(0, 3).map((x, i) => `${ORDINAL[i]} ${shortDate(x)}`).join(', ');
  return `${d.length} ${d.length === 1 ? 'meeting' : 'meetings'} on record — ${named}${d.length > 3 ? `, the latest ${shortDate(d[d.length - 1]!)}` : ''}`;
}

type Tone = 'signal' | 'good' | 'stop' | 'look';
type Mark = { name: GlyphName; title: string; tone?: Tone };

/** The words that change what an LP's state is, worth a colour as well as an icon. */
const WHAT_MARK: Record<What, { name: GlyphName; tone?: Tone }> = {
  meeting_notes: { name: 'chat' },
  questions: { name: 'question', tone: 'signal' },
  materials: { name: 'folder', tone: 'signal' },
  deck_view: { name: 'eye', tone: 'look' },
  indication: { name: 'coin', tone: 'good' },
  signed: { name: 'pen', tone: 'good' },
  declined: { name: 'stop', tone: 'stop' },
  intro: { name: 'link' },
  update: { name: 'chart' },
  background: { name: 'person' },
  pipeline: { name: 'list' },
};
const SIGNALS: What[] = ['questions', 'materials', 'indication', 'signed', 'declined'];

function touchMark(t: Touchpoint, now: number): Mark {
  const upcoming = !t.on && t.scheduledFor && t.scheduledFor.getTime() > now;
  switch (t.channel) {
    case 'meeting': return upcoming ? { name: 'calendar-next', title: 'Meeting, still ahead' } : { name: 'calendar', title: 'Meeting' };
    case 'call': return { name: 'phone', title: 'Call' };
    case 'email':
      return t.direction === 'theirs' ? { name: 'mail-in', title: 'Email from them', tone: 'signal' }
        : t.direction === 'ours' ? { name: 'mail-out', title: 'Email from us' } : { name: 'mail', title: 'Email' };
    case 'message': return { name: 'chat', title: 'Message' };
    case 'intro': return { name: 'link', title: 'Intro' };
    case 'event': return { name: 'ticket', title: 'Event' };
    case 'research': return { name: 'search', title: 'Research pass' };
  }
}

function noteMark(n: NoteView): Mark {
  const what = n.reading?.what;
  if (what) return { ...WHAT_MARK[what], title: WHAT_LABEL[what] };
  if (n.deckView) return { name: 'eye', title: 'Viewed the deck', tone: 'look' };
  if (n.kind === 'ai-notetaker') return { name: 'mic', title: n.kindLabel };
  if (n.kind === 'interaction:email') return { name: 'mail', title: n.kindLabel };
  if (n.kind === 'interaction:meeting' || n.kind === 'interaction:call') return { name: 'chat', title: n.kindLabel };
  return { name: 'note', title: n.kindLabel };
}

function source(t: Touchpoint): string {
  if (t.source === 'us') return 'logged here';
  if (t.sourceRef?.startsWith('interaction:')) return 'Affinity';
  return t.source;
}

/**
 * A note's text behind its summary, closed like a message in a thread. A note that mentions
 * someone's health shows a summary only if it was read with that detail redacted (N56), and its
 * own text stays closed until someone opens it: it is the team's note, so not hidden from them.
 */
function Thread({ summary, by, text, health }: { summary: string | null; by: string | null; text: string; health: boolean }) {
  if (health && !summary) {
    return (
      <details className="thread">
        <summary><span className="warnline">Mentions someone&rsquo;s health — open to read</span></summary>
        <div className="t full">{text}</div>
      </details>
    );
  }
  if (!summary) {
    const long = text.length > CLIP;
    return long ? (
      <details className="thread">
        <summary><span className="t">{text.slice(0, CLIP).trimEnd()}…</span><span className="open">the rest</span></summary>
        <div className="t full">{text}</div>
      </details>
    ) : (
      <div className="t">{text || <span className="muted">No text.</span>}</div>
    );
  }
  return (
    <details className="thread">
      <summary>
        <span className="t">{summary}</span>
        {by === 'claude' && <span className="byline"> · summary by Claude</span>}
        <span className="open">the note</span>
      </summary>
      {health && <div className="warnline" style={{ marginTop: 6 }}>The note mentions someone&rsquo;s health; the summary leaves it out.</div>}
      <div className="t full">{text}</div>
    </details>
  );
}

function TouchRow({ t, c, now }: { t: Touchpoint; c?: TouchContext; now: number }) {
  const on = t.on ?? t.scheduledFor;
  const who = t.attendees.length ? `With ${t.attendees.join(', ')}` : t.ownerName === 'Not on the team' ? 'Who from our side: not recorded' : t.ownerName;
  const mark = touchMark(t, now);
  return (
    <div className="tl-row">
      <Glyph name={mark.name} title={mark.title} tone={mark.tone} />
      <div className="anote">
        <div className="p2">
          {on ? shortDate(on) : 'undated'}{!t.on && t.scheduledFor ? ' · scheduled' : ''} · {CHANNEL_LABEL[t.channel]}
          {t.direction ? ` · ${DIRECTION_LABEL[t.direction]}` : ''} · {t.vehicleName ?? 'no vehicle in particular'}
          {t.viaOrganization ? ` · with ${t.viaOrganization}` : ''} · {source(t)}
          {c?.what && SIGNALS.includes(c.what) ? <> · <b className="whatword">{WHAT_LABEL[c.what]}</b></> : null}
        </div>
        {c?.title && <div className="t"><b>{c.title}</b></div>}
        {c?.text ? (
          <Thread summary={c.summary ?? null} by={c.summaryBy ?? null} text={c.text} health={Boolean(c.health)} />
        ) : (
          <div className="t"><span className="muted">{t.summary ?? who}</span></div>
        )}
        {c?.text && <div className="p2" style={{ marginTop: 3 }}>{who}</div>}
        {t.read && <span className="flag f-mute" style={{ marginTop: 4, display: 'inline-block' }}>{READ_LABEL[t.read]}{t.readByName ? ` — ${t.readByName}` : ''}</span>}
      </div>
    </div>
  );
}

function NoteRow({ n }: { n: NoteView }) {
  const mark = noteMark(n);
  const said = n.reading?.what ? WHAT_LABEL[n.reading.what] : n.deckView ? 'Viewed the deck' : null;
  return (
    <div className="tl-row">
      <Glyph name={mark.name} title={mark.title} tone={mark.tone} />
      <div className="anote">
        <div className="p2">
          {shortDate(n.createdAt)} · {said ? <><b className="whatword">{said}</b> · {n.kindLabel.toLowerCase()} by</> : `${n.kindLabel} ·`} {n.author}
          {n.via.kind === 'organization' ? ` · on ${n.via.name}` : ''}
          {n.authorOnTeam ? '' : ' (not on the team)'}
          {n.updatedAt ? ` · edited ${shortDate(n.updatedAt)}` : ''}
          {n.replies ? ` · ${n.replies} ${n.replies === 1 ? 'reply' : 'replies'} not read` : ''}
          {n.alsoAttached ? ` · also on ${n.alsoAttached} other ${n.alsoAttached === 1 ? 'record' : 'records'}` : ''}
        </div>
        <Thread summary={n.reading?.summary ?? null} by={n.reading?.by ?? null} text={n.text} health={n.health} />
      </div>
    </div>
  );
}

/** Their read, a person's or a suggestion from a note — and, for a suggestion, the two answers. */
function TheirRead({ r, pursuitId }: { r: ShownRead | null; pursuitId: string }) {
  if (!r) return <>nobody has recorded one</>;
  // Superseded by what happened since (N57): shown struck, with what superseded it, and not
  // counted as their read. A person can still dismiss a suggestion; there is nothing to confirm.
  if (r.superseded) {
    return (
      <span>
        <s className="muted">{READ_LABEL[r.read]}</s>
        <span className="muted"> — {r.suggested ? `suggested by ${r.byName} from a note` : r.byName ?? 'unattributed'} of {r.on ? shortDate(r.on) : 'an unknown date'}; since then, {r.superseded.what}. Not their read now.</span>
        {r.suggested && (
          <span className="readacts">
            <form action={decideReadingAction}>
              <input type="hidden" name="noteId" value={r.noteId ?? ''} />
              <input type="hidden" name="pursuitId" value={pursuitId} />
              <input type="hidden" name="decision" value="dismiss" />
              <button className="btn" type="submit">Dismiss</button>
            </form>
          </span>
        )}
      </span>
    );
  }
  const age = r.old && r.on ? <span className="muted"> · old: {Math.round((Date.now() - r.on.getTime()) / (30 * 86_400_000))} months</span> : null;
  if (!r.suggested && r.noteId) {
    return <>{READ_LABEL[r.read]} — confirmed by {r.byName ?? 'someone'} from a note of {r.on ? shortDate(r.on) : 'an unknown date'}{r.basis ? `: “${r.basis}”` : ''}{age}</>;
  }
  if (!r.suggested) return <>{READ_LABEL[r.read]} — {r.byName ?? 'unattributed'}{r.on ? `, ${shortDate(r.on)}` : ''}{age}</>;
  return (
    <span>
      <span className="suggested">{READ_LABEL[r.read]}</span>
      <span className="muted"> — suggested by {r.byName} from a note of {r.on ? shortDate(r.on) : 'an unknown date'}{r.basis ? `: “${r.basis}”` : ''}. Not confirmed.</span>{age}
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

type Item = { at: number; key: string } & ({ kind: 'touch'; t: Touchpoint } | { kind: 'note'; n: NoteView });

/**
 * Everything that has happened with this LP, in one thread (N56; N51 for the touchpoints): the
 * meetings, calls and emails, and the team's notes in Affinity, newest first. A note Affinity ties
 * to a meeting, call or email opens inside that row rather than standing on its own. The counts
 * above it are derived here, never set — so a second meeting is a second row, not a stage.
 */
export function Timeline(props: {
  touches: Touchpoint[]; summary: TouchpointSummary; notes: NoteView[];
  pursuitId: string; entityId: string; vehicleId: string; vehicleName: string;
  /** The last calendar read stopped at its cap: some meetings are not here yet (rule 7). */
  calendarPartial?: boolean;
  context?: Record<string, TouchContext>;
  read?: ShownRead | null;
}) {
  const { touches, summary: s, notes } = props;
  const now = Date.now();
  const inside = new Set(Object.values(props.context ?? {}).map((c) => c.noteId).filter((x): x is number => typeof x === 'number'));
  const alone = notes.filter((n) => !inside.has(n.noteId));
  const items: Item[] = [
    ...touches.map((t): Item => ({ kind: 'touch', t, key: `t:${t.touchpointId}`, at: (t.on ?? t.scheduledFor)?.getTime() ?? 0 })),
    ...alone.map((n): Item => ({ kind: 'note', n, key: `n:${n.noteId}`, at: n.createdAt.getTime() })),
  ].sort((a, b) => b.at - a.at);
  const row = (x: Item) => (x.kind === 'touch'
    ? <TouchRow key={x.key} t={x.t} c={props.context?.[x.t.touchpointId]} now={now} />
    : <NoteRow key={x.key} n={x.n} />);
  // The key: each icon on this timeline once, with its words (colour is never the only signal).
  const key = new Map<string, Mark>();
  for (const x of items) {
    const m = x.kind === 'touch' ? touchMark(x.t, now) : noteMark(x.n);
    if (!key.has(m.title)) key.set(m.title, m);
  }
  const onOrg = notes.filter((x) => x.via.kind === 'organization').length;
  const notesRead = notes.reduce((a, x) => (x.fetchedAt > a ? x.fetchedAt : a), new Date(0));

  return (
    <div className="card">
      <div className="chead">
        <h2>Timeline</h2>
        <span className="lbl">
          {touches.length} {touches.length === 1 ? 'touchpoint' : 'touchpoints'} · {s.meetingDates.length} {s.meetingDates.length === 1 ? 'meeting' : 'meetings'} · {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
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
          <span><TheirRead r={props.read ?? (s.read ? { ...s.read, suggested: false, basis: null, noteId: null, superseded: null, old: false } : null)} pursuitId={props.pursuitId} /></span>
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
        <div className="timeline">
          {items.length === 0 && <p className="muted">Nothing on record yet: no touchpoint, and no note in Affinity.</p>}
          {items.slice(0, SHOWN).map(row)}
          {items.length > SHOWN && (
            <details className="more">
              <summary>{items.length - SHOWN} older</summary>
              {items.slice(SHOWN).map(row)}
            </details>
          )}
        </div>
        {key.size > 1 && (
          <div className="tl-key" aria-label="What the icons mean">
            {[...key.values()].map((m) => <span key={m.title}><Glyph name={m.name} title={m.title} tone={m.tone} />{m.title}</span>)}
          </div>
        )}
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
        {notes.length > 0 && (
          <>
            {' '}<b>The notes</b> are the team&rsquo;s, as written in Affinity{onOrg ? `, ${onOrg} of them on their firm` : ''} — a
            record of what was said, not evidence for the ladder — copied by the{' '}
            <Link href="/dev/affinity/notes">notes read</Link> {ago(notesRead)}; Affinity is unchanged.
          </>
        )}
      </p>
    </div>
  );
}
