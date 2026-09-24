import { config } from '@/config/deployment';
import type { Read, TouchpointSummary } from '@/modules/meetings';
import type { NoteReading } from '@/lib/connectors/affinity/readings';
import { STEP_LABEL, type CloseTrack } from '@/modules/pipeline';
import type { Pursuit } from '@/modules/strategy';

/** The read a page shows for an LP: a person's, or — marked — a suggestion from a note. */
export interface ShownRead {
  read: Read;
  on: Date | null;
  byName: string | null;
  suggested: boolean;
  basis: string | null;
  noteId: string | null;
  /**
   * A later record that points the other way (N57): a commitment after "not very interested",
   * a decline after "interested". The read stays, dated; it just isn't their read any more.
   */
  superseded: { what: string; on: Date } | null;
  /** Older than config.reads.staleAfterDays, and nothing has superseded it. */
  old: boolean;
}

/** Something that happened, with a date, and which way it points. */
export interface LaterFact { on: Date; points: 'up' | 'down'; what: string }

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * What an LP has done since, from the records that point one way or the other (N57): a
 * commitment, a signature, a wire; a decline, a withdrawal. The status counts when it says
 * Committed, or that they declined, dated by when a person set it or when the source was read.
 * Meetings and "Discussing" do not count: an LP can meet us and still be lukewarm.
 */
export function laterFacts(p: Pursuit, tracks: CloseTrack[]): LaterFact[] {
  const out: LaterFact[] = [];
  const at = p.statusSource === 'us' ? p.statusSetAt : p.sourceAsOf;
  const whose = p.statusSource === 'us' ? `set here${p.statusSetByName ? ` by ${p.statusSetByName}` : ''}` : `per Affinity, as of ${at ? fmt(at) : 'the last read'}`;
  if (at && p.status === 'committed') out.push({ on: at, points: 'up', what: `committed (${whose})` });
  if (at && p.status === 'passed' && p.passedBy === 'them') out.push({ on: at, points: 'down', what: `they declined (${whose})` });
  for (const t of tracks) {
    for (const e of t.events) {
      const on = e.on ?? (e.source === 'us' ? e.recordedAt : t.exposure.sourceAsOf);
      if (!on) continue;
      const src = e.source === 'us' ? 'recorded here' : `per ${e.source === 'affinity' ? 'Affinity' : e.source}, as of ${fmt(on)}`;
      if (e.step === 'withdrawn') out.push({ on, points: 'down', what: `withdrew (${src})` });
      else out.push({ on, points: 'up', what: `${STEP_LABEL[e.step].toLowerCase()} (${src})` });
    }
  }
  return out;
}

/**
 * The newest read wins, with one rule: a suggestion shows only when it is newer than anything a
 * person recorded — a read somebody took in the room outranks one inferred from a note written
 * before it (N55, docs/17 §4). A confirmed suggestion is a person's read, attributed to them.
 *
 * Then what happened since is laid beside it (N57, docs/18): a later record pointing the other
 * way supersedes it, and one past config.reads.staleAfterDays is old.
 */
export function shownRead(
  fromLog: TouchpointSummary['read'], readings: NoteReading[], later: LaterFact[] = [], now = new Date(),
): ShownRead | null {
  const time = (r: { on: Date | null }) => r.on?.getTime() ?? 0;
  const people = [
    ...(fromLog ? [{ read: fromLog.read, on: fromLog.on, byName: fromLog.byName, suggested: false, basis: null, noteId: null }] : []),
    ...readings.filter((r) => r.read && !r.dismissed && r.confirmedAt)
      .map((r) => ({ read: r.read!, on: r.on, byName: r.confirmedByName, suggested: false, basis: r.basis, noteId: r.noteId })),
  ].sort((a, b) => time(b) - time(a));
  const suggestion = readings.filter((r) => r.read && !r.dismissed && !r.confirmedAt)
    .map((r) => ({ read: r.read!, on: r.on, byName: r.by === 'claude' ? 'Claude' : r.by, suggested: true, basis: r.basis, noteId: r.noteId }))
    .sort((a, b) => time(b) - time(a))[0];
  const person = people[0] ?? null;
  const shown = suggestion && (!person || time(suggestion) > time(person)) ? suggestion : person;
  if (!shown) return null;
  const against = later
    .filter((f) => f.on.getTime() > time(shown) && (shown.read === 'not_very_interested' ? f.points === 'up' : f.points === 'down'))
    .sort((a, b) => b.on.getTime() - a.on.getTime())[0];
  const age = shown.on ? now.getTime() - shown.on.getTime() : 0;
  return {
    ...shown,
    superseded: against ? { what: against.what, on: against.on } : null,
    old: !against && age > config.reads.staleAfterDays * 86_400_000,
  };
}
