import { getDb } from '@/lib/db';
import { listAssessments } from '@/modules/fit';
import {
  DEFAULT_PARAMS, scoreMethods, type Gap, type Method, type MethodKind, type MethodStatus,
  type ScoreParams,
} from './scoring';

/**
 * The enrichment catalogue, and the gaps it could fill.
 *
 * The gap list is derived, never stored: a dimension graded on a guess, a hard gate nobody
 * has answered, a claim with low confidence. Storing it would mean maintaining a second
 * copy of what we do not know, and the second copy is the one that goes stale.
 */

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

export async function listMethods(
  gaps: Gap[] = [], params: ScoreParams = DEFAULT_PARAMS,
): Promise<Method[]> {
  const db = await getDb();
  const rows = await db.query<{
    method_id: string; kind: MethodKind; name: string; detail: string;
    yields: string[] | string; produces_tier: string; cost_usd: string | null;
    cost_basis: string | null; effort_days: string; latency_days: number | null;
    coverage: string; status: MethodStatus; blocked_by: string | null; limits: string | null;
    certainty: string; source: string | null; as_of: Date | string;
    human_days: string; ai_hours: string; automatable: boolean;
    selected: boolean; selected_by_name: string | null;
  }>(
    `select m.method_id, m.kind::text as kind, m.name, m.detail, m.yields::text[] as yields,
            m.produces_tier, m.cost_usd, m.cost_basis, m.effort_days, m.latency_days,
            m.coverage, m.status::text as status, m.blocked_by, m.limits, m.certainty,
            m.source, m.as_of, m.human_days, m.ai_hours, m.automatable, m.selected,
            u.name as selected_by_name
       from research.method m
       left join platform.app_user u on u.id = m.selected_by
      order by m.sort`,
  );

  const open = new Map(gaps.map((g) => [g.code, g.count]));

  const base = rows.map((r) => {
    const yields = parseArray(r.yields);
    return {
      methodId: r.method_id, kind: r.kind, name: r.name, detail: r.detail, yields,
      producesTier: r.produces_tier,
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      costBasis: r.cost_basis, effortDays: Number(r.effort_days),
      latencyDays: r.latency_days, coverage: r.coverage, status: r.status,
      blockedBy: r.blocked_by, limits: r.limits, certainty: r.certainty,
      source: r.source, asOf: new Date(r.as_of),
      humanDays: Number(r.human_days), aiHours: Number(r.ai_hours),
      automatable: r.automatable, selected: r.selected,
      selectedByName: r.selected_by_name,
      fills: yields.reduce((s, y) => s + (open.get(y) ?? 0), 0),
    };
  });

  return scoreMethods(base, params);
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

/** Choose, or unchoose, a method. A queue is a decision, so it carries a name and a time. */
export async function selectMethod(
  methodId: string, on: boolean, userId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `update research.method
        set selected = $2,
            selected_at = case when $2 then now() else null end,
            selected_by = case when $2 then $3::uuid else null end
      where method_id = $1`,
    [methodId, on, userId],
  );
}
