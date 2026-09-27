import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { latestRaw } from '@/modules/sources';
import {
  eventAbout, isEvent, raiseWindows, summarize, touchpointSummaries, touchpointsByEntity, type EventAbout, type RaiseWindow,
} from '@/modules/meetings';
import { closeStates } from '@/modules/pipeline';
import { listRestrictions } from '@/modules/coordination';
import { listPursuits, type Pursuit, type PursuitStatus } from '@/modules/strategy';
import { readingsFor } from '@/lib/connectors/affinity/readings';
import { noteTags } from '@/lib/connectors/affinity/event-tags';
import { makeTriageExport, writeTriageExport } from './triage-export';
import { exportIdentityReview } from './identity-review-export';
import { exportLpUnitReview } from './lp-unit-review-export';
import type { ResearchExportStatus } from './export-status';

/**
 * The research set (N64, docs/19): who the enrichment workflows read about, written to files
 * under data/<profile>/enrich/ so the research runs outside the app — in a working session, the
 * way the note readings are made (N55) — and its findings come back through an import that can
 * be run again. The app never reads the web.
 *
 * Two files, on purpose:
 *   research-set.jsonl  who they are: a name, the organization and title on file, a location,
 *                       the domains of their email addresses. What a search may carry.
 *   candidates.jsonl    that, plus where they stand with us: statuses, the ladder, contact.
 *                       For the strategy step, read here; never put into a query.
 *
 * Juan, 24 Sep 2026: "Lets bound it to: LPs committed, discussing, connecting or selected for now".
 */

export const RESEARCH_STATUSES: PursuitStatus[] = ['selected', 'connecting', 'discussing', 'committed'];

/** Juan, 26 Sep: newly added prospects join W0 at New/Sourcing too; 27 Sep, so do the Dakota-sourced ones (searching by name is fine). Passed stays excluded. */
export const inResearchSet = (p: Pursuit): boolean => !p.historical &&
  (RESEARCH_STATUSES.includes(p.status) || ((p.source === 'prospects' || p.source === 'dakota') && (p.status === 'new' || p.status === 'sourcing')));

/** A domain that says nothing about where someone works. */
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|protonmail|proton|gmx|yandex|qq|163|126|comcast|verizon|att|sbcglobal|mail|fastmail|hey|pm)\./i;

export interface ResearchIdentity {
  /** The entity id: the join key for everything the research writes back. */
  key: string;
  name: string;
  type: string;
  org: string | null;
  role: string | null;
  location: string | null;
  /** Work domains only; the addresses themselves never leave the database. */
  domains: string[];
  /** What Affinity's own enrichment says (location, title, links), field by field. */
  enriched: Record<string, string>;
}

/**
 * What a row is about, in words the strategy step reads (N81): the vehicles' names, or "vehicle
 * unclear" — about a raise without saying which — or "general": a catch-up, background, another
 * company, true of them whatever the vehicle. Juan, 24 Sep: "some of the info will apply regardless
 * of vehicle, but some will be specific."
 */
export type AboutWords = string[];

export interface Candidate extends ResearchIdentity {
  pursuits: Array<{
    pursuitId: string; vehicle: string; status: PursuitStatus; rung: string | null; owner: string; stageSaid: string | null; nextStep: string | null;
    /** N81: the contact tagged with this pursuit's vehicle, inside its window — all that counts for it. */
    contact: { meetings: number; lastTouch: string | null; lastFromThem: string | null; awaitingSince: string | null; nextMeeting: string | null };
  }>;
  /**
   * All contact with them since their raises opened, about anything (N81; before, what the loose
   * rule of N59 counted as about a raise): the relationship, whatever the vehicle — a reply owed is
   * owed whatever it was about. Each meeting says what it was about. `since` is the earliest opening
   * of their vehicles' raise windows; what came before is summed in `earlier`.
   */
  contact: {
    since: string | null;
    earlier: { meetings: number; first: string | null; last: string | null };
    meetings: number; lastTouch: string | null; lastFromThem: string | null; awaitingSince: string | null; read: string | null;
    /** How the last touch happened — a meeting counts as "from them", so their last word can be a meeting, not a reply (W5, iteration 3). */
    lastTouchChannel: string | null;
    /** Meetings on a date that four or more LPs share: an event, most likely, not a one-to-one (W5 learning). */
    groupMeetings: number;
    /** The dates of their meetings and calls, oldest first, each marked when four or more LPs share it (v05), and what it was about (N81). */
    meetingDates: Array<{ on: string; group: boolean; about: AboutWords }>;
    /**
     * Their last eight touches since `since`, newest first, each with what it was about (N81, after a
     * W5 reader found an email-only LP's emails untagged): a channel, who wrote, the tag, and who from
     * our side was on it.
     */
    recent: Array<{ on: string; channel: string; direction: string | null; about: AboutWords; with: string[] }>;
    /**
     * How many LPs in the set our last unanswered word went to on the same day (W5, iteration 3):
     * ten or more is a mailing, and the next step is a first personal note, not a follow-up.
     */
    outreachShared: number;
  };
  /** The close track, where there is one: the amount, and how far it has got (rule 1: soft until signed). */
  money: { amount: number; track: string; state: string; signedOn: string | null; signedPerSource: boolean; wired: number } | null;
  /** Our notes about them, as read (N55): the summaries, dated, health detail already redacted, and what each is about (N81). */
  notes: Array<{ on: string; summary: string | null; read: string | null; about: AboutWords }>;
  /**
   * Context or corrections from the team, newest first (issue 0016): their own words about this LP,
   * which the strategy workflow reads above the research and the notes' readings. `at` is the full
   * time, so a strategy written before it is stale (isStale).
   */
  context: Array<{ at: string; by: string | null; text: string }>;
  /**
   * Do-not-approach instructions on file (rule 8), list marks included: a blanket one rules them out
   * of any plan, one through a connector rules out that route. The instruction's words stay in the
   * app; the plan needs only its shape.
   */
  restrictions: Array<{ scope: 'connector' | 'channel' | 'blanket'; connector: string | null; channel: string | null }>;
}

interface V { type: string; data: unknown }
interface F { id: string; name: string; type: string; enrichmentSource?: string | null; value: V | null }
interface Entry { id: number; type: string; entity: { id: number; primaryEmailAddress?: string | null; emailAddresses?: string[]; fields?: F[] } }

/** A field's value as words: text, a dropdown, a location, a company, a list of them. */
function words(v: V | null): string | null {
  if (!v || v.data === null || v.data === undefined) return null;
  const one = (d: unknown): string | null => {
    if (d === null || d === undefined) return null;
    if (typeof d === 'string') return d.trim() || null;
    if (typeof d === 'number') return String(d);
    if (typeof d === 'object') {
      const o = d as Record<string, unknown>;
      if (typeof o['text'] === 'string') return o['text'] as string;
      if (typeof o['name'] === 'string') return o['name'] as string;
      const place = ['city', 'state', 'country'].map((k) => o[k]).filter((x) => typeof x === 'string' && x);
      if (place.length) return place.join(', ');
    }
    return null;
  };
  if (Array.isArray(v.data)) return v.data.map(one).filter(Boolean).join('; ') || null;
  return one(v.data);
}

/** Fields that describe the person or organization from outside: never the team's own list fields. */
const OUTSIDE = (f: F) => !/phone|telegram|whatsapp/i.test(f.name) &&
  (f.type === 'enriched' || (f.type === 'global' && !/owner|status|amount|note|source|stage/i.test(f.name)));
/**
 * What the research file may carry: who they are, as a stranger could find it. The team's own
 * fields (lists, scores, tiers, dates in a status) stay in candidates.jsonl, for the strategy step.
 */
const IDENTITY_FIELDS = ['Current Organization', 'Current Job Title', 'Organizations', 'Job Titles', 'Industry', 'Location', 'LinkedIn URL'];

export async function researchSet(): Promise<Candidate[]> {
  return (await researchSnapshot()).candidates;
}

/** Keep the bulk interaction read for the sibling triage export; never reload it per LP. */
async function researchSnapshot() {
  const db = await getDb();
  // Juan, 27 Sep: names and entities may be searched, Dakota-sourced ones included. What stays out of
  // research files is Dakota's private or aggregated fields: none are read here (the affiliation read
  // below skips Dakota's, and nothing from dakota.* is exported).
  const all = (await listPursuits(null)).filter(inResearchSet);
  const byEntity = new Map<string, Pursuit[]>();
  for (const p of all) byEntity.set(p.entityId, [...(byEntity.get(p.entityId) ?? []), p]);
  const ids = [...byEntity.keys()];
  if (!ids.length) return { candidates: [] as Candidate[], touches: new Map<string, import('@/modules/meetings').Touchpoint[]>(), entries: [] as Entry[] };

  // entity_type includes audited local corrections; both export files must use this DB value.
  const [entities, affiliations, links, entries, contact] = await Promise.all([
    db.query<{ entity_id: string; entity_type: string; display_name: string }>(
      `select entity_id::text, entity_type::text, display_name from identity.entity where entity_id = any($1::uuid[])`, [ids]),
    db.query<{ person_entity: string; org: string; role: string }>(
      `select identity.canonical_entity_id(a.person_entity)::text as person_entity, o.display_name as org, a.role from identity.affiliation a
         join identity.entity o on o.entity_id = identity.canonical_entity_id(a.org_entity)
        where identity.canonical_entity_id(a.person_entity) = any($1::uuid[]) and a.ended_on is null and a.source is distinct from 'dakota'
        and not exists(select 1 from identity.source_record ds where ds.source='dakota' and identity.canonical_entity_id(ds.entity_id)=identity.canonical_entity_id(a.org_entity))
        order by a.is_primary desc`, [ids]),
    db.query<{ entity_id: string; source_id: string }>(
      `select identity.canonical_entity_id(entity_id)::text as entity_id, source_id from identity.source_record where source = 'affinity' and identity.canonical_entity_id(entity_id) = any($1::uuid[])`, [ids]),
    latestRaw<Entry>('affinity', 'list_entry'),
    touchpointSummaries(all.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }))),
  ]);
  const readings = await readingsFor(ids);
  const context = await db.query<{ entity_id: string; at: Date | string; by: string | null; body: string }>(
    `select identity.canonical_entity_id(n.entity_id)::text as entity_id, n.created_at as at, u.name as by, n.body
       from research.note n left join platform.app_user u on u.id = n.author_id
      where n.kind = 'context' and identity.canonical_entity_id(n.entity_id) = any($1::uuid[])
      order by n.created_at desc`, [ids]);
  const restrictions = (await listRestrictions({ includeListMarks: true })).filter((r) => byEntity.has(r.entityId));
  const pairs = all.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const [everything, tracks, windowMap, tags] = await Promise.all([
    touchpointsByEntity(ids), closeStates(pairs), raiseWindows(), noteTags(readings.map((r) => r.noteId)),
  ]);
  const windows = [...windowMap.values()];
  // Their own meetings and calls held, about anything (N81): the relationship's.
  const met = new Map([...everything].map(([id, list]) => [id, list.filter((t) => (t.channel === 'meeting' || t.channel === 'call') && t.on && !t.viaOrganization && t.on.getTime() <= Date.now())]));
  // A date many LPs share is an event: count who was "in a meeting" each day.
  const onDay = new Map<string, number>();
  for (const list of met.values()) {
    for (const d of new Set(list.map((t) => t.on!.toISOString().slice(0, 10)))) onDay.set(d, (onDay.get(d) ?? 0) + 1);
  }

  // Affinity's entity ids, and every list entry about each of them.
  const affinityOf = new Map<string, string>();
  for (const l of links) affinityOf.set(l.entity_id, l.source_id);
  const entriesOf = new Map<string, Entry[]>();
  for (const r of entries) {
    const e = r.payload;
    const k = `${e.type === 'person' ? 'person' : e.type}:${e.entity.id}`;
    entriesOf.set(k, [...(entriesOf.get(k) ?? []), e]);
  }

  const out: Candidate[] = entities.map((ent) => {
    const ps = byEntity.get(ent.entity_id)!;
    const aff = affiliations.find((a) => a.person_entity === ent.entity_id) ?? null;
    const es = entriesOf.get(affinityOf.get(ent.entity_id) ?? '') ?? [];
    const enriched: Record<string, string> = {};
    const domains = new Set<string>();
    for (const e of es) {
      for (const f of e.entity.fields ?? []) {
        const w = OUTSIDE(f) ? words(f.value) : null;
        if (w && !enriched[f.name]) enriched[f.name] = w.slice(0, 300);
      }
      for (const a of [e.entity.primaryEmailAddress, ...(e.entity.emailAddresses ?? [])]) {
        const d = a?.split('@')[1]?.toLowerCase();
        if (d && !FREE_MAIL.test(d)) domains.add(d);
      }
    }
    const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
    const opens = ps.map((p) => windowMap.get(p.vehicleId)?.opens).filter((d): d is Date => !!d);
    const since = opens.length ? new Date(Math.min(...opens.map((d) => d.getTime()))) : null;
    const inPeriod = (t: { on: Date | null; scheduledFor: Date | null }) => !since || ((t.on ?? t.scheduledFor)?.getTime() ?? 0) >= since.getTime();
    const rel = summarize((everything.get(ent.entity_id) ?? []).filter(inPeriod));
    const mine = (met.get(ent.entity_id) ?? []).filter(inPeriod);
    const before = [...new Set((met.get(ent.entity_id) ?? []).filter((t) => !inPeriod(t)).map((t) => day(t.on)!))].sort();
    const days = [...new Set(mine.map((t) => day(t.on)!))].sort();
    return {
      key: ent.entity_id,
      name: ent.display_name,
      type: ent.entity_type,
      org: aff?.org ?? null,
      role: aff?.role && aff.role !== 'not recorded' ? aff.role : null,
      location: enriched['Location'] ?? null,
      domains: [...domains].sort(),
      enriched,
      pursuits: ps.map((p) => {
        const s = contact.get(`${p.entityId}:${p.vehicleId}`);
        return {
          pursuitId: p.pursuitId, vehicle: p.vehicleName, status: p.status, rung: p.rung, owner: p.ownerSaid ?? p.ownerName,
          stageSaid: p.stageSaid, nextStep: p.nextStep,
          contact: {
            meetings: s?.meetingDates.length ?? 0, lastTouch: day(s?.lastTouch), lastFromThem: day(s?.lastFromThem),
            awaitingSince: day(s?.awaitingSince), nextMeeting: day(s?.nextMeeting),
          },
        };
      }),
      contact: {
        since: day(since),
        earlier: { meetings: before.length, first: before[0] ?? null, last: before[before.length - 1] ?? null },
        meetings: rel.meetingDates.length,
        lastTouch: day(rel.lastTouch),
        lastTouchChannel: rel.lastTouchChannel,
        lastFromThem: day(rel.lastFromThem),
        awaitingSince: day(rel.awaitingSince),
        read: rel.read?.read ?? null,
        groupMeetings: days.filter((d) => (onDay.get(d) ?? 0) >= 4 || mine.some((t) => day(t.on) === d && isEvent(t))).length,
        outreachShared: 0,
        recent: (everything.get(ent.entity_id) ?? [])
          .filter((t) => inPeriod(t) && !t.viaOrganization && t.channel !== 'research' && t.on && t.on.getTime() <= Date.now())
          .slice(0, 8)
          // Who from our side was on it: whose contact they are (W5 readers, N81).
          .map((t) => ({ on: day(t.on)!, channel: t.channel, direction: t.direction, about: aboutWords(eventAbout(t, windows)), with: t.attendees })),
        meetingDates: days.map((on) => ({
          // A date four or more LPs share, or a calendar entry with four or more of ours on it (N81).
          on, group: (onDay.get(on) ?? 0) >= 4 || mine.some((t) => day(t.on) === on && isEvent(t)),
          about: [...new Set(mine.filter((t) => day(t.on) === on).flatMap((t) => aboutWords(eventAbout(t, windows))))],
        })),
      },
      money: (() => {
        const t = ps.map((p) => tracks.get(`${p.entityId}:${p.vehicleId}`)).find(Boolean);
        return t ? {
          amount: t.exposure.amount, track: t.exposure.track, state: t.state,
          signedOn: t.signature?.on ? t.signature.on.toISOString().slice(0, 10) : null,
          signedPerSource: Boolean(t.signature && t.signature.bySource !== 'us'), wired: t.wired,
        } : null;
      })(),
      notes: readings.filter((r) => r.entityId === ent.entity_id && !r.dismissed && r.summary)
        .sort((a, b) => b.on.getTime() - a.on.getTime()).slice(0, 8)
        .map((r) => ({ on: r.on.toISOString().slice(0, 10), summary: r.summary, read: r.read, about: noteWords(tags.get(r.noteId), r.on, windows) })),
      restrictions: restrictions.filter((r) => r.entityId === ent.entity_id)
        .map((r) => ({ scope: r.scope, connector: r.connectorName, channel: r.channel })),
      context: context.filter((c) => c.entity_id === ent.entity_id)
        .map((c) => ({ at: new Date(c.at).toISOString(), by: c.by, text: c.body })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sentOn = new Map<string, number>();
  for (const c of out) if (c.contact.awaitingSince) sentOn.set(c.contact.awaitingSince, (sentOn.get(c.contact.awaitingSince) ?? 0) + 1);
  for (const c of out) c.contact.outreachShared = c.contact.awaitingSince ? sentOn.get(c.contact.awaitingSince)! : 0;
  return { candidates: out, touches: everything, entries: entries.map((r) => r.payload) };
}

/** A row's tag as the strategy step reads it (N81). */
function aboutWords(a: EventAbout): AboutWords {
  if (a.kind === 'vehicles') return a.vehicles.map((v) => (v.counts ? v.name : `${v.name} (before its raise opened)`));
  return [a.kind === 'unclear' ? 'vehicle unclear' : 'general'];
}

function noteWords(t: { about: 'raise' | 'other'; vehicles: string[]; by: 'rule' | 'claude' | 'person' } | undefined, on: Date, windows: RaiseWindow[]): AboutWords {
  return aboutWords(eventAbout({
    vehicleId: null, source: 'affinity', about: t?.about ?? 'other', aboutVehicles: t?.vehicles ?? [], aboutBy: t?.by ?? 'rule', on, scheduledFor: null,
  }, windows));
}

/** Where the files live; the property harness points it at a scratch directory of its own. */
export const enrichDir = () => {
  const expected = resolve(process.cwd(), config.data.root, 'enrich');
  const dir = resolve(process.cwd(), process.env.ENRICH_DIR ?? expected);
  if (config.data.profile === 'real' && dir !== expected) throw new Error('Real enrichment exports must stay in data/real/enrich.');
  return dir;
};

/** Write the research, strategy and triage files. Returns counts, never names. */
export async function exportResearchSet(): Promise<{ candidates: number; people: number; orgs: number; withDomain: number; withOrg: number; byStatus: Record<string, number>; dir: string; identityReviewError: ResearchExportStatus['identityReviewError']; lpUnitReviewError: ResearchExportStatus['lpUnitReviewError'] }> {
  // A record with no searchable name ("-" from a source's blank) can't be researched; W1 wrote
  // empty placeholders for them (27 Sep). It stays in the pipeline, just not in the export.
  const dir = enrichDir();
  const snapshot = await researchSnapshot();
  const set = snapshot.candidates.filter((c) => /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(c.name ?? ''));
  await mkdir(dir, { recursive: true });
  const identity = (c: Candidate): ResearchIdentity => ({
    key: c.key, name: c.name, type: c.type, org: c.org, role: c.role, location: c.location, domains: c.domains,
    enriched: Object.fromEntries(Object.entries(c.enriched).filter(([k]) => IDENTITY_FIELDS.includes(k))),
  });
  await writeFile(join(dir, 'research-set.jsonl'), set.map((c) => JSON.stringify(identity(c))).join('\n') + '\n', 'utf8');
  await writeFile(join(dir, 'candidates.jsonl'), set.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');
  // Our side (W2): the team, for finding who of us is connected to whom. Names and roles only — no
  // address and no domain, since agents read this file and a personal domain is one step from a
  // personal address (Juan, 24 Sep: nothing that identifies us goes into a request).
  const db = await getDb();
  const team = await db.query<{ handle: string; name: string; role: string }>(
    `select handle, name, role from platform.app_user where active order by name`);
  await writeFile(join(dir, 'team.json'), JSON.stringify(team.map((u) => ({
    handle: u.handle, name: u.name, role: u.role,
  })), null, 1) + '\n', 'utf8');
  await writeTriageExport(dir, await makeTriageExport(dir, snapshot.candidates, snapshot.touches, snapshot.entries, team));
  // Identity review is independent. A cancelled statement rolls back its own transaction,
  // after the other research files have been written, and never suppresses their receipt.
  const status: ResearchExportStatus = { at: new Date().toISOString(), identityReviewError: null };
  const temp = join(dir, `.identity-review-${randomUUID()}.tmp`);
  try {
    const identityReview = await db.transaction(tx => exportIdentityReview(tx));
    await writeFile(temp, identityReview.map(row => JSON.stringify(row)).join('\n') + (identityReview.length ? '\n' : ''), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, join(dir, 'identity-review.jsonl'));
  } catch (error) {
    status.identityReviewError = (error instanceof Error && /statement timeout|timed out/i.test(error.message))
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '57014') ? 'timeout' : 'failed';
    // Driver errors can contain private query parameters. Log only the failure category.
    console.error(`[enrich.export] identity-review.jsonl ${status.identityReviewError}; other research files written.`);
    // Never leave an old review set looking current. Even if removal fails, the persisted
    // receipt below explicitly tells the operator not to use it.
    await rm(join(dir, 'identity-review.jsonl'), { force: true }).catch(() => {
      console.error('[enrich.export] stale identity-review.jsonl could not be removed.');
    });
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  const lpTemp = join(dir, `.lp-unit-review-${randomUUID()}.tmp`);
  status.lpUnitReviewError = null;
  try {
    const review = await db.transaction(tx => exportLpUnitReview(tx));
    await writeFile(lpTemp, review.map(row => JSON.stringify(row)).join('\n') + (review.length ? '\n' : ''), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(lpTemp, join(dir, 'lp-unit-review.jsonl'));
  } catch (error) {
    status.lpUnitReviewError = (error instanceof Error && /statement timeout|timed out/i.test(error.message))
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '57014') ? 'timeout' : 'failed';
    console.error(`[enrich.export] lp-unit-review.jsonl ${status.lpUnitReviewError}; other research files written.`);
    await rm(join(dir, 'lp-unit-review.jsonl'), { force: true }).catch(() => {
      console.error('[enrich.export] stale lp-unit-review.jsonl could not be removed.');
    });
  } finally { await rm(lpTemp, { force: true }).catch(() => {}); }
  await writeFile(join(dir, 'export-status.json'), JSON.stringify(status) + '\n', { encoding: 'utf8', mode: 0o600 });
  const byStatus: Record<string, number> = {};
  for (const c of set) for (const p of c.pursuits) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  return {
    candidates: set.length, people: set.filter((c) => c.type === 'person').length, orgs: set.filter((c) => c.type !== 'person').length,
    withDomain: set.filter((c) => c.domains.length).length, withOrg: set.filter((c) => c.org).length, byStatus, dir: join(config.data.root, 'enrich'), identityReviewError: status.identityReviewError, lpUnitReviewError: status.lpUnitReviewError,
  };
}
