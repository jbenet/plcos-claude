import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { getDb, type Db } from '@/lib/db';
import { addProspects } from '@/lib/enrich/prospects';
import type { Prospect } from '@/lib/enrich/prospect-rows';
import { appendAudit } from '@/modules/platform';
import { STRATEGIC_FIELDS, mentions, strategicScope } from '@/modules/strategy/strategic-rules';
import { auditSync, type SyncCaller } from './auth';
import { pushRefusal, type PushAnswer } from './push';

/**
 * POST /api/sync/screen: find the people and organisations already in our records whose research ties them to a
 * vehicle's field, and optionally put them on that vehicle as New, so they can be gone through on Selection
 * (Juan, 13 Oct 2026: "can you search the db and identify who would be good LPs for Gordian Biotech? ... list them
 * in a page we can go through like the selecting page"). A sync:admin token, which only an Admin holds.
 *
 *   { "vehicle": "<slug>", "terms"?: ["biotech*", ...], "minScore"?: 4, "limit"?: 150, "add"?: false }
 *
 * The terms default to the vehicle's strategic field (config.strategic.domains) and an SPV's company name. Text
 * read: current research facts of the strategic kinds, the public profile, and the Dakota firm and contact
 * descriptions. A term matches at a word start, as the strategic lens matches (mentions). Each match is scored:
 * a tie to the SPV's company 4, each kind of tie (portfolio, operating, expertise, Dakota) 2, each distinct term 1
 * (at most 4), and a pursuit on another vehicle 1, discussing 2, committed 3, because a known relationship is
 * easier to ask. Passed pursuits and people with a pursuit on this vehicle already are left out.
 *
 * Without `add` it is a dry run. The answer carries counts only (by score, term, kind and relationship), never a
 * name, so whoever tunes the terms sees no record. With `add`, the top `limit` at or over `minScore` go through
 * Add prospects (lib/enrich/prospects.ts) pinned by entity id, as the token's owner, status New: an ordinary
 * pursuit with a context note saying why, the same as a pushed prospects file. A pipeline plan, never consent or
 * contact; nothing is sent and no status beyond New is set.
 */

const MAX_BYTES = 8 * 1024;
const FIELDS = ['vehicle', 'terms', 'minScore', 'limit', 'add'] as const;
type Kind = 'portfolio' | 'operating' | 'expertise' | 'dakota';
const KIND: Record<string, Kind> = {
  investment: 'portfolio', fund_gp: 'portfolio', fund_lp: 'portfolio', exit: 'portfolio',
  role: 'operating', prior_role: 'operating', board: 'operating', affiliation: 'operating',
  interest: 'expertise', statement: 'expertise', education: 'expertise', philanthropy: 'expertise', profile: 'expertise',
  dakota: 'dakota',
};
const KIND_WORDS: Record<Kind, string> = { portfolio: 'has backed', operating: 'works in', expertise: 'stated interest in', dakota: 'Dakota lists a focus on' };
const RELATION: Record<string, number> = { committed: 3, discussing: 2, selected: 1, sourcing: 1, new: 1 };

export interface ScreenHit { id: string; type: 'person' | 'org'; name: string; score: number; reason: string; terms: string[]; kinds: Kind[]; relation: string | null; company: boolean }
interface Text { id: string; field: string; value: string }

const cut = (s: string, n = 120) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const looseOf = (terms: string[]) => [...new Set(terms.map((w) => w.replace(/\*$/, '').trim().toLowerCase()).filter(Boolean))]
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

/** Every current text that loosely mentions a term, per canonical entity. Read-only. */
async function screenTexts(db: Db, terms: string[]): Promise<Text[]> {
  const loose = looseOf(terms);
  if (!loose) return [];
  const [claims, profiles, accounts, contacts] = await Promise.all([
    db.query<Text>(`select identity.canonical_entity_id(c.entity_id)::text id, substr(c.field, 8) field, c.value
       from research.claim c where c.superseded_by is null and c.field = any($1::text[]) and c.value ~* $2`,
      [STRATEGIC_FIELDS.map((f) => `public.${f}`), loose]),
    db.query<Text>(`select identity.canonical_entity_id(n.entity_id)::text id, 'profile' field,
         concat_ws('. ', n.data->'profile'->>'summary',
           (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(n.data->'profile'->'interests') = 'array'
             then n.data->'profile'->'interests' else '[]'::jsonb end) x)) value
       from research.note n where n.kind = 'public_profile' and (n.data->'profile')::text ~* $1`, [loose]),
    db.query<Text>(`select identity.canonical_entity_id(a.entity_id)::text id, 'dakota' field,
         concat_ws('. ', a.investment_interest__c, a.industry_focus__c, a.sector__c, a.description, a.firm_commentary__c) value
       from dakota.account a
       where concat_ws(' ', a.investment_interest__c, a.industry_focus__c, a.sector__c, a.description, a.firm_commentary__c) ~* $1`, [loose]),
    db.query<Text>(`select identity.canonical_entity_id(c.entity_id)::text id, 'dakota' field, concat_ws('. ', c.title, c.biography__c) value
       from dakota.contact c where concat_ws(' ', c.title, c.biography__c) ~* $1`, [loose]),
  ]);
  return [...claims, ...profiles, ...accounts, ...contacts];
}

/** The ranked matches for one vehicle. Pure over what the database returns; exported for the properties. */
export function rankScreen(texts: Text[], terms: string[], company: string | null,
  entities: Map<string, { type: string; name: string }>, relation: Map<string, string>, onVehicle: Set<string>): ScreenHit[] {
  const per = new Map<string, { terms: Set<string>; kinds: Map<Kind, string>; company: boolean }>();
  for (const t of texts) {
    const e = entities.get(t.id);
    if (!e || (e.type !== 'person' && e.type !== 'org') || onVehicle.has(t.id) || relation.get(t.id) === 'passed') continue;
    const kind = KIND[t.field];
    if (!kind) continue;
    const hit = per.get(t.id) ?? { terms: new Set<string>(), kinds: new Map<Kind, string>(), company: false };
    if (company && mentions(t.value, [company])) hit.company = true;
    let any = false;
    for (const term of terms) if (mentions(t.value, [term])) { hit.terms.add(term.replace(/\*$/, '')); any = true; }
    if (any && !hit.kinds.has(kind)) hit.kinds.set(kind, t.value);
    if (any || hit.company) per.set(t.id, hit);
  }
  const hits: ScreenHit[] = [];
  for (const [id, h] of per) {
    const e = entities.get(id)!;
    const rel = relation.get(id) ?? null;
    const score = (h.company ? 4 : 0) + 2 * h.kinds.size + Math.min(h.terms.size, 4) + (rel ? RELATION[rel] ?? 0 : 0);
    const kinds = [...h.kinds.keys()];
    const why = kinds.map((k) => `${KIND_WORDS[k]} ${[...h.terms].slice(0, 3).join(', ')}: ${cut(h.kinds.get(k)!)}`);
    if (h.company && company) why.unshift(`Research mentions ${company}`);
    if (rel && rel !== 'new') why.push(`already ${rel === 'committed' ? 'committed to' : rel === 'discussing' ? 'in discussion on' : 'selected on'} another of our vehicles`);
    hits.push({ id, type: e.type as 'person' | 'org', name: e.name, score, terms: [...h.terms], kinds, relation: rel, company: h.company,
      reason: `Database screen, score ${score}. ${why.slice(0, 3).join('; ')}` });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export async function screenVehicle(caller: SyncCaller, request: Request, o: { db?: Db } = {}): Promise<PushAnswer> {
  const started = Date.now();
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'screen', outcome, { ms: Date.now() - started, ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return answer(413, 'invalid', { error: `A screen is at most ${MAX_BYTES} bytes.` }, { reason: 'size' });
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return answer(422, 'invalid', { error: 'Send one screen as a JSON object.' }, { reason: 'shape' });
  const extra = Object.keys(input).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return answer(422, 'invalid', { error: `Unknown fields: ${extra.slice(0, 5).join(', ')}. A screen takes ${FIELDS.join(', ')}.` }, { reason: 'fields' });
  const add = input.add === true;
  if (add) { const refusal = pushRefusal(); if (refusal) return answer(403, 'refused', { error: refusal }, { reason: 'profile' }); }
  const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) ? input.limit : 150;
  const minScore = typeof input.minScore === 'number' && Number.isFinite(input.minScore) ? input.minScore : 4;
  if (limit < 1 || limit > 500) return answer(422, 'invalid', { error: 'limit is 1 to 500.' }, { reason: 'limit' });
  if (input.terms !== undefined && (!Array.isArray(input.terms) || input.terms.length > 60
    || !input.terms.every((t) => typeof t === 'string' && t.trim().length >= 2 && t.length <= 60))) {
    return answer(422, 'invalid', { error: 'terms is a list of at most 60 words or phrases, 2 to 60 characters each.' }, { reason: 'terms' });
  }
  const db = o.db ?? await getDb();
  const vehicle = await db.one<{ id: string; slug: string; name: string; kind: string; phase: string }>(
    'select id::text, slug, name, kind::text, phase from platform.vehicle where slug = $1', [input.vehicle]);
  if (!vehicle) return answer(404, 'invalid', { error: 'No vehicle has that slug.' }, { reason: 'vehicle' });
  if (vehicle.phase === 'historical') return answer(409, 'refused', { error: 'That vehicle is kept for its history; screen an active one.' }, { reason: 'historical' });
  const scope = strategicScope(vehicle, config.strategic.domains);
  const terms = (input.terms as string[] | undefined)?.map((t) => t.trim().toLowerCase()) ?? scope.terms;
  if (!terms.length) return answer(422, 'invalid', { error: 'This vehicle has no field terms on file; send terms.' }, { reason: 'terms' });
  try {
    const texts = await screenTexts(db, scope.company ? [...terms, scope.company] : terms);
    const ids = [...new Set(texts.map((t) => t.id))];
    const [entities, relations, onVehicle] = await Promise.all([
      db.query<{ id: string; type: string; name: string }>(`select entity_id::text id, entity_type::text type, display_name name
         from identity.entity where entity_id = any($1::uuid[]) and merged_into is null and retired_at is null`, [ids]),
      // The furthest status on another vehicle; passed only when every pursuit is passed.
      db.query<{ id: string; status: string }>(`select distinct on (identity.canonical_entity_id(p.entity_id))
           identity.canonical_entity_id(p.entity_id)::text id, p.status::text status
         from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
         where p.merged_into is null and p.vehicle_id <> $2 and identity.canonical_entity_id(p.entity_id) = any($1::uuid[])
         order by identity.canonical_entity_id(p.entity_id),
           array_position(array['committed','discussing','selected','sourcing','new','passed'], p.status::text)`, [ids, vehicle.id]),
      db.query<{ id: string }>(`select identity.canonical_entity_id(entity_id)::text id from strategy.pursuit
         where vehicle_id = $1 and merged_into is null`, [vehicle.id]),
    ]);
    const hits = rankScreen(texts, terms, scope.company,
      new Map(entities.map((e) => [e.id, e])), new Map(relations.map((r) => [r.id, r.status])), new Set(onVehicle.map((r) => r.id)));
    const chosen = hits.filter((h) => h.score >= minScore).slice(0, limit);
    const counts = { byScore: {} as Record<string, number>, byTerm: {} as Record<string, number>, byKind: {} as Record<string, number>, byRelation: {} as Record<string, number> };
    for (const h of hits) bump(counts.byScore, String(h.score));
    for (const h of chosen) {
      for (const t of h.terms) bump(counts.byTerm, t);
      for (const k of h.kinds) bump(counts.byKind, k);
      if (h.company) bump(counts.byKind, 'company');
      bump(counts.byRelation, h.relation ?? 'none');
      bump(counts.byKind, h.type);
    }
    const summary = { vehicle: vehicle.slug, terms, matched: hits.length, overMin: hits.filter((h) => h.score >= minScore).length,
      chosen: chosen.length, lowestChosen: chosen.at(-1)?.score ?? null, ...counts };
    if (!add) return answer(200, 'ok', { dryRun: true, ...summary }, { vehicle: vehicle.slug, matched: hits.length, chosen: chosen.length });
    const day = new Date().toISOString().slice(0, 10);
    const rows: Prospect[] = chosen.map((h) => ({
      entityId: h.id, entityType: h.type, name: h.name, org: null, vehicle: vehicle.slug, status: 'new',
      capacity: { band: 'not assessed', basis: 'The database screen reads fit, not capacity', guess: true },
      reason: h.reason, strategic: false, route: null,
      sources: [{ kind: 'database-screen', at: day, terms: h.terms, kinds: h.kinds, score: h.score }],
    }));
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const hash = createHash('sha256').update(text).digest('hex');
    const r = await addProspects(db, caller.user.id, [{ file: `${day}-screen-${vehicle.slug}.jsonl`, text }]);
    const result = { added: r.added, existing: r.existing, ambiguous: r.ambiguous, invalid: r.invalid.length, kept: r.kept };
    await appendAudit({ actorId: caller.user.id, action: 'enrich.prospects', subjectType: 'enrich',
      detail: { ...result, files: 1, source: 'screen', vehicle: vehicle.slug, terms, minScore, limit, inputHash: hash } }, db);
    return answer(200, 'ok', { dryRun: false, ...summary, ...result }, { vehicle: vehicle.slug, hash, added: r.added });
  } catch (e) {
    console.error('[screen] failed', e instanceof Error ? e.message : e);
    return answer(500, 'error', { error: 'The screen did not complete.' }, { reason: 'error' });
  }
}
