import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { latestRaw } from '@/modules/sources';
import { touchpointSummaries, touchpointsByPair } from '@/modules/meetings';
import { closeStates } from '@/modules/pipeline';
import { listRestrictions } from '@/modules/coordination';
import { listPursuits, type Pursuit, type PursuitStatus } from '@/modules/strategy';
import { readingsFor } from '@/lib/connectors/affinity/readings';

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

export interface Candidate extends ResearchIdentity {
  pursuits: Array<{ pursuitId: string; vehicle: string; status: PursuitStatus; rung: string | null; owner: string; stageSaid: string | null; nextStep: string | null }>;
  contact: {
    meetings: number; lastTouch: string | null; lastFromThem: string | null; awaitingSince: string | null; read: string | null;
    /** How the last touch happened — a meeting counts as "from them", so their last word can be a meeting, not a reply (W5, iteration 3). */
    lastTouchChannel: string | null;
    /** Meetings on a date that four or more LPs share: an event, most likely, not a one-to-one (W5 learning). */
    groupMeetings: number;
    /** The dates of their meetings and calls, oldest first, each marked when four or more LPs share it (v05). */
    meetingDates: Array<{ on: string; group: boolean }>;
    /**
     * How many LPs in the set our last unanswered word went to on the same day (W5, iteration 3):
     * ten or more is a mailing, and the next step is a first personal note, not a follow-up.
     */
    outreachShared: number;
  };
  /** The close track, where there is one: the amount, and how far it has got (rule 1: soft until signed). */
  money: { amount: number; track: string; state: string; signedOn: string | null; signedPerSource: boolean; wired: number } | null;
  /** Our notes about them, as read (N55): the summaries, dated, health detail already redacted. */
  notes: Array<{ on: string; summary: string | null; read: string | null }>;
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
  const db = await getDb();
  const all = (await listPursuits(null)).filter((p) => !p.historical && RESEARCH_STATUSES.includes(p.status));
  const byEntity = new Map<string, Pursuit[]>();
  for (const p of all) byEntity.set(p.entityId, [...(byEntity.get(p.entityId) ?? []), p]);
  const ids = [...byEntity.keys()];
  if (!ids.length) return [];

  const [entities, affiliations, links, entries, contact] = await Promise.all([
    db.query<{ entity_id: string; entity_type: string; display_name: string }>(
      `select entity_id::text, entity_type::text, display_name from identity.entity where entity_id = any($1::uuid[])`, [ids]),
    db.query<{ person_entity: string; org: string; role: string }>(
      `select a.person_entity::text, o.display_name as org, a.role from identity.affiliation a
         join identity.entity o on o.entity_id = a.org_entity
        where a.person_entity = any($1::uuid[]) and a.ended_on is null
        order by a.is_primary desc`, [ids]),
    db.query<{ entity_id: string; source_id: string }>(
      `select entity_id::text, source_id from identity.source_record where source = 'affinity' and entity_id = any($1::uuid[])`, [ids]),
    latestRaw<Entry>('affinity', 'list_entry'),
    touchpointSummaries(all.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }))),
  ]);
  const readings = await readingsFor(ids);
  const restrictions = (await listRestrictions({ includeListMarks: true })).filter((r) => byEntity.has(r.entityId));
  const pairs = all.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const [touches, tracks] = await Promise.all([touchpointsByPair(pairs), closeStates(pairs)]);
  // A date many LPs share is an event: count who was "in a meeting" each day.
  const onDay = new Map<string, number>();
  for (const list of touches.values()) {
    for (const d of new Set(list.filter((t) => (t.channel === 'meeting' || t.channel === 'call') && t.on && !t.viaOrganization).map((t) => t.on!.toISOString().slice(0, 10)))) {
      onDay.set(d, (onDay.get(d) ?? 0) + 1);
    }
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
    const sums = ps.map((p) => contact.get(`${p.entityId}:${p.vehicleId}`)).filter(Boolean);
    const latest = (xs: Array<Date | null | undefined>) => xs.reduce<Date | null>((a, x) => (x && (!a || x > a) ? x : a), null)?.toISOString().slice(0, 10) ?? null;
    return {
      key: ent.entity_id,
      name: ent.display_name,
      type: ent.entity_type,
      org: aff?.org ?? null,
      role: aff?.role && aff.role !== 'not recorded' ? aff.role : null,
      location: enriched['Location'] ?? null,
      domains: [...domains].sort(),
      enriched,
      pursuits: ps.map((p) => ({
        pursuitId: p.pursuitId, vehicle: p.vehicleName, status: p.status, rung: p.rung, owner: p.ownerSaid ?? p.ownerName,
        stageSaid: p.stageSaid, nextStep: p.nextStep,
      })),
      contact: {
        meetings: Math.max(0, ...sums.map((s) => s!.meetingDates.length)),
        lastTouch: latest(sums.map((s) => s!.lastTouch)),
        lastTouchChannel: sums.map((s) => s!).filter((s) => s.lastTouch).sort((a, b) => b.lastTouch!.getTime() - a.lastTouch!.getTime())[0]?.lastTouchChannel ?? null,
        lastFromThem: latest(sums.map((s) => s!.lastFromThem)),
        awaitingSince: latest(sums.map((s) => s!.awaitingSince)),
        read: sums.map((s) => s!.read?.read).find(Boolean) ?? null,
        groupMeetings: ps.reduce((n, p) => n + new Set((touches.get(`${p.entityId}:${p.vehicleId}`) ?? [])
          .filter((t) => (t.channel === 'meeting' || t.channel === 'call') && t.on && !t.viaOrganization && (onDay.get(t.on.toISOString().slice(0, 10)) ?? 0) >= 4)
          .map((t) => t.on!.toISOString().slice(0, 10))).size, 0),
        outreachShared: 0,
        meetingDates: [...new Set(ps.flatMap((p) => (touches.get(`${p.entityId}:${p.vehicleId}`) ?? [])
          .filter((t) => (t.channel === 'meeting' || t.channel === 'call') && t.on && !t.viaOrganization)
          .map((t) => t.on!.toISOString().slice(0, 10))))].sort().map((on) => ({ on, group: (onDay.get(on) ?? 0) >= 4 })),
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
        .map((r) => ({ on: r.on.toISOString().slice(0, 10), summary: r.summary, read: r.read })),
      restrictions: restrictions.filter((r) => r.entityId === ent.entity_id)
        .map((r) => ({ scope: r.scope, connector: r.connectorName, channel: r.channel })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sentOn = new Map<string, number>();
  for (const c of out) if (c.contact.awaitingSince) sentOn.set(c.contact.awaitingSince, (sentOn.get(c.contact.awaitingSince) ?? 0) + 1);
  for (const c of out) c.contact.outreachShared = c.contact.awaitingSince ? sentOn.get(c.contact.awaitingSince)! : 0;
  return out;
}

/** Where the files live; the property harness points it at a scratch directory of its own. */
export const enrichDir = () => resolve(process.cwd(), process.env.ENRICH_DIR ?? join(config.data.root, 'enrich'));

/** Write both files. Returns counts, never names: a caller may show them anywhere. */
export async function exportResearchSet(): Promise<{ candidates: number; people: number; orgs: number; withDomain: number; withOrg: number; byStatus: Record<string, number>; dir: string }> {
  const set = await researchSet();
  const dir = enrichDir();
  await mkdir(dir, { recursive: true });
  const identity = (c: Candidate): ResearchIdentity => ({
    key: c.key, name: c.name, type: c.type, org: c.org, role: c.role, location: c.location, domains: c.domains,
    enriched: Object.fromEntries(Object.entries(c.enriched).filter(([k]) => IDENTITY_FIELDS.includes(k))),
  });
  await writeFile(join(dir, 'research-set.jsonl'), set.map((c) => JSON.stringify(identity(c))).join('\n') + '\n', 'utf8');
  await writeFile(join(dir, 'candidates.jsonl'), set.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');
  // Our side (W2): the team, for finding who of us is connected to whom. Work domains only.
  const db = await getDb();
  const team = await db.query<{ handle: string; name: string; role: string; email: string }>(
    `select handle, name, role, email from platform.app_user where active order by name`);
  await writeFile(join(dir, 'team.json'), JSON.stringify(team.map((u) => ({
    handle: u.handle, name: u.name, role: u.role, domain: u.email.split('@')[1] ?? null,
  })), null, 1) + '\n', 'utf8');
  const byStatus: Record<string, number> = {};
  for (const c of set) for (const p of c.pursuits) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  return {
    candidates: set.length, people: set.filter((c) => c.type === 'person').length, orgs: set.filter((c) => c.type !== 'person').length,
    withDomain: set.filter((c) => c.domains.length).length, withOrg: set.filter((c) => c.org).length, byStatus, dir: join(config.data.root, 'enrich'),
  };
}
