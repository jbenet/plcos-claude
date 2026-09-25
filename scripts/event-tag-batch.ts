/**
 * Cut the batches for W12, Claude's reading of what each event is about (N81, docs/19).
 *
 * Every Affinity interaction with an LP since the earliest raise window opened, and every note about
 * an LP since then or with a reading: each with what the record itself says (an email's subject, a
 * meeting's title, the words of a note on it), who from the team was on it, the LPs on it with the
 * vehicles they are on, and the rules' reading. An LP's records sit together, oldest first, so a
 * thread reads as one.
 *
 * Read from a COPY of the database: the real server holds the real one open, and a second process
 * on it is not safe.
 *
 *   DATA_PROFILE=real npx tsx scripts/event-tag-batch.ts <copy of data/real/database> [size]
 *
 * Writes <data>/tags/batches/tNN.json and prints counts only. The tagging agents write
 * <data>/tags/out/tNN.json; scripts/event-tag-merge.ts makes <data>/event-tags.jsonc of them, which
 * the next translation loads.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '../config/deployment';
import { openPglite } from '../lib/db/pglite';
import { noteText } from '../lib/connectors/affinity/notes';
import { aboutRaise } from '../lib/connectors/affinity/about';
import { readInit } from '../lib/real/init';

export interface TagRecord {
  ref: string;
  kind: 'email' | 'meeting' | 'call' | 'message' | 'note';
  on: string;
  /** For a message: who wrote it. For a meeting or call: 'both'. */
  dir: 'from them' | 'from us' | 'both' | null;
  /** An email's subject or a meeting's title, as Affinity has it. */
  words: string | null;
  /** The words of the note on it, or of the note itself, clipped. */
  note: string | null;
  noteBy: string | null;
  team: string[];
  lps: Array<{ name: string; org: string | null; on: string[] }>;
  rule: { about: string | null; vehicles: string[]; basis: string | null };
}

export interface TagBatch {
  batch: string;
  vehicles: Array<{ slug: string; name: string; kind: string; aliases: string[]; opens: string | null; closes: string | null }>;
  records: TagRecord[];
}

const CLIP = 1500;
const clip = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > CLIP ? `${t.slice(0, CLIP)}…` : t) : null;
};
const day = (d: Date | string | null | undefined) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : '');

async function main() {
  const copy = process.argv[2];
  const size = Number(process.argv[3] ?? 150);
  if (!copy) throw new Error('Give the path of a copy of the database.');
  const live = resolve(process.cwd(), config.data.root, 'database');
  if (resolve(copy) === live) throw new Error('That is the live database. Copy it first: the server holds it open.');
  // Opened as it is: no migration runs on a copy.
  const db = await openPglite(copy);
  const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);

  const vehicles = (await q<{ slug: string; name: string; kind: string; aliases: string[]; opens: string | null; closes: string | null }>(
    `select slug, name, kind::text, aliases, raise_opens_on::text as opens, raise_closes_on::text as closes from platform.vehicle order by name`,
  ));
  const since = vehicles.map((v) => v.opens).filter((x): x is string => !!x).sort()[0] ?? '2026-01-01';
  // The rules as they read now (N81): a meeting's or a note's own words, never its invitees or author.
  // An email keeps the reading the copy holds, addresses and all.
  const firmNames = (await readInit()).init?.firmNames ?? [];
  const rules = (text: string) => {
    const a = aboutRaise(text, [], vehicles.map((v) => ({ slug: v.slug, name: v.name, aliases: v.aliases ?? [] })), [], firmNames);
    return { about: a.about, vehicles: a.vehicles, basis: a.basis };
  };

  // Who each of our entities is, what they are on, and their Affinity keys.
  const ents = new Map((await q<{ entity_id: string; name: string; org: string | null }>(
    `select e.entity_id::text, e.display_name as name,
            (select o.display_name from identity.affiliation a join identity.entity o on o.entity_id = a.org_entity
              where a.person_entity = e.entity_id and a.ended_on is null order by a.is_primary desc, a.as_of desc limit 1) as org
       from identity.entity e`,
  )).map((r) => [r.entity_id, r]));
  const onLists = new Map<string, string[]>();
  for (const r of await q<{ entity_id: string; vehicle: string; status: string }>(
    `select p.entity_id::text, v.name as vehicle, p.status::text from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id`,
  )) onLists.set(r.entity_id, [...(onLists.get(r.entity_id) ?? []), `${r.vehicle} · ${r.status}`]);
  const byKey = new Map((await q<{ source_id: string; entity_id: string }>(
    `select source_id, entity_id::text from identity.source_record where source = 'affinity'`,
  )).map((r) => [r.source_id, r.entity_id]));
  const lp = (entityId: string) => {
    const e = ents.get(entityId);
    return { name: e?.name ?? '?', org: e?.org ?? null, on: onLists.get(entityId) ?? [] };
  };

  // What the records say: meeting titles, email subjects from the list entries' interaction fields,
  // and the notes.
  const titles = new Map((await q<{ id: string; title: string | null }>(
    `select distinct on (source_id) source_id as id, payload->>'title' as title from sources.raw_record
      where source = 'affinity' and kind = 'meeting' order by source_id, fetched_at desc, id desc`,
  )).map((r) => [r.id, r.title]));
  const subjects = new Map<string, string>();
  for (const r of await q<{ t: string; id: string; subject: string | null }>(
    `select distinct f->'value'->'data'->>'type' as t, f->'value'->'data'->>'id' as id,
            coalesce(f->'value'->'data'->>'subject', f->'value'->'data'->>'title') as subject
       from (select distinct on (source_id) payload from sources.raw_record
              where source = 'affinity' and kind = 'list_entry' order by source_id, fetched_at desc, id desc) e
       cross join lateral jsonb_array_elements(coalesce(e.payload->'entity'->'fields', '[]'::jsonb)) f
      where f->'value'->>'type' = 'interaction'`,
  )) if (r.subject) subjects.set(`interaction:${r.t}:${r.id}`, r.subject);
  type Note = { id: string; created: string; html: string | null; creator: string | null; interaction: string | null; keys: string[] };
  const notes = (await q<{ id: string; payload: { createdAt: string; type: string; content?: { html?: string | null } | null; creator?: { firstName?: string | null; lastName?: string | null } | null; interaction?: { id: number; type: string } | null; personsPreview?: { data: Array<{ id: number }> }; companiesPreview?: { data: Array<{ id: number }> } } }>(
    `select distinct on (source_id) source_id as id, payload from sources.raw_record
      where source = 'affinity' and kind = 'note' order by source_id, fetched_at desc, id desc`,
  )).map((r): Note => ({
    id: r.id, created: r.payload.createdAt, html: r.payload.content?.html ?? null,
    creator: [r.payload.creator?.firstName, r.payload.creator?.lastName].filter(Boolean).join(' ') || null,
    interaction: r.payload.interaction?.id ? `interaction:${r.payload.type === 'ai-notetaker' ? 'meeting' : r.payload.interaction.type}:${r.payload.interaction.id}` : null,
    keys: [...(r.payload.personsPreview?.data ?? []).map((p) => `person:${p.id}`), ...(r.payload.companiesPreview?.data ?? []).map((c) => `company:${c.id}`)],
  }));
  const noteOn = new Map<string, Note>();
  for (const n of notes) if (n.interaction && !noteOn.has(n.interaction)) noteOn.set(n.interaction, n);
  const read = new Set((await q<{ note_id: string }>(`select note_id from meetings.note_reading`)).map((r) => r.note_id));

  // The interactions: every touchpoint since the earliest window, one record per interaction.
  const rows = await q<{ ref: string; entity_id: string; channel: string; direction: string | null; on: string; attendees: string[]; about: string | null; vehicles: string[]; basis: string | null }>(
    `select substring(source_ref from '^(interaction:[a-z-]+:[0-9]+):') as ref, entity_id::text, channel::text, direction,
            coalesce(held_on::text, scheduled_for::text) as on, attendees, about, about_vehicles as vehicles, about_basis as basis
       from meetings.meeting
      where source = 'affinity' and coalesce(held_on, scheduled_for::date) >= $1::date
      order by 1`,
    [since],
  );
  const records = new Map<string, TagRecord & { first: string }>();
  for (const r of rows) {
    if (!r.ref) continue;
    const had = records.get(r.ref);
    if (had) {
      if (!had.lps.some((x) => x.name === lp(r.entity_id).name)) had.lps.push(lp(r.entity_id));
      for (const a of r.attendees ?? []) if (!had.team.includes(a)) had.team.push(a);
      continue;
    }
    const [, type, id] = r.ref.split(':');
    const n = noteOn.get(r.ref);
    records.set(r.ref, {
      ref: r.ref, kind: (r.channel === 'message' ? 'message' : r.channel) as TagRecord['kind'], on: day(r.on),
      dir: r.direction === 'theirs' ? 'from them' : r.direction === 'ours' ? 'from us' : r.direction === 'both' ? 'both' : null,
      words: type === 'meeting' ? titles.get(id!) ?? subjects.get(r.ref) ?? null : subjects.get(r.ref) ?? null,
      note: n ? clip(noteText(n.html)) : null, noteBy: n?.creator ?? null,
      team: [...(r.attendees ?? [])], lps: [lp(r.entity_id)],
      rule: r.channel === 'email' || r.channel === 'message'
        ? { about: r.about, vehicles: r.vehicles ?? [], basis: r.basis }
        : rules(`${type === 'meeting' ? titles.get(id!) ?? '' : ''} ${n ? noteText(n.html) : ''}`),
      first: r.entity_id,
    });
  }
  // The notes on their own: about one of ours, since the earliest window or with a reading.
  let standalone = 0;
  for (const n of notes) {
    if (n.interaction && records.has(n.interaction)) continue;
    const ours = [...new Set(n.keys.map((k) => byKey.get(k)).filter((x): x is string => !!x))];
    if (!ours.length) continue;
    if (!(n.created >= since || read.has(n.id))) continue;
    standalone++;
    records.set(`note:${n.id}`, {
      ref: `note:${n.id}`, kind: 'note', on: day(n.created), dir: null, words: null,
      note: clip(noteText(n.html)), noteBy: n.creator, team: [], lps: ours.map(lp),
      rule: rules(noteText(n.html)), first: ours[0]!,
    });
  }

  // An LP's records together, oldest first; whole LPs to a batch.
  const groups = new Map<string, TagRecord[]>();
  for (const r of records.values()) {
    const { first, ...rec } = r;
    groups.set(first, [...(groups.get(first) ?? []), rec]);
  }
  const ordered = [...groups.entries()].sort((a, b) => (ents.get(a[0])?.name ?? '').localeCompare(ents.get(b[0])?.name ?? ''));
  const batches: TagRecord[][] = [[]];
  for (const [, list] of ordered) {
    const cur = batches[batches.length - 1]!;
    if (cur.length && cur.length + list.length > size) batches.push([]);
    batches[batches.length - 1]!.push(...list.sort((a, b) => a.on.localeCompare(b.on)));
  }
  const dir = join(process.cwd(), config.data.root, 'tags', 'batches');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [i, recs] of batches.entries()) {
    const name = `t${String(i + 1).padStart(2, '0')}`;
    const b: TagBatch = { batch: name, vehicles, records: recs };
    await writeFile(join(dir, `${name}.json`), JSON.stringify(b, null, 1));
  }
  const byKind: Record<string, number> = {};
  for (const r of records.values()) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  console.log(`since ${since}: ${records.size} records (${JSON.stringify(byKind)}; ${standalone} notes on their own) from ${groups.size} LPs, in ${batches.length} batches under ${config.data.root}/tags/batches/`);
  await db.close();
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
