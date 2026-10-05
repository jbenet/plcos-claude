import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function coordinationProperties({ check, db }: SeedContext) {
  const halfAdjudicated = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.conflict_case
      where status = 'adjudicated'
        and (winner_ask_id is null or loser_ask_id is null
             or reason_code is null or loser_followup_at is null)`,
  );
  check(
    'Every adjudicated conflict has a winner, a loser, a reason and a dated follow-up',
    Number(halfAdjudicated[0]!.n) === 0,
    `${halfAdjudicated[0]!.n} incomplete adjudications`,
  );

  // Since 5 Oct 2026 only an autonomous agent's ask needs a ticket; a person's needs none.
  const ungatedAsks = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.ask a
      where a.status in ('proposed','blocked') and a.ticket_id is null
        and exists (select 1 from platform.audit_log l where l.action = 'ask.proposed' and l.subject_id = a.ask_id::text
                      and l.detail->>'autonomous' = 'true')`,
  );
  check(
    'Every live ask an autonomous agent proposed carries an approval ticket',
    Number(ungatedAsks[0]!.n) === 0,
    `${ungatedAsks[0]!.n} agent asks with no ticket`,
  );

}

export async function restrictionProperties({ check, db }: SeedContext) {
  const looseRestrictions = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.restriction
      where scope = 'connector' and connector_id is null`,
  );
  check(
    'A connector-scoped restriction names the connector',
    Number(looseRestrictions[0]!.n) === 0,
    `${looseRestrictions[0]!.n} unnamed`,
  );

}

export async function grantVariations(check: Check) {
  // The grants gate: blocked, and not overridable.
  {
    const d = await freshDb();
    const { evaluateGuards } = await import('../../modules/coordination');
    const iwasaki = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Iwasaki Institute'",
    ))!;
    const mbatha = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Mbatha Foundation'",
    ))!;
    const rail = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'grants'"))!;

    const blockedReport = await evaluateGuards({
      entityId: iwasaki.entity_id, connectorId: null, vehicleId: rail.id,
    });
    const openReport = await evaluateGuards({
      entityId: mbatha.entity_id, connectorId: null, vehicleId: rail.id,
    });
    const gateBlock = blockedReport.blocks.find((b) => b.rule === 'no_unsolicited_grant');

    check(
      'Variation — grants-rail outreach without an invitation',
      Boolean(gateBlock) && !openReport.blocks.some((b) => b.rule === 'no_unsolicited_grant'),
      'blocked for the sourced funder, permitted for the one with an invitation on file',
    );
    await d.close();
  }
}
