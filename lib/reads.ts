import type { Read, TouchpointSummary } from '@/modules/meetings';
import type { NoteReading } from '@/lib/connectors/affinity/readings';

/** The read a page shows for an LP: a person's, or — marked — a suggestion from a note. */
export interface ShownRead {
  read: Read;
  on: Date | null;
  byName: string | null;
  suggested: boolean;
  basis: string | null;
  noteId: string | null;
}

/**
 * The newest read wins, with one rule: a suggestion shows only when it is newer than anything a
 * person recorded — a read somebody took in the room outranks one inferred from a note written
 * before it (N55, docs/17 §4). A confirmed suggestion is a person's read, attributed to them.
 */
export function shownRead(fromLog: TouchpointSummary['read'], readings: NoteReading[]): ShownRead | null {
  const time = (r: { on: Date | null }) => r.on?.getTime() ?? 0;
  const people: ShownRead[] = [
    ...(fromLog ? [{ read: fromLog.read, on: fromLog.on, byName: fromLog.byName, suggested: false, basis: null, noteId: null }] : []),
    ...readings.filter((r) => r.read && !r.dismissed && r.confirmedAt)
      .map((r) => ({ read: r.read!, on: r.on, byName: r.confirmedByName, suggested: false, basis: r.basis, noteId: r.noteId })),
  ].sort((a, b) => time(b) - time(a));
  const suggestion = readings.filter((r) => r.read && !r.dismissed && !r.confirmedAt)
    .map((r) => ({ read: r.read!, on: r.on, byName: r.by === 'claude' ? 'Claude' : r.by, suggested: true, basis: r.basis, noteId: r.noteId }))
    .sort((a, b) => time(b) - time(a))[0];
  const person = people[0] ?? null;
  if (suggestion && (!person || time(suggestion) > time(person))) return suggestion;
  return person;
}
