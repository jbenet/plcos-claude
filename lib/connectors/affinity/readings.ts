import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { parseJsonc } from '@/lib/jsonc';
import { READS, type Read } from '@/modules/meetings';
import { mentionsHealth } from './inventory';
import type { AffinityNote } from './notes';

/**
 * Readings of the notes (N55, docs/17 §4): what each note says in a sentence, and their read if
 * it gives one. They are written to a file in data/<profile>/ by whoever read the notes — the
 * first ones by Claude, in a working session — and the next translation loads them. Each is a
 * suggestion until a person confirms it on the LP's page; one a person dismissed stays
 * dismissed, whatever the file says next time.
 *
 * A note that mentions health is read only with that detail taken out (N56). Juan, 23 Sep: "fine
 * to read them and process. feel free to redact any info going into the system for privacy. (if
 * so, make it clear in the redacted text.)" So its line loads only when the summary says what was
 * taken out, in brackets — "[health detail redacted]" — and neither the summary nor the basis
 * trips the health test itself. Anything else is refused, as before (Report 4 §6.2).
 */

export const READINGS_PATH = join(config.data.root, 'readings.jsonc');
/** The demo's readings are invented, and live with the fixtures so a reset keeps them. */
const DEMO_READINGS = join('fixtures', 'affinity', 'readings.demo.jsonc');

/**
 * What happened, as the note tells it (N56): one word, for the icon on the LP's timeline. The
 * list is the check; a word not on it loads as null.
 */
export const WHATS = [
  'meeting_notes', 'questions', 'materials', 'deck_view', 'indication', 'signed', 'declined',
  'intro', 'update', 'background', 'pipeline',
] as const;
export type What = (typeof WHATS)[number];
export const WHAT_LABEL: Record<What, string> = {
  meeting_notes: 'Meeting notes', questions: 'Asked questions', materials: 'Materials',
  deck_view: 'Viewed the deck', indication: 'Gave a number', signed: 'Signed', declined: 'Declined',
  intro: 'Intro', update: 'Portfolio update', background: 'Background', pipeline: 'Added to a list',
};
export const isWhat = (x: unknown): x is What => typeof x === 'string' && (WHATS as readonly string[]).includes(x);

export interface ReadingLine {
  summary?: string | null;
  read?: Read | null;
  basis?: string | null;
  what?: string | null;
}

export interface ReadingFile {
  by: string;
  at: string;
  notes: Record<string, ReadingLine>;
}

export async function readingsFile(path = READINGS_PATH): Promise<ReadingFile | null> {
  for (const p of config.data.profile === 'demo' ? [path, DEMO_READINGS] : [path]) {
    try {
      const raw = parseJsonc(await readFile(resolve(process.cwd(), p), 'utf8')) as Partial<ReadingFile>;
      if (raw && typeof raw === 'object' && raw.notes) return { by: raw.by ?? 'unknown', at: raw.at ?? '', notes: raw.notes };
    } catch {
      /* not there: the next candidate */
    }
  }
  return null;
}

export interface ImportCounts { loaded: number; health: number; redacted: number; unknown: number; keptDecisions: number }

/** How a line says that something was taken out: in brackets, with the word "redacted". */
export const REDACTED = /\[[^\]]*\bredacted\b[^\]]*\]/i;

/** A line for a note that mentions health: loaded only if it is marked redacted and is clean. */
export function redactedCleanly(line: ReadingLine): boolean {
  return REDACTED.test(line.summary ?? '') && !mentionsHealth(`${line.summary ?? ''} ${line.basis ?? ''}`);
}

/** Load the file's readings for the notes that landed. Inside translation's transaction. */
export async function importReadings(tx: Queryable, notes: AffinityNote[], path?: string): Promise<ImportCounts> {
  const counts: ImportCounts = { loaded: 0, health: 0, redacted: 0, unknown: 0, keptDecisions: 0 };
  const file = await readingsFile(path);
  if (!file) return counts;
  const byId = new Map(notes.map((n) => [String(n.id), n]));
  for (const [id, line] of Object.entries(file.notes)) {
    const note = byId.get(id);
    if (!note) { counts.unknown++; continue; }
    if (mentionsHealth(note.content?.html ?? '')) {
      if (!redactedCleanly(line)) { counts.health++; continue; }
      counts.redacted++;
    }
    const read = line.read && READS.includes(line.read) ? line.read : null;
    const rows = await tx.query<{ decided: boolean }>(
      `insert into meetings.note_reading (source, note_id, summary, read, basis, read_by, read_at, what)
       values ('affinity', $1, $2, $3::meetings.read, $4, $5, $6, $7)
       on conflict (source, note_id) do update set
         summary = excluded.summary,
         what = excluded.what,
         -- A person's decision stands: a confirmed or dismissed read is not re-suggested.
         read = case when meetings.note_reading.confirmed_at is null and meetings.note_reading.dismissed_at is null
                     then excluded.read else meetings.note_reading.read end,
         basis = case when meetings.note_reading.confirmed_at is null and meetings.note_reading.dismissed_at is null
                      then excluded.basis else meetings.note_reading.basis end
       returning (confirmed_at is not null or dismissed_at is not null) as decided`,
      [id, line.summary?.trim() || null, read, line.basis?.trim() || null, file.by, file.at || new Date().toISOString(), isWhat(line.what) ? line.what : null],
    );
    counts.loaded++;
    if (rows[0]?.decided) counts.keptDecisions++;
  }
  return counts;
}

export interface NoteReading {
  noteId: string;
  entityId: string;
  /** When the note was written: the read is dated by it. */
  on: Date;
  summary: string | null;
  read: Read | null;
  basis: string | null;
  by: string;
  confirmedByName: string | null;
  confirmedAt: Date | null;
  dismissed: boolean;
}

/**
 * The readings of the notes attached to these entities — to them, not to their firm, because a
 * note on the firm may be about a colleague. Newest first.
 */
export async function readingsFor(entityIds: string[]): Promise<NoteReading[]> {
  if (!entityIds.length) return [];
  const db = await getDb();
  const rows = await db.query<{
    note_id: string; entity_id: string; at: string; summary: string | null; read: Read | null; basis: string | null;
    read_by: string; confirmed_by_name: string | null; confirmed_at: Date | string | null; dismissed_at: Date | string | null;
  }>(
    `with ids as (
       select r.entity_id, r.source_id from identity.source_record r
        where r.source = 'affinity' and r.entity_id = any($1::uuid[])
     ),
     n as (
       select distinct on (source_id) source_id, payload from sources.raw_record
        where source = 'affinity' and kind = 'note' order by source_id, fetched_at desc, id desc
     ),
     att as (
       select n.source_id as note_id, n.payload->>'createdAt' as at, 'person:' || (x->>'id') as key
         from n cross join lateral jsonb_array_elements(coalesce(n.payload->'personsPreview'->'data', '[]'::jsonb)) x
       union all
       select n.source_id, n.payload->>'createdAt', 'company:' || (x->>'id')
         from n cross join lateral jsonb_array_elements(coalesce(n.payload->'companiesPreview'->'data', '[]'::jsonb)) x
     )
     select distinct att.note_id, ids.entity_id, att.at, nr.summary, nr.read::text as read, nr.basis, nr.read_by,
            u.name as confirmed_by_name, nr.confirmed_at, nr.dismissed_at
       from att
       join ids on ids.source_id = att.key
       join meetings.note_reading nr on nr.source = 'affinity' and nr.note_id = att.note_id
       left join platform.app_user u on u.id = nr.confirmed_by
      order by att.at desc`,
    [entityIds],
  );
  return rows.map((r) => ({
    noteId: r.note_id, entityId: r.entity_id, on: new Date(r.at), summary: r.summary, read: r.read, basis: r.basis,
    by: r.read_by, confirmedByName: r.confirmed_by_name, confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null,
    dismissed: Boolean(r.dismissed_at),
  }));
}

/** A person agrees with a suggested read, or says it is wrong. Either way, it is theirs now. */
export async function decideReading(actorId: string, noteId: string, decision: 'confirm' | 'dismiss'): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      decision === 'confirm'
        ? `update meetings.note_reading set confirmed_by = $2, confirmed_at = now(), dismissed_by = null, dismissed_at = null where source = 'affinity' and note_id = $1`
        : `update meetings.note_reading set dismissed_by = $2, dismissed_at = now(), confirmed_by = null, confirmed_at = null where source = 'affinity' and note_id = $1`,
      [noteId, actorId],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'note', null, $3)`,
      [actorId, `reading.${decision}ed`, JSON.stringify({ note: noteId })],
    );
  });
}
