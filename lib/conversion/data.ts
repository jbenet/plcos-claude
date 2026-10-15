import { getDb } from '@/lib/db';
import { buildCache, liveRevisions } from '@/lib/build-cache';
import { teamAddresses } from '@/lib/comms/read';
import { lpStatsData } from '@/lib/lp-stats/data';
import { redactFact } from '@/lib/authz/read/r3';
import { DIMENSIONS, type LpFact } from '@/lib/lp-stats/model';
import { listExposures, vehicleTotals } from '@/modules/pipeline';
import { isAutoReply, isEvent, type Touchpoint } from '@/modules/meetings';
import { pursuitsOn, touchesOn, statusId } from '@/modules/strategy';
import type { PursuitFacts, Touch, Transition } from './model';

/**
 * The facts behind outreach conversion (docs/33), one per pursuit on the vehicle, kept per data generation like
 * LP stats (lib/build-cache): the page answers from the last build and rebuilds behind it when records change.
 * No query per LP. Read-only.
 */

export interface ConversionData {
  pursuits: PursuitFacts[];
  /** Each pursuit's segments as a reader without licensed (R3) fields sees them, by pursuit id. */
  redacted: Record<string, Record<string, string>>;
  /** Entity id (the pursuit's own, and its canonical one) -> pursuit id, to join DocSend visits by the LP they matched. */
  entities: Record<string, string>;
  target: number | null;
  /** Segment keys the LP stats facts supply, in LP stats' order, with their labels. */
  dims: Array<{ key: string; title: string; order: readonly string[]; labels: Record<string, string> }>;
  asOf: string;
}

const SEGMENT_KEYS = ['type', 'check', 'score', 'fit', 'tier', 'source', 'owner'] as const;

function touchOf(t: Touchpoint): Touch | null {
  if (!t.on || t.channel === 'research' || t.channel === 'event' || isEvent(t) || isAutoReply(t)) return null;
  const kind = t.channel === 'email' ? 'mail' : t.channel;
  if (kind === 'meeting' || kind === 'call') return { at: t.on, kind, direction: 'both', by: t.ownerName || null };
  // An Affinity mail whose sender it could not place has no direction: counted as contact, never as their reply.
  return { at: t.on, kind, direction: t.direction === 'theirs' ? 'theirs' : 'ours', by: t.direction === 'theirs' ? null : t.ownerName || null };
}

export const conversionData = buildCache(async (vehicleId: string): Promise<ConversionData> => {
  const db = await getDb();
  const [pursuits, touches, exposures, totals, stats, team] = await Promise.all([
    pursuitsOn(vehicleId), touchesOn(vehicleId), listExposures(vehicleId), vehicleTotals(), lpStatsData(vehicleId), teamAddresses(db),
  ]);
  const ids = pursuits.map((p) => p.pursuitId);
  const [mail, history] = await Promise.all([
    // juanmail's comms trace, linked to a pursuit on this vehicle. Unlinked mail is left to the touchpoints.
    db.query<{ pursuit_id: string; sent_at: Date; direction: 'ours' | 'theirs'; from_addr: string; subject: string | null; about_basis: string | null }>(
      `select pursuit_id::text, sent_at, direction, from_addr, subject, about_basis from email.comms_message
        where pursuit_id = any($1::uuid[])`, [ids]),
    // Status moves, through a merged pursuit to the one that carries it now (as modules/strategy/vehicle.ts reads them).
    db.query<{ subject_id: string; at: Date; detail: Record<string, unknown> }>(`select p.pursuit_id::text as subject_id, a.at, a.detail
        from platform.audit_log a
        join strategy.pursuit raw on raw.pursuit_id = case when a.subject_type='pursuit'
          and a.subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.subject_id::uuid end
        join strategy.active_pursuit p on p.pursuit_id = case when raw.merged_into is null then raw.pursuit_id else strategy.canonical_pursuit_id(raw.pursuit_id) end
       where p.vehicle_id = $1 and a.action = 'pursuit.status_set' order by a.at, a.id`, [vehicleId]),
  ]);

  const mailOf = new Map<string, Touch[]>();
  for (const m of mail) {
    if (isAutoReply({ direction: m.direction, aboutBasis: `${m.subject ?? ''} ${m.about_basis ?? ''}` })) continue;
    const t: Touch = { at: new Date(m.sent_at), kind: 'mail', direction: m.direction,
      by: m.direction === 'ours' ? team.get(m.from_addr.trim().toLowerCase()) ?? null : null };
    const list = mailOf.get(m.pursuit_id);
    if (list) list.push(t); else mailOf.set(m.pursuit_id, [t]);
  }
  const movesOf = new Map<string, Transition[]>();
  for (const r of history) {
    const from = statusId(r.detail.fromId ?? r.detail.from), to = statusId(r.detail.toId ?? r.detail.to);
    if (!from || !to || from === to) continue;
    const list = movesOf.get(r.subject_id);
    const t = { at: new Date(r.at), from, to };
    if (list) list.push(t); else movesOf.set(r.subject_id, [t]);
  }
  const moneyOf = new Map<string, { softAt: Date | null; soft: number; hardAt: Date | null; hard: number }>();
  for (const x of exposures) {
    const m = moneyOf.get(x.entityId) ?? { softAt: null, soft: 0, hardAt: null, hard: 0 };
    if (x.track === 'hard') { const at = x.hardenedAt ?? x.openedAt; m.hard += x.amount; m.hardAt = !m.hardAt || at < m.hardAt ? at : m.hardAt; }
    else { m.soft += x.amount; m.softAt = !m.softAt || x.openedAt < m.softAt ? x.openedAt : m.softAt; }
    moneyOf.set(x.entityId, m);
  }
  const factOf = new Map<string, LpFact>();
  for (const f of stats.facts) for (const p of f.pursuits) factOf.set(p.id, f);
  const now = new Date();
  const redacted: Record<string, Record<string, string>> = {};
  const entities: Record<string, string> = {};
  const dims = SEGMENT_KEYS.map((key) => DIMENSIONS.find((d) => d.key === key)!).filter(Boolean);

  const out: PursuitFacts[] = pursuits.map((p) => {
    const fact = factOf.get(p.pursuitId);
    entities[p.entityId] = p.pursuitId;
    if (fact) entities[fact.entityId] = p.pursuitId;
    const segments: Record<string, string> = {};
    if (fact) for (const d of dims) segments[d.key] = d.of(fact, now);
    if (fact) {
      const open = redactFact(fact);
      redacted[p.pursuitId] = Object.fromEntries(dims.map((d) => [d.key, d.of(open, now)]));
    }
    const money = moneyOf.get(p.entityId);
    // A mail can be both a touchpoint (Affinity) and in the trace (juanmail): one per day and direction is enough.
    const seen = new Set<string>();
    const all = [...(touches.get(`${p.entityId}:${vehicleId}`) ?? []).map(touchOf), ...(mailOf.get(p.pursuitId) ?? [])]
      .filter((t): t is Touch => {
        if (!t) return false;
        const k = `${t.kind === 'message' ? 'mail' : t.kind}:${t.direction}:${t.at.toISOString().slice(0, 10)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return {
      pursuitId: p.pursuitId, name: p.entityName, status: p.status, statusSetAt: p.statusSetAt, passedBy: p.passedBy,
      nextStepOn: p.nextStepOn, touches: all, transitions: movesOf.get(p.pursuitId) ?? [],
      softAt: money?.softAt ?? null, soft: money?.soft ?? 0, hardAt: money?.hardAt ?? null, hard: money?.hard ?? 0, segments,
    };
  });
  const labels = (d: (typeof dims)[number]) => Object.fromEntries([...new Set([...d.order, ...out.map((p) => p.segments[d.key]).filter(Boolean) as string[]])]
    .map((v) => [v, d.label(v)]));
  return {
    pursuits: out,
    redacted,
    entities,
    target: totals.find((t) => t.vehicleId === vehicleId)?.target ?? null,
    dims: dims.map((d) => ({ key: d.key, title: d.title, order: d.order, labels: labels(d) })),
    asOf: now.toISOString(),
  };
}, 16, liveRevisions);
