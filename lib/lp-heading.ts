import { getDb } from '@/lib/db';

/**
 * Whose name leads an LP's row (issue 0013, real): the organisation's when it is the LP we are
 * targeting, with the person beneath; the person's otherwise, with their organisation beneath —
 * so the organisation is always in view.
 *
 * "The LP we are targeting" is read from what is on file, strongest first:
 *   1. the strategy's `ask.unit` (W5 1.5) — who would commit: a unit at the firm, or "personal";
 *   2. the investor type the research found: an institution's money (a fund-of-funds programme,
 *      family-office staff, an institution, a corporate, a foundation) makes the organisation
 *      the LP; a person's own (an angel, a principal, an operator, a GP, an adviser) keeps the
 *      person.
 * With neither, the person leads. The organisation is their open affiliation, the primary one
 * first — the one we deal with them through. A heading is presentation: it moves no status,
 * no rung and no money.
 */
export interface LpHeading {
  org: string | null;
  orgId: string | null;
  orgFirst: boolean;
}

/** Investor types whose money is the organisation's (docs/19, W1's `investorType`). */
const ORG_MONEY = new Set(['fund_lp_program', 'fo_staff', 'institutional', 'corporate', 'foundation']);

export function orgLeads(org: string | null, unit: string | null, investorType: string | null): boolean {
  if (!org) return false;
  if (unit?.trim()) return !/^personal\b/i.test(unit.trim());
  return investorType !== null && ORG_MONEY.has(investorType);
}

export async function lpHeadings(rows: Array<{ pursuitId: string; entityId: string }>): Promise<Map<string, LpHeading>> {
  const out = new Map<string, LpHeading>();
  if (!rows.length) return out;
  const db = await getDb();
  const entityIds = [...new Set(rows.map((r) => r.entityId))];
  const pursuitIds = rows.map((r) => r.pursuitId);
  const [affiliations, types, units] = await Promise.all([
    db.query<{ entity_id: string; org: string; org_id: string }>(
      `select distinct on (a.person_entity) a.person_entity::text as entity_id, o.display_name as org, o.entity_id::text as org_id
         from identity.affiliation a join identity.entity o on o.entity_id = a.org_entity
        where a.person_entity = any($1::uuid[]) and a.ended_on is null
        order by a.person_entity, a.is_primary desc, a.as_of desc`, [entityIds]),
    db.query<{ entity_id: string; t: string | null }>(
      `select distinct on (entity_id) entity_id::text, data->'profile'->>'investorType' as t
         from research.note where kind = 'public_profile' and entity_id = any($1::uuid[])
        order by entity_id, created_at desc`, [entityIds]),
    db.query<{ pursuit_id: string; unit: string | null }>(
      `select distinct on (pursuit_id) pursuit_id::text, data->'ask'->>'unit' as unit
         from strategy.suggestion where pursuit_id = any($1::uuid[]) and status in ('proposed', 'accepted')
        order by pursuit_id, made_at desc`, [pursuitIds]),
  ]);
  const orgOf = new Map(affiliations.map((a) => [a.entity_id, a.org]));
  const orgIdOf = new Map(affiliations.map((a) => [a.entity_id, a.org_id]));
  const typeOf = new Map(types.map((t) => [t.entity_id, t.t]));
  const unitOf = new Map(units.map((u) => [u.pursuit_id, u.unit]));
  for (const r of rows) {
    const org = orgOf.get(r.entityId) ?? null;
    out.set(r.pursuitId, { org, orgId: orgIdOf.get(r.entityId) ?? null, orgFirst: orgLeads(org, unitOf.get(r.pursuitId) ?? null, typeOf.get(r.entityId) ?? null) });
  }
  return out;
}
