import { getDb } from '@/lib/db';
import { listAssessments } from '@/modules/fit';

/**
 * The enrichment catalogue, and the gaps it could fill.
 *
 * The gap list is derived, never stored: a dimension graded on a guess, a hard gate nobody
 * has answered, a claim with low confidence. Storing it would mean maintaining a second
 * copy of what we do not know, and the second copy is the one that goes stale.
 */

export type MethodKind =
  | 'buy' | 'integrate' | 'query' | 'ask' | 'observe' | 'interview' | 'infer';
export type MethodStatus = 'available' | 'blocked' | 'in_use' | 'rejected';

export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  buy: 'Buy', integrate: 'Integrate', query: 'Query', ask: 'Ask',
  observe: 'Observe', interview: 'Interview', infer: 'Infer',
};

export const METHOD_KIND_MEANS: Record<MethodKind, string> = {
  buy: 'A dataset or a subscription. Costs money once and covers the whole universe.',
  integrate: 'A service we query programmatically. Costs engineering, then costs nothing.',
  query: 'A search somebody runs, by hand or with a model. Cheap, slow, and only as good as the reader.',
  ask: 'A direct question to somebody who would know. The highest-yield method and the one that spends goodwill.',
  observe: 'Something public, watched over time. Free, and produces clues rather than facts.',
  interview: 'A question put in a meeting or a first email. Free, and only available once.',
  infer: 'Derived from data we already hold. Free, instant, and never better than tier C.',
};

export const STATUS_LABEL: Record<MethodStatus, string> = {
  available: 'Available', blocked: 'Blocked', in_use: 'In use', rejected: 'Rejected',
};

export interface Method {
  methodId: string;
  kind: MethodKind;
  name: string;
  detail: string;
  yields: string[];
  producesTier: string;
  costUsd: number | null;
  costBasis: string | null;
  effortDays: number;
  latencyDays: number | null;
  coverage: string;
  status: MethodStatus;
  blockedBy: string | null;
  limits: string | null;
  certainty: string;
  source: string | null;
  asOf: Date;
  /** Derived: how many open gaps in the current universe this method would touch. */
  fills: number;
}

export interface Gap {
  /** The dimension or gate code. */
  code: string;
  label: string;
  /** 'dimension' | 'gate' */
  kind: 'dimension' | 'gate';
  /** How many assessed targets have this open. */
  count: number;
  /** Named targets, for the per-target view. */
  entities: string[];
  /** Why it is a gap: guessed, inferred, or unanswered. */
  why: string;
}

function parseArray(v: string[] | string | null): string[] {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return v.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * What is missing across a vehicle's assessed universe.
 *
 * A dimension graded on a guess and a gate nobody answered are different failures: the
 * first is a reading we should trust less, the second is a question nobody asked. Both
 * appear, labelled.
 */
export async function gapsFor(vehicleId: string | null): Promise<Gap[]> {
  const fit = await listAssessments(vehicleId);
  const byCode = new Map<string, Gap>();

  const bump = (code: string, label: string, kind: Gap['kind'], entity: string, why: string) => {
    const hit = byCode.get(`${kind}:${code}`);
    if (hit) {
      hit.count += 1;
      if (!hit.entities.includes(entity)) hit.entities.push(entity);
    } else {
      byCode.set(`${kind}:${code}`, { code, label, kind, count: 1, entities: [entity], why });
    }
  };

  for (const a of fit) {
    for (const d of a.dimensions) {
      if (d.certainty === 'guess') {
        bump(d.code, d.label, 'dimension', a.entityName, 'Graded on a guess.');
      } else if (d.certainty === 'inferred' && d.weightUs >= 4) {
        bump(d.code, d.label, 'dimension', a.entityName,
          'Inferred, on a dimension that carries weight.');
      }
    }
    for (const g of a.gates) {
      if (g.passed === null) {
        bump(g.code, g.label, 'gate', a.entityName, 'Nobody has answered it.');
      }
    }
  }

  return [...byCode.values()].sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
}

export async function listMethods(gaps: Gap[] = []): Promise<Method[]> {
  const db = await getDb();
  const rows = await db.query<{
    method_id: string; kind: MethodKind; name: string; detail: string;
    yields: string[] | string; produces_tier: string; cost_usd: string | null;
    cost_basis: string | null; effort_days: string; latency_days: number | null;
    coverage: string; status: MethodStatus; blocked_by: string | null; limits: string | null;
    certainty: string; source: string | null; as_of: Date | string;
  }>(
    `select method_id, kind::text as kind, name, detail, yields::text[] as yields,
            produces_tier, cost_usd, cost_basis, effort_days, latency_days, coverage,
            status::text as status, blocked_by, limits, certainty, source, as_of
       from research.method order by sort`,
  );

  const open = new Map(gaps.map((g) => [g.code, g.count]));

  return rows.map((r) => {
    const yields = parseArray(r.yields);
    return {
      methodId: r.method_id, kind: r.kind, name: r.name, detail: r.detail, yields,
      producesTier: r.produces_tier,
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      costBasis: r.cost_basis, effortDays: Number(r.effort_days),
      latencyDays: r.latency_days, coverage: r.coverage, status: r.status,
      blockedBy: r.blocked_by, limits: r.limits, certainty: r.certainty,
      source: r.source, asOf: new Date(r.as_of),
      fills: yields.reduce((s, y) => s + (open.get(y) ?? 0), 0),
    };
  }).sort((x, y) => y.fills - x.fills || x.effortDays - y.effortDays);
}

/** The gaps on one target, and the methods that would close them. */
export async function gapsForTarget(
  vehicleId: string, entityId: string,
): Promise<{ gaps: Gap[]; methods: Method[] }> {
  const fit = await listAssessments(vehicleId);
  const a = fit.find((x) => x.entityId === entityId);
  if (!a) return { gaps: [], methods: [] };

  const gaps: Gap[] = [];
  for (const d of a.dimensions) {
    if (d.certainty === 'guess' || (d.certainty === 'inferred' && d.weightUs >= 4)) {
      gaps.push({
        code: d.code, label: d.label, kind: 'dimension', count: 1, entities: [a.entityName],
        why: d.certainty === 'guess'
          ? `Graded on a guess: ${d.finding}`
          : `Inferred on a dimension that carries weight: ${d.finding}`,
      });
    }
  }
  for (const g of a.gates) {
    if (g.passed === null) {
      gaps.push({
        code: g.code, label: g.label, kind: 'gate', count: 1, entities: [a.entityName],
        why: g.detail,
      });
    }
  }

  const codes = new Set(gaps.map((g) => g.code));
  // Rejected methods are deliberately absent here. They belong on the catalogue page with
  // the reasoning intact; offering one as "what would close it" is how a decision gets
  // quietly relitigated by somebody who never saw why it was made.
  const methods = (await listMethods(gaps))
    .filter((m) => m.status !== 'rejected' && m.yields.some((y) => codes.has(y)));
  return { gaps, methods };
}
