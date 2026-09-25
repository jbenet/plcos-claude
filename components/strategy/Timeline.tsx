import Link from '@/components/ui/AppLink';
import { ago, shortDate } from '@/lib/time';
import {
  CHANNEL_LABEL, DIRECTION_LABEL, READ_LABEL, eventAbout, isEvent, type EventAbout, type RaiseWindow, type Touchpoint, type TouchpointSummary,
} from '@/modules/meetings';
import type { ShownRead } from '@/lib/reads';
import type { NoteView } from '@/lib/connectors/affinity/notes';
import { WHAT_LABEL, type What } from '@/lib/connectors/affinity/readings';
import { decideReadingAction } from '@/app/targets/actions';
import { interactionRef, noteRef } from '@/lib/connectors/affinity/event-tags';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import { refOf, type RungRecord } from '@/lib/reconcile';
import {
  RUNG_LABEL, STATUS_LABEL, rungIndex, type LadderEvent, type LadderRung, type PursuitStatus, type PursuitUpdate,
} from '@/modules/strategy';
import { EntryBox } from './EntryBox';
import { TIMELINE_PAGE, TimelineRows, type TimelineOption, type TimelineRow } from './TimelineRows';
import { TagControl, TagVehicles, type TagVehicle } from './TagControl';

/** A status change from the audit log (N61): what it was, what it became, who, and why. */
export interface StatusEvent {
  at: Date;
  from: string;
  to: string;
  byName: string | null;
  reason: string | null;
  /** Set when an update made the change: the update's row shows it, not a row of its own. */
  updateId: string | null;
}

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
  // Many of ours on one calendar entry (N81): an event, not a meeting with them.
  if (isEvent(t)) return { name: 'ticket', title: upcoming ? 'An event, still ahead' : 'An event: many of ours on one calendar entry' };
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

/**
 * What a row changed on the ladder (N61, issue 0006): the rungs it is the record for, confirmed —
 * in green, with who confirmed them and when — or on record and waiting for a person to confirm.
 * Folded into the row that is their evidence, so the state is seen changing where it changed.
 */
function RungState({ rungs, waiting, proposalId }: { rungs: LadderEvent[]; waiting: LadderRung[]; proposalId?: string | null }) {
  if (!rungs.length && !waiting.length) return null;
  const groups = new Map<string, LadderEvent[]>();
  for (const r of rungs) {
    const k = `${shortDate(r.recordedAt)}|${r.recordedByName}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <div className="tl-state">
      {[...groups.entries()].map(([k, rs]) => (
        <span className="rungchg" key={k}>
          <Glyph name="rung" title="On the ladder" tone="good" />
          <span>
            On the ladder: {rs.map((r) => `${RUNG_LABEL[r.rung]}${r.evidenceKind === 'not_applicable' ? ' (not applicable: in direct contact)' : ''}`).join(', ')}
            <span className="muted"> — confirmed {k.split('|')[0]} by {k.split('|')[1]}</span>
          </span>
        </span>
      ))}
      {waiting.length > 0 && (
        <span className="rungpend">
          <Glyph name="rung" title="On record, not confirmed" />
          <span>
            The record for {waiting.map((r) => RUNG_LABEL[r]).join(', ')} — not confirmed yet
            {proposalId ? <> · <Link href={`/approvals?t=${proposalId}`}>confirm it</Link></> : ''}
          </span>
        </span>
      )}
    </div>
  );
}

type Tagger = 'rule' | 'claude' | 'person' | null;

/** Who said what a row is about, and on what: for the tag's panel, and a chip's title. */
function whySaid(by: Tagger, byName: string | null, basis: string | null): string {
  const who = by === 'person' ? `Tagged by ${byName ?? 'a person'}` : by === 'claude' ? 'Tagged by Claude' : by === 'rule' ? 'Read by the rules' : 'Logged here';
  return basis ? `${who}: ${basis}` : who;
}

/**
 * What a row is about, first on its line (N81): each vehicle it is about — marked when it falls
 * outside that vehicle's raise window and so is not counted for it — or "Vehicle unclear", or
 * "General": not about one raise, and so about the LP whatever the vehicle. Words, not colour: colour
 * only repeats them.
 */
function AboutChips({ a, why }: { a: EventAbout; why: string }) {
  if (a.kind === 'vehicles') {
    return (
      <>
        {a.vehicles.map((v) => (
          <span key={v.slug} className={`vtag${v.counts ? '' : ' out'}`} title={v.counts ? why : `${why} — outside its raise window, so not counted for it`}>
            {v.name}{v.counts ? '' : <i> · not counted</i>}
          </span>
        ))}
      </>
    );
  }
  if (a.kind === 'unclear') return <span className="vtag unclear" title={why}>Vehicle unclear</span>;
  return <span className="vtag none" title={why}>General</span>;
}

/** What a row is about, in the tag panel's words: "PLC Neurotech I — Tagged by Claude: …". */
function nowSaid(a: EventAbout, why: string): string {
  return `${a.kind === 'vehicles' ? a.vehicles.map((v) => v.name).join(', ') : a.kind === 'unclear' ? 'a raise, vehicle unclear' : 'general'} — ${why}`;
}

function TouchRow({ t, c, now, rungs = [], waiting = [], proposalId, fromUpdate, about, tagging }: {
  t: Touchpoint; c?: TouchContext; now: number;
  rungs?: LadderEvent[]; waiting?: LadderRung[]; proposalId?: string | null;
  /** Logged by an update: its words are the update's, shown there. */
  fromUpdate?: PursuitUpdate;
  about: EventAbout;
  tagging: { pursuitId: string };
}) {
  const on = t.on ?? t.scheduledFor;
  const why = whySaid(t.source === 'us' ? null : t.aboutBy, null, t.aboutBasis);
  const ref = t.source === 'affinity' ? interactionRef(t.sourceRef) : null;
  const who = t.attendees.length ? `With ${t.attendees.join(', ')}` : t.ownerName === 'Not on the team' ? 'Who from our side: not recorded' : t.ownerName;
  const mark = touchMark(t, now);
  return (
    <div className="tl-row">
      <Glyph name={mark.name} title={mark.title} tone={mark.tone} />
      <div className="anote">
        <div className="p2">
          <AboutChips a={about} why={why} />{' '}
          {on ? shortDate(on) : 'undated'}{!t.on && t.scheduledFor ? ' · scheduled' : ''} · {CHANNEL_LABEL[t.channel]}
          {t.direction && !isEvent(t) ? ` · ${DIRECTION_LABEL[t.direction]}` : ''}
          {isEvent(t) ? ` · an event, ${t.groupSize} of ours on it` : ''}
          {t.viaOrganization ? ` · with ${t.viaOrganization}` : ''} · {source(t)}
          {c?.what && SIGNALS.includes(c.what) ? <> · <b className="whatword">{WHAT_LABEL[c.what]}</b></> : null}
        </div>
        {c?.title && <div className="t"><b>{c.title}</b></div>}
        {fromUpdate ? (
          <div className="t"><span className="muted">Logged from {fromUpdate.createdByName}&rsquo;s update of {shortDate(fromUpdate.createdAt)}</span></div>
        ) : c?.text ? (
          <Thread summary={c.summary ?? null} by={c.summaryBy ?? null} text={c.text} health={Boolean(c.health)} />
        ) : (
          <div className="t"><span className="muted">{t.summary ?? who}</span></div>
        )}
        {c?.text && <div className="p2" style={{ marginTop: 3 }}>{who}</div>}
        {t.read && <span className="flag f-mute" style={{ marginTop: 4, display: 'inline-block' }}>{READ_LABEL[t.read]}{t.readByName ? ` — ${t.readByName}` : ''}</span>}
        <RungState rungs={rungs} waiting={waiting} proposalId={proposalId} />
        {ref && (
          <TagControl
            tagRef={ref} now={nowSaid(about, why)} general={about.kind === 'none'} pursuitId={tagging.pursuitId} what={CHANNEL_LABEL[t.channel].toLowerCase()}
            checked={about.kind === 'vehicles' ? about.vehicles.map((v) => v.slug) : []}
          />
        )}
      </div>
    </div>
  );
}

const CLIP_UPDATE = 480;

/** An update from the team (N61), with what it changed folded in: the status, a touchpoint, a next step. */
/** The chip for a row that belongs to this pursuit — an update, a status, a rung. */
const own = (v: TagVehicle): EventAbout => ({ kind: 'vehicles', vehicles: [{ slug: v.slug, name: v.name, counts: true }] });

function UpdateRow({ u, vehicle }: { u: PursuitUpdate; vehicle: TagVehicle }) {
  const a = u.applied;
  const long = u.body.length > CLIP_UPDATE;
  return (
    <div className="tl-row upd">
      <Glyph name="update" title="An update from the team" tone="signal" />
      <div className="anote">
        <div className="p2"><AboutChips a={own(vehicle)} why="On this pursuit" /> {shortDate(u.createdAt)} · <b className="whatword">Update</b> · {u.createdByName}</div>
        {long ? (
          <details className="thread">
            <summary><span className="t">{u.body.slice(0, CLIP_UPDATE).trimEnd()}…</span><span className="open">the rest</span></summary>
            <div className="t full">{u.body}</div>
          </details>
        ) : <div className="t" style={{ whiteSpace: 'pre-line' }}>{u.body}</div>}
        {(a.status || a.touch || a.nextStep) && (
          <div className="tl-state">
            {a.status && (
              <span className="statechg">
                <Glyph name="status" title="Status changed" />
                <span>Status: {STATUS_LABEL[a.status.from]} → <b>{STATUS_LABEL[a.status.to]}</b></span>
              </span>
            )}
            {a.touch && (
              <span className="muted">
                <i />
                <span>
                  {a.touch.ahead ? 'Put' : 'Logged'} {/^[aeiou]/.test(a.touch.channel) ? 'an' : 'a'} {a.touch.channel} {a.touch.ahead ? 'on record for' : 'on'} {shortDate(new Date(`${a.touch.on}T12:00:00Z`))}
                  {a.touch.read ? `, their read ${READ_LABEL[a.touch.read as keyof typeof READ_LABEL].toLowerCase()}` : ''}
                </span>
              </span>
            )}
            {a.nextStep && (
              <span className="muted">
                <i />
                <span>Next step: &ldquo;{a.nextStep.step}&rdquo;{a.nextStep.on ? `, by ${shortDate(new Date(`${a.nextStep.on}T00:00:00Z`))}` : ''}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A status set here without an update (N61): the old words, the new, who, and why. */
function StatusRow({ s, vehicle }: { s: StatusEvent; vehicle: TagVehicle }) {
  return (
    <div className="tl-row">
      <Glyph name="status" title="Status changed" />
      <div className="anote">
        <div className="p2"><AboutChips a={own(vehicle)} why="On this pursuit" /> {shortDate(s.at)} · <b className="whatword">Status</b> · set by {s.byName ?? 'someone'}</div>
        <div className="t">
          <span className="statechg">{s.from} → <b>{s.to}</b></span>
          {s.reason ? <span className="muted"> · &ldquo;{s.reason.replace(/_/g, ' ')}&rdquo;</span> : null}
        </div>
      </div>
    </div>
  );
}

/** A rung whose record isn't a row on this timeline — a signature, a wire (N61). */
function RungRow({ e, vehicle }: { e: LadderEvent; vehicle: TagVehicle }) {
  return (
    <div className="tl-row">
      <Glyph name="rung" title="On the ladder" tone="good" />
      <div className="anote">
        <div className="p2"><AboutChips a={own(vehicle)} why="On this pursuit" /> {shortDate(e.occurredAt)} · <b className="whatword">On the ladder</b> · confirmed {shortDate(e.recordedAt)} by {e.recordedByName}</div>
        <div className="t">
          <b>{RUNG_LABEL[e.rung]}</b>{e.evidenceKind === 'not_applicable' ? ' — not applicable' : ''}
          <span className="muted"> · {e.evidenceNote}</span>
        </div>
      </div>
    </div>
  );
}

/** A note's tag, as a touchpoint's (N81): a note counts for no ladder, but says what it is about. */
export function noteAbout(n: NoteView, windows: RaiseWindow[]): EventAbout {
  const t = n.tag;
  return eventAbout({
    vehicleId: null, source: 'affinity', about: t?.about ?? 'other', aboutVehicles: t?.vehicles ?? [], aboutBy: t?.by ?? 'rule',
    on: n.createdAt, scheduledFor: null,
  }, windows);
}

function NoteRow({ n, about, tagging }: { n: NoteView; about: EventAbout; tagging: { pursuitId: string } }) {
  const mark = noteMark(n);
  const said = n.reading?.what ? WHAT_LABEL[n.reading.what] : n.deckView ? 'Viewed the deck' : null;
  const why = whySaid(n.tag?.by ?? 'rule', n.tag?.byName ?? null, n.tag?.basis ?? null);
  return (
    <div className="tl-row">
      <Glyph name={mark.name} title={mark.title} tone={mark.tone} />
      <div className="anote">
        <div className="p2">
          <AboutChips a={about} why={why} />{' '}
          {shortDate(n.createdAt)} · {said ? <><b className="whatword">{said}</b> · {n.kindLabel.toLowerCase()} by</> : `${n.kindLabel} ·`} {n.author}
          {n.via.kind === 'organization' ? ` · on ${n.via.name}` : ''}
          {n.authorOnTeam ? '' : ' (not on the team)'}
          {n.updatedAt ? ` · edited ${shortDate(n.updatedAt)}` : ''}
          {n.replies ? ` · ${n.replies} ${n.replies === 1 ? 'reply' : 'replies'} not read` : ''}
          {n.alsoAttached ? ` · also on ${n.alsoAttached} other ${n.alsoAttached === 1 ? 'record' : 'records'}` : ''}
        </div>
        <Thread summary={n.reading?.summary ?? null} by={n.reading?.by ?? null} text={n.text} health={n.health} />
        <TagControl
          tagRef={noteRef(n.noteId)} now={nowSaid(about, why)} general={about.kind === 'none'} pursuitId={tagging.pursuitId} what="note"
          checked={about.kind === 'vehicles' ? about.vehicles.map((v) => v.slug) : []}
        />
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

type Item = { at: number; key: string } & (
  | { kind: 'touch'; t: Touchpoint }
  | { kind: 'note'; n: NoteView }
  | { kind: 'update'; u: PursuitUpdate }
  | { kind: 'status'; s: StatusEvent }
  | { kind: 'rung'; e: LadderEvent }
);

const MARK: Record<'update' | 'status' | 'rung', Mark> = {
  update: { name: 'update', title: 'An update from the team', tone: 'signal' },
  status: { name: 'status', title: 'Status changed' },
  rung: { name: 'rung', title: 'On the ladder', tone: 'good' },
};

/**
 * Everything that has happened with this LP, in one thread (N56; N51 for the touchpoints): the
 * meetings, calls and emails, and the team's notes in Affinity, newest first. A note Affinity ties
 * to a meeting, call or email opens inside that row rather than standing on its own. The counts
 * above it are derived here, never set — so a second meeting is a second row, not a stage.
 *
 * And what changed its state (N61, issues 0004 and 0006): the team's updates, with what each
 * changed; status changes made without one; and the ladder, each rung folded into the row that
 * is its record, or a row of its own when its record is not on the timeline.
 *
 * All of it, whatever it is about (N81): every row says which vehicle it is about, and a filter
 * narrows the list to one. The facts above the rows are this pursuit's — what is tagged with its
 * vehicle — and a line beside them counts everything else.
 */
export function Timeline(props: {
  /** Every touchpoint with them, about anything (N81). */
  touches: Touchpoint[];
  /** The ones counted for this pursuit's vehicle, by id: what the summary sums. */
  counted: Set<string>;
  summary: TouchpointSummary; notes: NoteView[];
  pursuitId: string; entityId: string; vehicleId: string; vehicleName: string;
  /** Every vehicle's raise window: what a row's tag is held against. */
  windows: RaiseWindow[];
  /** The last calendar read stopped at its cap: some meetings are not here yet (rule 7). */
  calendarPartial?: boolean;
  context?: Record<string, TouchContext>;
  read?: ShownRead | null;
  /** N61: the status now, for the update row; the updates; status changes; the ladder. */
  status: PursuitStatus;
  today: string;
  updates?: PursuitUpdate[];
  statusEvents?: StatusEvent[];
  ladder?: LadderEvent[];
  /** The records on file for rungs the ladder hasn't accepted, and the proposal to accept them. */
  onRecord?: Partial<Record<LadderRung, RungRecord>>;
  proposalId?: string | null;
  /** N81: the rows asked for — a vehicle's slug, 'unclear', 'none' or 'all' — how many, and where the page lives. */
  filter?: string;
  limit?: number;
  path: string;
}) {
  const { touches, summary: s, notes, windows } = props;
  const now = Date.now();
  const inside = new Set(Object.values(props.context ?? {}).map((c) => c.noteId).filter((x): x is number => typeof x === 'number'));
  const alone = notes.filter((n) => !inside.has(n.noteId));
  const updates = props.updates ?? [];
  const ladder = props.ladder ?? [];
  const self = windows.find((w) => w.vehicleId === props.vehicleId);
  const vehicle: TagVehicle = { slug: self?.slug ?? props.vehicleId, name: props.vehicleName };
  // The tag form offers this pursuit's vehicle first, then the rest.
  // …those raising or that raised first, then any with no window (a grants rail).
  const tagVehicles: TagVehicle[] = [vehicle, ...windows.filter((w) => w.vehicleId !== props.vehicleId)
    .sort((a, b) => Number(!(a.opens || a.closes)) - Number(!(b.opens || b.closes)) || a.name.localeCompare(b.name))
    .map((w) => ({ slug: w.slug, name: w.name }))];
  const tagging = { pursuitId: props.pursuitId };
  // Each rung goes to the row that is its record; one whose record isn't here gets a row.
  const refs = new Map(touches.map((t) => [refOf(t), t.touchpointId]));
  const rungsOn = new Map<string, LadderEvent[]>();
  for (const e of ladder) {
    const at = refs.get(e.evidenceRef);
    if (at) rungsOn.set(at, [...(rungsOn.get(at) ?? []), e]);
  }
  const accepted = new Set(ladder.map((e) => e.rung));
  const waitingOn = new Map<string, LadderRung[]>();
  const onRecord = Object.values(props.onRecord ?? {}).sort((a, b) => rungIndex(a!.rung) - rungIndex(b!.rung));
  for (const r of onRecord) {
    const at = r && !accepted.has(r.rung) ? refs.get(r.ref) : undefined;
    if (at) waitingOn.set(at, [...(waitingOn.get(at) ?? []), r!.rung]);
  }
  const byUpdate = new Map(updates.filter((u) => u.applied.touchpointId).map((u) => [u.applied.touchpointId!, u]));
  const items: Item[] = [
    ...touches.map((t): Item => ({ kind: 'touch', t, key: `t:${t.touchpointId}`, at: (t.on ?? t.scheduledFor)?.getTime() ?? 0 })),
    ...alone.map((n): Item => ({ kind: 'note', n, key: `n:${n.noteId}`, at: n.createdAt.getTime() })),
    ...updates.map((u): Item => ({ kind: 'update', u, key: `u:${u.updateId}`, at: u.createdAt.getTime() })),
    ...(props.statusEvents ?? []).filter((x) => !x.updateId && x.from !== x.to)
      .map((x, i): Item => ({ kind: 'status', s: x, key: `s:${i}:${x.at.getTime()}`, at: x.at.getTime() })),
    ...ladder.filter((e) => !refs.has(e.evidenceRef)).map((e): Item => ({ kind: 'rung', e, key: `r:${e.eventId}`, at: e.occurredAt.getTime() })),
  ].sort((a, b) => b.at - a.at);
  const aboutOf = (x: Item): EventAbout =>
    x.kind === 'touch' ? eventAbout(x.t, windows) : x.kind === 'note' ? noteAbout(x.n, windows) : own(vehicle);
  const groupsOf = (a: EventAbout) => (a.kind === 'vehicles' ? a.vehicles.map((v) => v.slug) : [a.kind]);
  const row = (x: Item, a: EventAbout) => {
    switch (x.kind) {
      case 'touch':
        return (
          <TouchRow
            key={x.key} t={x.t} c={props.context?.[x.t.touchpointId]} now={now}
            rungs={rungsOn.get(x.t.touchpointId)} waiting={waitingOn.get(x.t.touchpointId)} proposalId={props.proposalId}
            fromUpdate={byUpdate.get(x.t.touchpointId)} about={a} tagging={tagging}
          />
        );
      case 'note': return <NoteRow key={x.key} n={x.n} about={a} tagging={tagging} />;
      case 'update': return <UpdateRow key={x.key} u={x.u} vehicle={vehicle} />;
      case 'status': return <StatusRow key={x.key} s={x.s} vehicle={vehicle} />;
      case 'rung': return <RungRow key={x.key} e={x.e} vehicle={vehicle} />;
    }
  };
  const rows: TimelineRow[] = items.map((x) => {
    const a = aboutOf(x);
    return { key: x.key, groups: groupsOf(a), node: () => row(x, a) };
  });
  // The filter: this pursuit's vehicle first, the others it has rows about, then the two kinds of none.
  const tally = new Map<string, number>();
  for (const r of rows) for (const g of r.groups) tally.set(g, (tally.get(g) ?? 0) + 1);
  const nameOf = new Map(windows.map((w) => [w.slug, w.name]));
  const options: TimelineOption[] = [
    ...[vehicle.slug, ...[...tally.keys()].filter((g) => g !== vehicle.slug && nameOf.has(g)).sort((a, b) => nameOf.get(a)!.localeCompare(nameOf.get(b)!))]
      .filter((g) => tally.has(g))
      .map((g) => ({ id: g, label: nameOf.get(g) ?? g, n: tally.get(g)!, hint: g === vehicle.slug ? 'Counted for this pursuit' : 'Another vehicle: not counted here' })),
    ...(tally.has('unclear') ? [{ id: 'unclear', label: 'Vehicle unclear', n: tally.get('unclear')!, hint: 'About a raise, which vehicle not said: counted for none until tagged' }] : []),
    ...(tally.has('none') ? [{ id: 'none', label: 'General', n: tally.get('none')!, hint: 'Not about a raise: a catch-up, background, another company — true of them whatever the vehicle' }] : []),
  ];
  // The key: each icon on this timeline once, with its words (colour is never the only signal).
  const key = new Map<string, Mark>();
  for (const x of items) {
    const m = x.kind === 'touch' ? touchMark(x.t, now) : x.kind === 'note' ? noteMark(x.n) : MARK[x.kind];
    if (!key.has(m.title)) key.set(m.title, m);
  }
  if (rungsOn.size && !key.has(MARK.rung.title)) key.set(MARK.rung.title, MARK.rung);
  if (!key.has(MARK.update.title)) key.set(MARK.update.title, MARK.update);
  const onOrg = notes.filter((x) => x.via.kind === 'organization').length;
  const notesRead = notes.reduce((a, x) => (x.fetchedAt > a ? x.fetchedAt : a), new Date(0));
  const counted = touches.filter((t) => props.counted.has(t.touchpointId));
  // Everything with them, about anything: held, their own, not research.
  const held = touches.filter((t) => !t.viaOrganization && t.channel !== 'research' && t.on && t.on.getTime() <= now);
  const allMeetings = held.filter((t) => t.channel === 'meeting' || t.channel === 'call').length;
  const allLast = held.reduce<Date | null>((a, t) => (!a || t.on! > a ? t.on! : a), null);
  const allNext = touches.filter((t) => !t.viaOrganization && !t.on && t.scheduledFor && t.scheduledFor.getTime() > now)
    .reduce<Date | null>((a, t) => (!a || t.scheduledFor! < a ? t.scheduledFor! : a), null);

  return (
    <div className="card" id="timeline">
      <div className="chead">
        <h2>Timeline</h2>
        <span className="lbl">
          {touches.length} {touches.length === 1 ? 'touchpoint' : 'touchpoints'}, {counted.length} about {props.vehicleName} · {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          {updates.length ? ` · ${updates.length} ${updates.length === 1 ? 'update' : 'updates'}` : ''}
        </span>
      </div>
      <div className="cbody">
        <p className="p2 tl-scope">Counted for {props.vehicleName} — the rows tagged with it:</p>
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
        {held.length > 0 && (
          <div className="fact">
            <span>All contact</span>
            <span className="muted">
              {held.length} with them, about anything · {allMeetings} {allMeetings === 1 ? 'meeting or call' : 'meetings and calls'}
              {allLast ? ` · last ${shortDate(allLast)}` : ''}{allNext ? ` · next ${shortDate(allNext)}` : ''}
            </span>
          </div>
        )}
        <div className="timeline">
          <EntryBox pursuitId={props.pursuitId} entityId={props.entityId} vehicleId={props.vehicleId} vehicleName={props.vehicleName} status={props.status} today={props.today} />
          {items.length === 0 && <p className="muted" style={{ marginTop: 8 }}>Nothing on record yet: no touchpoint, and no note in Affinity.</p>}
          <TagVehicles vehicles={tagVehicles}>
            <TimelineRows rows={rows} options={options} filter={props.filter ?? 'all'} limit={props.limit ?? TIMELINE_PAGE} path={props.path} />
          </TagVehicles>
        </div>
        {key.size > 1 && (
          <div className="tl-key" aria-label="What the icons mean">
            {[...key.values()].map((m) => <span key={m.title}><Glyph name={m.name} title={m.title} tone={m.tone} />{m.title}</span>)}
          </div>
        )}
      </div>
      <p className="cover">
        <b>What this covers:</b> touchpoints logged here, and those Affinity has — each list
        entry&rsquo;s last email and meetings, the calendar, and meeting, call and email notes — as of
        the last translation, about anything. Each row says which vehicle it is about: named in it,
        or tagged by Claude or a person. Only rows tagged with {props.vehicleName}, inside its raise
        window, count for this pursuit and its ladder; a row about a raise that doesn&rsquo;t say which
        counts for none until someone tags it. A meeting nobody logged and no calendar saw is not here.
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
