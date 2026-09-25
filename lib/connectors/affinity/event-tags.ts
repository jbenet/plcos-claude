import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { parseJsonc } from '@/lib/jsonc';
import type { About } from './about';
import { mentionsHealth } from './inventory';
import { noteText, type AffinityNote } from './notes';

/**
 * Which vehicles each event is about (N81, meetings/006).
 *
 * Juan, 24 Sep: "some meetings or notes from affinity are getting attributed to PLC Neurotech when
 * they may be for PLC Rails, or they may just be general catchups. Hmm maybe tag each event with
 * which vehicles (if any) it involves, then show that in the UIs/UX." And: "Important that the
 * info feeding strategy is appropriately tagged for the vehicle. some of the info will apply
 * regardless of vehicle, but some will be specific."
 *
 * Three readers, each overriding the one before:
 *
 *   rule    the rules of N59 (./about), on every translation. An interaction's reading stays on
 *           its touchpoints; a note's is kept here, so the timeline and the strategy export can
 *           read it by the note's id.
 *   claude  a file Claude writes after reading the records — data/<profile>/event-tags.jsonc —
 *           loaded by translation the way the note readings are. Each line is a suggestion in the
 *           sense that a person can replace it; it counts until they do, because the ladder only
 *           moves on a person's approval anyway (rule 3).
 *   person  set on the LP's page. It stands, whatever the file says next time.
 *
 * A tag is keyed as Affinity keys the record — `interaction:email:123`, `note:456` — so every LP
 * on a meeting shares it. A note on a meeting is tagged with the meeting: it is part of it.
 */

export const EVENT_TAGS_PATH = join(config.data.root, 'event-tags.jsonc');
/** The demo's tags are invented, and live with the fixtures so a reset keeps them. */
const DEMO_TAGS = join('fixtures', 'affinity', 'event-tags.demo.jsonc');

export type TagBy = 'rule' | 'claude' | 'person';

export interface EventTag {
  ref: string;
  about: 'raise' | 'other';
  vehicles: string[];
  basis: string | null;
  by: TagBy;
  /** For a person's tag: who. */
  byName: string | null;
  at: Date;
}

export interface TagLine { about?: string; vehicles?: string[]; basis?: string | null }
export interface TagFile { by: string; at: string; tags: Record<string, TagLine> }

const REF = /^(interaction:(?:email|meeting|call|chat-message):\d+|note:\d+)$/;
export const isTagRef = (ref: string) => REF.test(ref);

/** The interaction a touchpoint was read from, as its tag is keyed: `interaction:email:123`. */
export const interactionRef = (sourceRef: string | null | undefined): string | null =>
  /^(interaction:[a-z-]+:\d+):/.exec(sourceRef ?? '')?.[1] ?? null;

export const noteRef = (noteId: number | string) => `note:${noteId}`;

/** The interaction a note is on, keyed as its tag would be. A notetaker's summary is on a meeting. */
export function noteInteractionRef(n: Pick<AffinityNote, 'type' | 'interaction'>): string | null {
  if (!n.interaction?.id) return null;
  return `interaction:${n.type === 'ai-notetaker' ? 'meeting' : n.interaction.type}:${n.interaction.id}`;
}

export async function tagFile(path = EVENT_TAGS_PATH): Promise<TagFile | null> {
  for (const p of config.data.profile === 'demo' ? [path, DEMO_TAGS] : [path]) {
    try {
      const raw = parseJsonc(await readFile(resolve(process.cwd(), p), 'utf8')) as Partial<TagFile>;
      if (raw && typeof raw === 'object' && raw.tags) return { by: raw.by ?? 'claude', at: raw.at ?? '', tags: raw.tags };
    } catch {
      /* not there: the next candidate */
    }
  }
  return null;
}

/** A line checked: a known ref, a known about, known vehicles, and "other" with none. */
export function checkLine(ref: string, line: TagLine, slugs: Set<string>): { about: 'raise' | 'other'; vehicles: string[]; basis: string | null } | string {
  if (!REF.test(ref)) return 'not an event key';
  const about = line.about === 'raise' || line.about === 'other' ? line.about : null;
  if (!about) return 'about is neither raise nor other';
  const vehicles = [...new Set(line.vehicles ?? [])].sort();
  if (vehicles.some((v) => !slugs.has(v))) return 'names a vehicle that is not one of ours';
  if (about === 'other' && vehicles.length) return 'about something else, yet names a vehicle';
  const basis = line.basis?.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  // The basis is shown on the LP's page: it never carries a health detail (Report 4 §6.2).
  if (basis && mentionsHealth(basis)) return 'the basis mentions health';
  return { about, vehicles, basis };
}

export interface TagCounts { rule: number; claude: number; keptPerson: number; refused: Record<string, number>; applied: number }

/**
 * Inside translation's transaction, after the touchpoints: the rules' reading of each note, then
 * Claude's file, then every tag laid over the touchpoints it names. A person's tag is never
 * replaced; Claude's is never replaced by a rule.
 */
export async function translateTags(
  tx: Queryable, notes: AffinityNote[], read: (text: string) => About, slugs: string[], path?: string,
): Promise<TagCounts> {
  const counts: TagCounts = { rule: 0, claude: 0, keptPerson: 0, refused: {}, applied: 0 };
  const rows = notes.map((n) => {
    const a = read(noteText(n.content?.html ?? ''));
    return { ref: noteRef(n.id), about: a.about, vehicles: a.vehicles, basis: a.basis };
  });
  if (rows.length) {
    counts.rule = (await tx.query(
      `insert into meetings.event_tag (source, ref, about, vehicles, basis, by_kind)
       select 'affinity', x->>'ref', x->>'about', array(select jsonb_array_elements_text(x->'vehicles')), x->>'basis', 'rule'
         from jsonb_array_elements($1::jsonb) x
       on conflict (source, ref) do update set about = excluded.about, vehicles = excluded.vehicles, basis = excluded.basis,
         tagged_at = now()
        where meetings.event_tag.by_kind = 'rule'
       returning ref`,
      [JSON.stringify(rows)],
    )).length;
  }

  const file = await tagFile(path);
  if (file) {
    const known = new Set(slugs);
    const good: Array<{ ref: string; about: string; vehicles: string[]; basis: string | null }> = [];
    for (const [ref, line] of Object.entries(file.tags)) {
      const c = checkLine(ref, line, known);
      if (typeof c === 'string') counts.refused[c] = (counts.refused[c] ?? 0) + 1;
      else good.push({ ref, ...c });
    }
    if (good.length) {
      counts.claude = (await tx.query(
        `insert into meetings.event_tag (source, ref, about, vehicles, basis, by_kind, tagged_at)
         select 'affinity', x->>'ref', x->>'about', array(select jsonb_array_elements_text(x->'vehicles')), x->>'basis', 'claude', $2::timestamptz
           from jsonb_array_elements($1::jsonb) x
         on conflict (source, ref) do update set about = excluded.about, vehicles = excluded.vehicles, basis = excluded.basis,
           by_kind = 'claude', tagged_by = null, tagged_at = excluded.tagged_at
          where meetings.event_tag.by_kind <> 'person'
         returning ref`,
        [JSON.stringify(good), file.at || new Date().toISOString()],
      )).length;
      counts.keptPerson = good.length - counts.claude;
    }
  }

  counts.applied = (await tx.query(
    `update meetings.meeting m
        set about = t.about, about_vehicles = t.vehicles, about_basis = t.basis, about_by = t.by_kind
       from meetings.event_tag t
      where m.source = 'affinity' and t.source = 'affinity' and t.by_kind in ('claude', 'person')
        and t.ref = substring(m.source_ref from '^(interaction:[a-z-]+:[0-9]+):')
      returning m.meeting_id`,
  )).length;
  return counts;
}

/** The tags on these records, by ref, with who set a person's. */
export async function tagsFor(refs: string[]): Promise<Map<string, EventTag>> {
  const out = new Map<string, EventTag>();
  if (!refs.length) return out;
  const db = await getDb();
  const rows = await db.query<{ ref: string; about: 'raise' | 'other'; vehicles: string[] | null; basis: string | null; by_kind: TagBy; name: string | null; tagged_at: Date | string }>(
    `select t.ref, t.about, t.vehicles, t.basis, t.by_kind, u.name, t.tagged_at
       from meetings.event_tag t left join platform.app_user u on u.id = t.tagged_by
      where t.source = 'affinity' and t.ref = any($1::text[])`,
    [[...new Set(refs)]],
  );
  for (const r of rows) {
    out.set(r.ref, { ref: r.ref, about: r.about, vehicles: r.vehicles ?? [], basis: r.basis, by: r.by_kind, byName: r.name, at: new Date(r.tagged_at) });
  }
  return out;
}

/**
 * The tags on these notes, by note id: a note on a meeting or an email takes that interaction's
 * tag when Claude or a person tagged it and nobody tagged the note itself — it is part of it.
 */
export async function noteTags(noteIds: string[]): Promise<Map<string, EventTag>> {
  const out = new Map<string, EventTag>();
  if (!noteIds.length) return out;
  const db = await getDb();
  const rows = await db.query<{ id: string; interaction: string | null }>(
    `select distinct on (source_id) source_id as id,
            case when coalesce(payload->'interaction', 'null'::jsonb) = 'null'::jsonb then null
                 else 'interaction:' || case when payload->>'type' = 'ai-notetaker' then 'meeting' else payload->'interaction'->>'type' end
                      || ':' || (payload->'interaction'->>'id') end as interaction
       from sources.raw_record
      where source = 'affinity' and kind = 'note' and source_id = any($1::text[])
      order by source_id, fetched_at desc, id desc`,
    [[...new Set(noteIds)]],
  );
  const tags = await tagsFor([...rows.map((r) => noteRef(r.id)), ...rows.map((r) => r.interaction).filter((x): x is string => !!x)]);
  for (const r of rows) {
    const own = tags.get(noteRef(r.id));
    const on = r.interaction ? tags.get(r.interaction) : undefined;
    const t = own && own.by !== 'rule' ? own : on ?? own;
    if (t) out.set(r.id, t);
  }
  return out;
}

/**
 * A person says what an event is about (N81): the vehicles, none, or a raise without saying which.
 * Written at once to the tag and to every touchpoint read from it, and to the notes on it, so the
 * page and the counts agree before the next translation — which keeps it. Logged.
 */
export async function tagEvent(
  actorId: string, ref: string, tag: { about: 'raise' | 'other'; vehicles: string[]; basis: string | null },
): Promise<{ touchpoints: number; notes: number }> {
  const db = await getDb();
  const slugs = new Set((await db.query<{ slug: string }>(`select slug from platform.vehicle`)).map((r) => r.slug));
  const c = checkLine(ref, tag, slugs);
  if (typeof c === 'string') throw new Error(`Not tagged: ${c}.`);
  return db.transaction(async (tx) => {
    const before = await tx.one<{ about: string; vehicles: string[]; by_kind: string }>(
      `select about, vehicles, by_kind from meetings.event_tag where source = 'affinity' and ref = $1`, [ref],
    );
    // The notes on an interaction are part of it, and take its tag.
    const notes = ref.startsWith('interaction:')
      ? (await tx.query<{ id: string }>(
          `select distinct source_id as id from sources.raw_record
            where source = 'affinity' and kind = 'note'
              and 'interaction:' || case when payload->>'type' = 'ai-notetaker' then 'meeting' else payload->'interaction'->>'type' end
                  || ':' || (payload->'interaction'->>'id') = $1`,
          [ref],
        )).map((r) => noteRef(r.id))
      : [];
    for (const r of [ref, ...notes]) {
      await tx.query(
        `insert into meetings.event_tag (source, ref, about, vehicles, basis, by_kind, tagged_by, tagged_at)
         values ('affinity', $1, $2, $3, $4, 'person', $5, now())
         on conflict (source, ref) do update set about = excluded.about, vehicles = excluded.vehicles, basis = excluded.basis,
           by_kind = 'person', tagged_by = excluded.tagged_by, tagged_at = now()`,
        [r, c.about, c.vehicles, c.basis, actorId],
      );
    }
    const touched = ref.startsWith('interaction:')
      ? (await tx.query(
          `update meetings.meeting set about = $2, about_vehicles = $3, about_basis = $4, about_by = 'person'
            where source = 'affinity' and substring(source_ref from '^(interaction:[a-z-]+:[0-9]+):') = $1
            returning meeting_id`,
          [ref, c.about, c.vehicles, c.basis],
        )).length
      : 0;
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'event.tagged', 'event', null, $2)`,
      [actorId, JSON.stringify({ ref, from: before ? { about: before.about, vehicles: before.vehicles, by: before.by_kind } : null, to: { about: c.about, vehicles: c.vehicles }, notes: notes.length, touchpoints: touched })],
    );
    return { touchpoints: touched, notes: notes.length };
  });
}
