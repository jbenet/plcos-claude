import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { finishRun, landRaw, latestRaw, latestRun, progressRun, startRun, type SyncRun } from '@/modules/sources';
import { AffinityRefused, type Query } from './client';
import { affinity } from './index';
import { mentionsHealth } from './inventory';
import { isWhat, redactedCleanly, type What } from './readings';
import { sliceTargets } from './slice';

/**
 * Every note in the account, read once (N49).
 *
 * Juan, 23 Sep: replicate Affinity locally, so it can be queried whenever we want, with each
 * record downloaded once and then only its changes, and keep the notes on every list, not just
 * Neurotech's. That replaces the per-entry plan (docs/16 §1), which cost a request per entry and
 * kept only one vehicle's.
 *
 * `GET /v2/notes` pages through every note except replies, a hundred at a time. With `includes`,
 * each note carries the people, organizations and opportunities it is attached to (the first
 * hundred of each, with a total), so one pass gives the text, the author, the date and the
 * links. The count comes first, from one request that returns no notes, and a read whose
 * count is over what was approved stops before it starts.
 *
 * After a complete read, the next one asks only for notes created or updated since that read
 * began, less a day so that a clock difference cannot lose one. It takes two passes because a
 * note nobody has edited has no updatedAt. A note deleted in Affinity stays here until a full
 * read.
 *
 * Replies are not in the bulk list. Each note says how many it has. Reading them would cost a
 * request per note that has any, so they are counted and left for later.
 *
 * Nothing here translates a note into anything. A note mentioning someone's health is kept as
 * Affinity has it, flagged, and nothing derived from it carries the health detail (Report 4
 * §6.2): a reading of it loads only with that detail redacted and the redaction marked (N56).
 */

export interface NotePerson {
  id: number;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: string | null;
  type: 'internal' | 'collaborator' | 'external';
}

export interface AffinityNote {
  id: number;
  type: 'entities' | 'interaction' | 'ai-notetaker' | 'user-reply' | 'ai-notetaker-reply';
  content: { html: string | null } | null;
  creator: NotePerson | null;
  mentions?: Array<{ id: number; type: 'person'; person?: NotePerson }>;
  createdAt: string;
  updatedAt: string | null;
  repliesCount?: number;
  interaction?: { id: number; type: 'meeting' | 'call' | 'chat-message' | 'email' };
  personsPreview?: { data: NotePerson[]; totalCount: number };
  companiesPreview?: { data: Array<{ id: number; name: string; domain: string | null }>; totalCount: number };
  opportunitiesPreview?: { data: Array<{ id: number; name: string; listId: number; listName: string }>; totalCount: number };
}

const SOURCE = 'affinity';
const KIND = 'notes';
const PAGE = 100;
const INCLUDES = ['personsPreview', 'companiesPreview', 'opportunitiesPreview', 'repliesCount'] as const;
/** Overlap between one read and the next, so a difference between clocks cannot drop a note. */
const MARGIN_MS = 86_400_000;

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface NotesOptions {
  /** The request count a person approved. The read stops before it would go past it. */
  approvedUpTo?: number;
  /** Read every note again, not only what changed. The way to notice a deletion. */
  full?: boolean;
  /** For the property harness. */
  ceiling?: number;
  overrides?: Parameters<typeof affinity>[0];
}

export interface NotesRunDetail {
  mode?: 'full' | 'since';
  since?: string | null;
  /** When the read began: the next one asks for what changed after this, less a day. */
  through?: string;
  counted?: number[];
  estimate?: number;
  allowed?: number;
  types?: Record<string, number>;
  withReplies?: number;
  replies?: number;
  truncated?: number;
}

/** How many notes match, from one request that returns none of them. No filter: all of them. */
async function count(client: ReturnType<typeof affinity>, filter: string | null): Promise<number> {
  const page = await client.get<{ pagination?: { totalCount?: number } }>('/v2/notes', {
    limit: 0, totalCount: 'true', ...(filter ? { filter } : {}),
  });
  const total = page.pagination?.totalCount;
  if (typeof total !== 'number') throw new Error('Affinity did not return a count of the notes.');
  return total;
}

export async function readNotes(runBy: string | null, opts: NotesOptions = {}): Promise<SyncRun | null> {
  const ceiling = opts.ceiling ?? config.affinity.sliceCeiling;
  const prior = await latestRun(SOURCE, KIND, 'ok');
  const priorThrough = (prior?.detail as NotesRunDetail | undefined)?.through;
  const since = !opts.full && priorThrough ? new Date(new Date(priorThrough).getTime() - MARGIN_MS) : null;
  const began = new Date();
  const run = await startRun(SOURCE, KIND, runBy);
  let requests = 0;
  let records = 0;
  let fresh = 0;
  const types: Record<string, number> = {};
  let withReplies = 0;
  let replies = 0;
  let truncated = 0;
  // A note created and then edited since the last read is in both passes; it counts once.
  const seen = new Set<number>();
  const detail: NotesRunDetail & Record<string, unknown> = { mode: since ? 'since' : 'full', since: since ? iso(since) : null };
  const finish = (status: 'ok' | 'failed' | 'held', note: string) =>
    finishRun(run, {
      status, requests, records, newRecords: fresh, note,
      detail: { ...detail, types, withReplies, replies, truncated },
    });

  try {
    const client = affinity(opts.overrides);
    // A new note has createdAt and no updatedAt; an edited one has both. Two passes, then.
    const filters: Array<string | null> = since ? [`createdAt>=${iso(since)}`, `updatedAt>=${iso(since)}`] : [null];
    const counted: number[] = [];
    for (const f of filters) {
      counted.push(await count(client, f));
      requests++;
    }
    // A pass with nothing to read costs nothing past its count.
    const pages = counted.reduce((a, n) => a + Math.ceil(n / PAGE), 0);
    const estimate = requests + pages;
    const allowed = opts.approvedUpTo ?? ceiling;
    Object.assign(detail, { counted, estimate, allowed });
    if (estimate > allowed) {
      await finish('held', `${counted.reduce((a, b) => a + b, 0)} notes to read: about ${estimate} requests, over the ${allowed} allowed without a go-ahead.`);
      return latestRun(SOURCE, KIND);
    }

    for (const [i, f] of filters.entries()) {
      if (counted[i] === 0) continue;
      let next: string | null = '/v2/notes';
      let query: Query | undefined = { limit: PAGE, includes: INCLUDES, ...(f ? { filter: f } : {}) };
      while (next) {
        // The approval is of a number: a read that turns out bigger than it was priced stops.
        if (requests >= allowed) {
          await finish('failed', `Stopped at ${requests} requests, the number approved; ${records} notes read. Nothing read is lost: approve a new count to finish.`);
          return latestRun(SOURCE, KIND);
        }
        const page: { data?: AffinityNote[]; pagination?: { nextUrl?: string | null } } = await client.get(next, query);
        requests++;
        for (const note of page.data ?? []) {
          if (seen.has(note.id)) continue;
          seen.add(note.id);
          records++;
          types[note.type] = (types[note.type] ?? 0) + 1;
          if (note.repliesCount) {
            withReplies++;
            replies += note.repliesCount;
          }
          for (const p of [note.personsPreview, note.companiesPreview, note.opportunitiesPreview]) {
            if (p && p.totalCount > p.data.length) truncated++;
          }
          if (await landRaw({ source: SOURCE, kind: 'note', sourceId: String(note.id), sourceUpdatedAt: new Date(note.updatedAt ?? note.createdAt), payload: note })) fresh++;
        }
        await progressRun(run, { requests, records, newRecords: fresh, note: `${records} notes so far` });
        // The next page's URL is Affinity's, absolute, and goes through the same allowlist and
        // host check as the first. If it drops the includes, they are put back: a page of notes
        // without their attachments would land looking complete.
        const nextUrl: string | null = page.pagination?.nextUrl ?? null;
        if (nextUrl) {
          const u = new URL(nextUrl);
          if (!u.searchParams.has('includes')) for (const i of INCLUDES) u.searchParams.append('includes', i);
          next = u.toString();
        } else {
          next = null;
        }
        query = undefined;
      }
    }

    detail.through = iso(began);
    const parts = [
      `${records} notes read`,
      `${fresh} new or changed`,
      withReplies ? `${withReplies} have replies (${replies}), not read` : null,
      truncated ? `${truncated} attach to more than a hundred of something` : null,
    ].filter(Boolean);
    await finish('ok', parts.join(' · '));
  } catch (err) {
    await finish('failed', err instanceof AffinityRefused ? `Refused: ${err.message}` : err instanceof Error ? err.message : 'unknown error');
  }
  return latestRun(SOURCE, KIND);
}

type G = typeof globalThis & { __affinityNotes?: Promise<unknown> | null };
const g = globalThis as G;

/** A read takes a minute or two, so it runs in this server's process while the page watches. */
export function startNotes(runBy: string | null, opts: NotesOptions = {}): 'started' | 'already running' {
  if (g.__affinityNotes) return 'already running';
  g.__affinityNotes = readNotes(runBy, opts).finally(() => {
    g.__affinityNotes = null;
  });
  return 'started';
}

export const notesRunning = () => Boolean(g.__affinityNotes);

// ------------------------------------------------------------------------------ reading them

export const noteText = (html: string | null | undefined): string =>
  (html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A note's first sentence, for a one-line view where nobody has summarized it. */
export function firstSentence(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^(.{12,}?[.!?])(\s|$)/.exec(flat);
  const one = m ? m[1]! : flat;
  return one.length > max ? `${one.slice(0, max).replace(/\s+\S*$/, '')}…` : one;
}

const personName = (p: { firstName?: string | null; lastName?: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || 'unnamed';

/**
 * The organizations a list entry's person is at, from the same fields translation reads for
 * affiliations (translate.ts): Affinity's current organization, else its organizations.
 */
export function organizationsOf(entity: { fields?: Array<{ name: string; value: { data: unknown } | null }> }): number[] {
  for (const name of ['Current Organization', 'Organizations']) {
    const data = (entity.fields ?? []).find((f) => f.name === name)?.value?.data;
    const list = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ id?: number }>;
    const ids = list.map((c) => c?.id).filter((x): x is number => typeof x === 'number');
    if (ids.length) return ids;
  }
  return [];
}

/** Who and what a note is attached to, as `person:1`, `company:2`, `opportunity:3`. */
export function attachedKeys(n: AffinityNote): string[] {
  return [
    ...(n.personsPreview?.data ?? []).map((p) => `person:${p.id}`),
    ...(n.companiesPreview?.data ?? []).map((c) => `company:${c.id}`),
    ...(n.opportunitiesPreview?.data ?? []).map((o) => `opportunity:${o.id}`),
  ];
}

export const NOTE_KIND_LABEL: Record<string, string> = {
  entities: 'Note',
  'interaction:meeting': 'Meeting note',
  'interaction:call': 'Call note',
  'interaction:email': 'Email note',
  'interaction:chat-message': 'Chat note',
  interaction: 'Interaction note',
  'ai-notetaker': 'Notetaker summary',
};

export const noteKind = (n: AffinityNote) =>
  n.type === 'interaction' && n.interaction ? `interaction:${n.interaction.type}` : n.type;

export interface NoteView {
  noteId: number;
  /** The meeting, call or email the note is on, when Affinity ties it to one. */
  interaction: { type: string; id: number } | null;
  /** What the note says in a sentence, and their read, if someone read it (N55). */
  reading: { summary: string | null; read: string | null; basis: string | null; what: What | null; suggested: boolean; by: string; confirmedByName: string | null; dismissed: boolean } | null;
  /** A DocSend notification, which says only that the deck was opened: shown as a deck view. */
  deckView: boolean;
  /** Attached to the LP themselves, or to the organization they are affiliated with. */
  via: { kind: 'self' } | { kind: 'organization'; name: string };
  kind: string;
  kindLabel: string;
  createdAt: Date;
  updatedAt: Date | null;
  author: string;
  authorOnTeam: boolean;
  text: string;
  /** Mentions a person's or a family's health: shown only on request, never derived from. */
  health: boolean;
  /** Everyone and everything else it is attached to, counted. */
  alsoAttached: number;
  replies: number;
  fetchedAt: Date;
}

/**
 * The notes about one of our entities, newest first: those attached to them, and those attached
 * to an organization they are affiliated with — most of the team's notes about an LP sit on the
 * LP's firm, not on the person (N49, measured). The entity is joined to Affinity through
 * identity.source_record (`person:7001`, `company:12`), so a note appears for the LP it is about,
 * whichever list that LP is on.
 */
export async function notesAbout(entityId: string): Promise<NoteView[]> {
  const db = await getDb();
  const own = (
    await db.query<{ source_id: string }>(
      `select source_id from identity.source_record where source = $1 and entity_id = $2`, [SOURCE, entityId],
    )
  ).map((r) => r.source_id);
  // An organization they act for now: an ended affiliation is a former role, and a note about
  // a firm somebody left is not a note about them.
  const orgs = await db.query<{ source_id: string; name: string }>(
    `select r.source_id, e.display_name as name
       from identity.affiliation a
       join identity.source_record r on r.entity_id = a.org_entity and r.source = $1
       join identity.entity e on e.entity_id = a.org_entity
      where a.person_entity = $2 and a.ended_on is null and r.source_id like 'company:%'`,
    [SOURCE, entityId],
  );
  const ids = (list: string[], prefix: string) => list.filter((x) => x.startsWith(prefix)).map((x) => ({ id: Number(x.slice(prefix.length)) }));
  const persons = ids(own, 'person:');
  const companies = [...ids(own, 'company:'), ...ids(orgs.map((o) => o.source_id), 'company:')];
  if (!persons.length && !companies.length) return [];
  // The newest version of each note first, then the filter: an older version attached to this
  // entity must not show a note that has since been moved off it.
  const rows = await db.query<{ fetched_at: Date | string; payload: AffinityNote; summary: string | null; read: string | null; basis: string | null; what: string | null; read_by: string | null; confirmed_at: Date | string | null; confirmed_by_name: string | null; dismissed_at: Date | string | null }>(
    `select n.fetched_at, n.payload, nr.summary, nr.read::text as read, nr.basis, nr.what, nr.read_by, nr.confirmed_at,
            cu.name as confirmed_by_name, nr.dismissed_at
       from (
       select fetched_at, payload from (
       select distinct on (source_id) source_id, fetched_at, payload
         from sources.raw_record where source = $1 and kind = 'note'
        order by source_id, fetched_at desc, id desc
     ) n
     where exists (select 1 from jsonb_array_elements($2::jsonb) p
                    where (n.payload->'personsPreview'->'data') @> jsonb_build_array(p))
        or exists (select 1 from jsonb_array_elements($3::jsonb) c
                    where (n.payload->'companiesPreview'->'data') @> jsonb_build_array(c))
       ) n
       left join meetings.note_reading nr on nr.source = 'affinity' and nr.note_id = (n.payload->>'id')
       left join platform.app_user cu on cu.id = nr.confirmed_by
     order by (n.payload->>'createdAt') desc`,
    [SOURCE, JSON.stringify(persons), JSON.stringify(companies)],
  );
  const mine = new Set(own);
  const orgName = new Map(orgs.map((o) => [o.source_id, o.name]));
  return rows.map((r) => {
    const { payload: n, fetched_at } = r;
    const html = n.content?.html ?? '';
    const keys = attachedKeys(n);
    const viaOrg = keys.some((k) => mine.has(k)) ? null : keys.find((k) => orgName.has(k));
    const health = mentionsHealth(html);
    return {
      noteId: n.id,
      interaction: n.type === 'ai-notetaker' && n.interaction ? { type: 'meeting', id: n.interaction.id } : n.interaction ? { type: n.interaction.type, id: n.interaction.id } : null,
      // A note that mentions health shows a reading only if it was redacted (N56); the importer
      // refuses any other, and this check holds even for a row written some other way.
      reading: r.read_by && (!health || redactedCleanly({ summary: r.summary, basis: r.basis }))
        ? { summary: r.summary, read: r.read, basis: r.basis, what: isWhat(r.what) ? r.what : null, suggested: !r.confirmed_at, by: r.read_by, confirmedByName: r.confirmed_by_name, dismissed: Boolean(r.dismissed_at) }
        : null,
      deckView: /^\s*DocSend Deck Viewed\b/i.test(noteText(html)),
      via: viaOrg ? { kind: 'organization', name: orgName.get(viaOrg)! } : { kind: 'self' },
      kind: noteKind(n),
      kindLabel: NOTE_KIND_LABEL[noteKind(n)] ?? n.type,
      createdAt: new Date(n.createdAt),
      updatedAt: n.updatedAt ? new Date(n.updatedAt) : null,
      author: n.creator ? personName(n.creator) : 'unknown',
      authorOnTeam: n.creator?.type === 'internal',
      text: noteText(html),
      health,
      alsoAttached: keys.filter((k) => !mine.has(k) && k !== viaOrg).length,
      replies: n.repliesCount ?? 0,
      fetchedAt: new Date(fetched_at),
    };
  });
}

// ------------------------------------------------------------------------------ the inventory

export interface NotesInventory {
  total: number;
  byKind: Array<{ kind: string; label: string; n: number }>;
  byYear: Array<{ year: string; n: number }>;
  first: string | null;
  last: string | null;
  /** The team's names, as note authors. Anyone else is counted, not named. */
  byAuthor: Array<{ name: string; n: number }>;
  otherAuthors: { people: number; notes: number };
  attached: { persons: number; companies: number; opportunities: number; nothing: number };
  /**
   * Notes attached to someone or something on each list the slice reads, and — not counted
   * twice — notes attached to the organization of a person on it.
   */
  byList: Array<{ list: string; vehicle: string | null; n: number; viaOrganization: number }>;
  /** About someone on a list we read, through their organization. */
  viaOrganization: number;
  /** Attached to nobody on those lists, nor to their organizations: kept for later, as Juan asked. */
  onNoListRead: number;
  replies: { notes: number; replies: number };
  truncated: number;
  /** Counted, never shown. */
  health: number;
  versions: number;
}

/** Aggregates only, like every inventory: counts and the team's names, never an LP's. */
export async function notesInventory(): Promise<NotesInventory | null> {
  const [notes, targets, entries] = await Promise.all([
    latestRaw<AffinityNote>(SOURCE, 'note'),
    sliceTargets(),
    latestRaw<{ listId: number; type: string; entity: { id: number; fields?: Array<{ name: string; value: { data: unknown } | null }> } }>(SOURCE, 'list_entry'),
  ]);
  if (!notes.length) return null;
  const db = await getDb();
  const v = await db.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where source = $1 and kind = 'note'`, [SOURCE]);

  const onList = new Map<number, Set<string>>();
  const orgOnList = new Map<number, Set<string>>();
  for (const { payload: e } of entries) {
    const key = `${e.type}:${e.entity.id}`;
    if (!onList.has(e.listId)) onList.set(e.listId, new Set());
    onList.get(e.listId)!.add(key);
    if (!orgOnList.has(e.listId)) orgOnList.set(e.listId, new Set());
    for (const id of organizationsOf(e.entity)) orgOnList.get(e.listId)!.add(`company:${id}`);
  }
  const byKind = new Map<string, number>();
  const byYear = new Map<string, number>();
  const byAuthor = new Map<string, number>();
  const others = new Map<number, number>();
  const byList = new Map<number, number>();
  const byListOrg = new Map<number, number>();
  let viaOrganization = 0;
  const attached = { persons: 0, companies: 0, opportunities: 0, nothing: 0 };
  let first: string | null = null;
  let last: string | null = null;
  let onNoListRead = 0;
  let withReplies = 0;
  let replies = 0;
  let truncated = 0;
  let health = 0;
  for (const { payload: n } of notes) {
    const kind = noteKind(n);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    const y = n.createdAt.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
    if (!first || n.createdAt < first) first = n.createdAt;
    if (!last || n.createdAt > last) last = n.createdAt;
    if (n.creator?.type === 'internal') byAuthor.set(personName(n.creator), (byAuthor.get(personName(n.creator)) ?? 0) + 1);
    else if (n.creator) others.set(n.creator.id, (others.get(n.creator.id) ?? 0) + 1);
    if (n.personsPreview?.totalCount) attached.persons++;
    if (n.companiesPreview?.totalCount) attached.companies++;
    if (n.opportunitiesPreview?.totalCount) attached.opportunities++;
    const keys = attachedKeys(n);
    if (!keys.length) attached.nothing++;
    let direct = false;
    let org = false;
    for (const t of targets) {
      const members = onList.get(t.list.id);
      if (members && keys.some((k) => members.has(k))) {
        byList.set(t.list.id, (byList.get(t.list.id) ?? 0) + 1);
        direct = true;
        continue;
      }
      const firms = orgOnList.get(t.list.id);
      if (firms && keys.some((k) => firms.has(k))) {
        byListOrg.set(t.list.id, (byListOrg.get(t.list.id) ?? 0) + 1);
        org = true;
      }
    }
    if (!direct && org) viaOrganization++;
    if (!direct && !org) onNoListRead++;
    if (n.repliesCount) {
      withReplies++;
      replies += n.repliesCount;
    }
    for (const p of [n.personsPreview, n.companiesPreview, n.opportunitiesPreview]) if (p && p.totalCount > p.data.length) truncated++;
    if (mentionsHealth(n.content?.html ?? '')) health++;
  }
  return {
    total: notes.length,
    byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, label: NOTE_KIND_LABEL[kind] ?? kind, n })),
    byYear: [...byYear.entries()].sort().map(([year, n]) => ({ year, n })),
    first, last,
    byAuthor: [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    otherAuthors: { people: others.size, notes: [...others.values()].reduce((a, b) => a + b, 0) },
    attached,
    byList: targets
      .map((t) => ({ list: t.list.name, vehicle: t.vehicleName, n: byList.get(t.list.id) ?? 0, viaOrganization: byListOrg.get(t.list.id) ?? 0 }))
      .sort((a, b) => b.n + b.viaOrganization - (a.n + a.viaOrganization)),
    viaOrganization,
    onNoListRead,
    replies: { notes: withReplies, replies },
    truncated,
    health,
    versions: Number(v?.n ?? 0),
  };
}
