import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import {
  DAKOTA_SPV_LABEL, readSpvText, resolveSpv, spvAppetite, spvDeals, spvRowMark,
  type SpvConfidence, type SpvEvidence, type SpvKind, type SpvReading, type SpvRowMark, type SpvStance,
} from './spv-rules';

/**
 * SPV stance (Juan, 27 Sep 2026; migration 011): the stored inputs and the jobs that write them.
 * The rules that turn them into a stance are in spv-rules.ts.
 *
 *   - A person's setting: set, replaced or withdrawn on the LP page, each change audited.
 *   - Research: one evidence row per spv_appetite or spv_deals claim, written by the import.
 *   - Derived: our own SPV commitments, Dakota's co-investment flag and research text, rewritten by
 *     "Derive SPV stance" (Developer → Enrich, and a step of Import the findings).
 */

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

type EvidenceRow = {
  entity: string; kind: SpvKind; stance: SpvStance; min_deals: number | null; label: string; quote: string | null;
  source: string; url: string | null; as_of: Date | string; confidence: SpvConfidence; verified: string | null;
};
type SettingRow = { entity: string; stance: SpvStance; min_deals: number | null; note: string | null; set_at: Date | string; by: string | null };

export interface SpvSettingHistory {
  id: string; stance: SpvStance; minDeals: number | null; note: string | null; by: string | null; at: string;
  ended: 'replaced' | 'withdrawn' | null; endedAt: string | null; endedBy: string | null;
}

/** Each entity's reading, keyed by the canonical id asked for. Entities with nothing on file read unknown. */
export async function spvReadings(q: Queryable, entityIds: string[]): Promise<Map<string, SpvReading>> {
  const out = new Map<string, SpvReading>();
  const ids = [...new Set(entityIds)];
  if (!ids.length) return out;
  const [canon, settings, evidence] = await Promise.all([
    q.query<{ id: string; canon: string }>(`select id::text, identity.canonical_entity_id(id)::text canon from unnest($1::uuid[]) id`, [ids]),
    q.query<SettingRow>(
      `select identity.canonical_entity_id(s.entity_id)::text entity, s.stance, s.min_deals, s.note, s.set_at, u.name by
         from strategy.spv_setting s left join platform.app_user u on u.id = s.set_by
        where s.replaced_by is null and s.withdrawn_at is null
          and identity.canonical_entity_id(s.entity_id) = any($1::uuid[])
        order by s.set_at desc`, [ids]),
    q.query<EvidenceRow>(
      `select identity.canonical_entity_id(e.entity_id)::text entity, e.kind, e.stance, e.min_deals, e.label, e.quote,
              e.source, e.url, e.as_of, e.confidence::text confidence, coalesce(cu.name, eu.name) verified
         from strategy.spv_evidence e
         left join research.claim c on c.claim_id = e.claim_id
         left join platform.app_user cu on cu.id = c.last_verified_by
         left join platform.app_user eu on eu.id = e.last_verified_by
        where identity.canonical_entity_id(e.entity_id) = any($1::uuid[])`, [ids]),
  ]);
  const by = new Map<string, SpvEvidence[]>();
  const add = (id: string, e: SpvEvidence) => by.set(id, [...(by.get(id) ?? []), e]);
  const seen = new Set<string>();
  for (const s of settings) {
    // Two entities merged into one can each have had a standing setting: the latest wins.
    if (seen.has(s.entity)) continue;
    seen.add(s.entity);
    add(s.entity, { kind: 'person', stance: s.stance, minDeals: s.min_deals, label: 'A person’s setting', quote: s.note,
      source: 'LP page', url: null, asOf: day(s.set_at), confidence: 'high', lastVerifiedBy: s.by });
  }
  for (const e of evidence) add(e.entity, { kind: e.kind, stance: e.stance, minDeals: e.min_deals, label: e.label, quote: e.quote,
    source: e.source, url: e.url, asOf: day(e.as_of), confidence: e.confidence, lastVerifiedBy: e.verified });
  const canonical = new Map(canon.map((c) => [c.id, c.canon]));
  for (const id of ids) out.set(id, resolveSpv(by.get(canonical.get(id) ?? id) ?? []));
  return out;
}

/** The compact marks for list rows. */
export async function spvMarks(q: Queryable, entityIds: string[]): Promise<Map<string, SpvRowMark>> {
  const readings = await spvReadings(q, entityIds);
  return new Map([...readings].map(([id, r]) => [id, spvRowMark(r)]));
}

export async function spvHistory(q: Queryable, entityId: string): Promise<SpvSettingHistory[]> {
  const rows = await q.query<{ id: string; stance: SpvStance; min_deals: number | null; note: string | null; by: string | null; set_at: Date | string;
    replaced: boolean; withdrawn_at: Date | string | null; withdrawn_by: string | null; replaced_at: Date | string | null }>(
    `select s.setting_id::text id, s.stance, s.min_deals, s.note, u.name by, s.set_at, s.replaced_by is not null replaced,
            s.withdrawn_at, w.name withdrawn_by, r.set_at replaced_at
       from strategy.spv_setting s
       left join platform.app_user u on u.id = s.set_by
       left join platform.app_user w on w.id = s.withdrawn_by
       left join strategy.spv_setting r on r.setting_id = s.replaced_by
      where identity.canonical_entity_id(s.entity_id) = identity.canonical_entity_id($1::uuid)
      order by s.set_at desc limit 20`, [entityId]);
  return rows.map((r) => ({
    id: r.id, stance: r.stance, minDeals: r.min_deals, note: r.note, by: r.by, at: new Date(r.set_at).toISOString(),
    ended: r.replaced ? 'replaced' : r.withdrawn_at ? 'withdrawn' : null,
    endedAt: r.replaced_at ? new Date(r.replaced_at).toISOString() : r.withdrawn_at ? new Date(r.withdrawn_at).toISOString() : null,
    endedBy: r.withdrawn_by,
  }));
}

export class SpvRefused extends Error {}

/**
 * A person's setting: it replaces the standing one (kept, marked replaced) and is audited. Waits for
 * the server; nothing optimistic. `unknown` is a setting too: a person saying the evidence is wrong.
 */
export async function setSpvStance(db: Db, entityId: string, actor: string,
  input: { stance: SpvStance; minDeals?: number | null; note?: string | null }): Promise<void> {
  if (!(['does', 'does-not', 'unknown'] as SpvStance[]).includes(input.stance)) throw new SpvRefused('That stance is not one of does, doesn’t or unknown.');
  const min = input.stance === 'does' && input.minDeals != null && input.minDeals !== 0 ? input.minDeals : null;
  if (min !== null && (!Number.isInteger(min) || min < 1 || min > 10000)) throw new SpvRefused('The count must be a whole number from 1 to 10,000.');
  const note = input.note?.trim() ? input.note.trim().slice(0, 600) : null;
  await db.transaction(async (tx) => {
    const target = await tx.one<{ id: string; name: string }>(
      `select identity.canonical_entity_id($1::uuid)::text id, e.display_name name from identity.entity e
        where e.entity_id = identity.canonical_entity_id($1::uuid)`, [entityId]);
    if (!target) throw new SpvRefused('That LP is not on record.');
    // Serialise concurrent settings for one LP: the standing row is unique per entity.
    await tx.exec('lock table strategy.spv_setting in share row exclusive mode');
    const before = await tx.one<{ id: string; stance: string; min_deals: number | null; note: string | null }>(
      `select setting_id::text id, stance, min_deals, note from strategy.spv_setting
        where identity.canonical_entity_id(entity_id) = $1::uuid and replaced_by is null and withdrawn_at is null
        order by set_at desc limit 1`, [target.id]);
    if (before && before.stance === input.stance && before.min_deals === min && (before.note ?? null) === note) return;
    const row = { id: randomUUID() };
    // Every standing row of the LP's identities, merged ones included, is replaced by this one: marked
    // first (the reference is checked at commit), so the one-standing-row index never sees two.
    await tx.query(
      `update strategy.spv_setting set replaced_by = $2::uuid
        where identity.canonical_entity_id(entity_id) = $1::uuid and replaced_by is null and withdrawn_at is null`,
      [target.id, row.id]);
    await tx.query(
      `insert into strategy.spv_setting (setting_id, entity_id, stance, min_deals, note, set_by) values ($1,$2,$3,$4,$5,$6)`,
      [row.id, target.id, input.stance, min, note, actor]);
    await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1,'spv.stance_set','entity',$2,$3)`,
      [actor, target.id, JSON.stringify({ name: target.name, from: before ? { stance: before.stance, minDeals: before.min_deals, note: before.note } : null,
        to: { stance: input.stance, minDeals: min, note }, settingId: row.id })]);
  });
}

/** Withdraw a person's setting: the LP goes back to what the evidence says. Kept, audited. */
export async function withdrawSpvStance(db: Db, entityId: string, actor: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string; stance: string; min_deals: number | null }>(
      `update strategy.spv_setting set withdrawn_at = now(), withdrawn_by = $2
        where identity.canonical_entity_id(entity_id) = identity.canonical_entity_id($1::uuid) and replaced_by is null and withdrawn_at is null
        returning setting_id::text id, stance, min_deals`, [entityId, actor]);
    if (!rows.length) return false;
    await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
      values ($1,'spv.stance_withdrawn','entity',identity.canonical_entity_id($2::uuid)::text,$3)`,
      [actor, entityId, JSON.stringify({ withdrawn: rows.map((r) => ({ settingId: r.id, stance: r.stance, minDeals: r.min_deals })) })]);
    return true;
  });
}

// ── Research: written by the import ────────────────────────────────────────────────────────────

export interface SpvFact { field: string; value: unknown; quote?: string; confidence: SpvConfidence; source: { url: string } }
/** The evidence one research fact gives, or null when the field is not an SPV field. */
export function researchSpvEvidence(fact: SpvFact): { stance: SpvStance; minDeals: number | null; label: string } | null {
  if (fact.field === 'spv_appetite') {
    const stance = spvAppetite(fact.value);
    if (!stance) return null;
    return { stance, minDeals: null, label: stance === 'does' ? 'Research: does SPVs' : stance === 'does-not' ? 'Research: doesn’t do SPVs' : 'Research: nothing either way' };
  }
  if (fact.field === 'spv_deals') {
    const n = spvDeals(fact.value);
    if (n === null) return null;
    return n > 0 ? { stance: 'does', minDeals: n, label: `Research: ≥ ${n} known SPV or co-investment ${n === 1 ? 'deal' : 'deals'}` }
      : { stance: 'unknown', minDeals: 0, label: 'Research: no SPV deal found' };
  }
  return null;
}

/** One research evidence row for a claim the import has just written. Removed with the claim. */
export async function recordResearchSpv(tx: Queryable, claimId: string, entityId: string, fact: SpvFact, docId: string, asOf: string): Promise<boolean> {
  const e = researchSpvEvidence(fact);
  if (!e) return false;
  await tx.query(
    `insert into strategy.spv_evidence (entity_id, kind, stance, min_deals, label, quote, source, url, as_of, confidence, claim_id)
     values ($1,'research',$2,$3,$4,$5,$6,$7,$8,$9::research.confidence,$10) on conflict (claim_id) where claim_id is not null do nothing`,
    [entityId, e.stance, e.minDeals, e.label, fact.quote?.trim() ? fact.quote.trim().slice(0, 400) : null, docId, fact.source.url, asOf, fact.confidence, claimId]);
  return true;
}

// ── Derived: the job ───────────────────────────────────────────────────────────────────────────

export interface SpvDeriveReport { lps: number; pipeline: number; dakota: number; text: number; stances: Record<SpvStance, number>; conflicts: number }

/** The text worth reading: anything naming SPVs, co-investments, syndicates, or fund-only investing. */
const TEXT_FILTER = `(spv|special.purpose vehicle|co-?invest|syndicat|only invest|invests? only|exclusively|solely|funds only|fund commitments only|no direct)`;

/**
 * Rewrite every derived signal for the LP units on record (every entity with an active pursuit):
 * our own SPV commitments, Dakota's flag, and research text. One transaction; research rows and a
 * person's settings are untouched. Dakota's column is tested inside the database and only a yes
 * leaves it, as a fixed label: its text is never read into this process or written anywhere.
 */
export async function deriveSpvStance(db: Db): Promise<SpvDeriveReport> {
  const lps = (await db.query<{ id: string }>(
    `select distinct identity.canonical_entity_id(entity_id)::text id from strategy.active_pursuit`)).map((r) => r.id);
  const report: SpvDeriveReport = { lps: lps.length, pipeline: 0, dakota: 0, text: 0, stances: { does: 0, 'does-not': 0, unknown: 0 }, conflicts: 0 };
  await db.transaction(async (tx) => {
    await tx.exec('lock table strategy.spv_evidence in share row exclusive mode');
    await tx.query(`delete from strategy.spv_evidence where kind in ('pipeline','dakota','text')`);
    if (!lps.length) return;
    type Row = [string, SpvKind, SpvStance, number | null, string, string | null, string, string | null, string, SpvConfidence, string | null];
    const rows: Row[] = [];

    // Our own SPVs: a hard commitment, or a pursuit a person marked Committed, on a vehicle of kind spv.
    const ours = await tx.query<{ id: string; vehicles: string[]; hard: number; at: Date | string }>(
      `select x.id, array_agg(distinct v.name order by v.name) vehicles, count(distinct x.vehicle_id) filter (where x.hard)::int hard, max(x.at) at
         from (
           select identity.canonical_entity_id(e.entity_id) id, e.vehicle_id, true hard, coalesce(e.hardened_at, e.opened_at) at
             from pipeline.exposure e where e.track = 'hard' and e.closed_at is null
           union all
           select identity.canonical_entity_id(p.entity_id), p.vehicle_id, false, coalesce(p.status_set_at, p.opened_at)
             from strategy.active_pursuit p where p.status = 'committed'
         ) x join platform.vehicle v on v.id = x.vehicle_id and v.kind = 'spv'
        where x.id = any($1::uuid[]) group by x.id`, [lps]);
    for (const o of ours) {
      const n = o.vehicles.length;
      rows.push([o.id, 'pipeline', 'does', n, `In ${n} of our SPVs: ${o.vehicles.join(', ')}`, null, 'pipeline', null, day(o.at),
        o.hard > 0 ? 'high' : 'medium', null]);
      report.pipeline++;
    }

    // Dakota: the matched account's co-investment flag, tested in SQL. Only the yes, its date and importer leave.
    const dakota = await tx.query<{ id: string; at: Date | string; by: string }>(
      `select distinct on (identity.canonical_entity_id(a.entity_id)) identity.canonical_entity_id(a.entity_id)::text id,
              a.lastmodifieddate at, a.last_verified_by::text by
         from dakota.account a
        where identity.canonical_entity_id(a.entity_id) = any($1::uuid[])
          and a.co_investments__c ~* '^\\s*(true|yes|y|1)([^a-z0-9]|$)'
        order by identity.canonical_entity_id(a.entity_id), a.lastmodifieddate desc`, [lps]);
    for (const d of dakota) {
      rows.push([d.id, 'dakota', 'does', null, DAKOTA_SPV_LABEL, null, 'dakota', null, day(d.at), 'medium', d.by]);
      report.dakota++;
    }

    // Research text: claims (other than the SPV fields themselves) and public profiles.
    const claims = await tx.query<{ id: string; value: string; as_of: Date | string; source: string; url: string | null; field: string }>(
      `select identity.canonical_entity_id(c.entity_id)::text id, c.value, c.as_of, c.source, d.origin url, c.field
         from research.claim c left join research.source_doc d on d.doc_id = c.source
        where c.superseded_by is null and c.field not in ('public.spv_appetite', 'public.spv_deals')
          and identity.canonical_entity_id(c.entity_id) = any($1::uuid[]) and c.value ~* $2`, [lps, TEXT_FILTER]);
    const profiles = await tx.query<{ id: string; text: string; at: Date | string }>(
      `select identity.canonical_entity_id(n.entity_id)::text id,
              concat_ws('. ', n.body, n.data->'profile'->>'howTheyInvest', n.data->'profile'->>'summary',
                (select string_agg(x, '. ') from jsonb_array_elements_text(case when jsonb_typeof(n.data->'profile'->'cautions') = 'array' then n.data->'profile'->'cautions' else '[]'::jsonb end) x),
                (select string_agg(s->>'what', '. ') from jsonb_array_elements(case when jsonb_typeof(n.data->'profile'->'signals') = 'array' then n.data->'profile'->'signals' else '[]'::jsonb end) s)) text,
              coalesce((n.data->'researched'->>'at')::date, n.created_at::date) at
         from research.note n
        where n.kind = 'public_profile' and identity.canonical_entity_id(n.entity_id) = any($1::uuid[])
          and (n.body ~* $2 or (n.data->'profile')::text ~* $2)`, [lps, TEXT_FILTER]);
    const quoted = new Set<string>();
    const text = (id: string, said: string, source: string, url: string | null, at: Date | string, what: string) => {
      const r = readSpvText(said);
      if (!r || quoted.has(`${id}:${r.quote}`)) return;
      quoted.add(`${id}:${r.quote}`);
      rows.push([id, 'text', r.stance, r.minDeals, `${what} ${r.stance === 'does' ? 'names SPVs or co-investments' : 'says no SPVs'}`,
        r.quote.slice(0, 400), source, url, day(at), 'low', null]);
      report.text++;
    };
    for (const c of claims) text(c.id, c.value, c.source, c.url, c.as_of, 'A research claim');
    for (const p of profiles) text(p.id, p.text, 'research profile', null, p.at, 'The research profile');

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await tx.query(
        `insert into strategy.spv_evidence (entity_id, kind, stance, min_deals, label, quote, source, url, as_of, confidence, last_verified_by)
         select e, k, st, m, l, q, src, u, d, c::research.confidence, v
           from unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::date[], $10::text[], $11::uuid[])
             as t(e, k, st, m, l, q, src, u, d, c, v)`,
        Array.from({ length: 11 }, (_, k) => chunk.map((r) => r[k])));
    }
  });
  const readings = await spvReadings(db, lps);
  for (const r of readings.values()) { report.stances[r.stance]++; if (r.conflict) report.conflicts++; }
  return report;
}
