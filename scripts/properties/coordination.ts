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

  const ungatedAsks = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.ask
      where status in ('proposed','blocked') and ticket_id is null`,
  );
  check(
    'Every live ask carries an approval ticket',
    Number(ungatedAsks[0]!.n) === 0,
    `${ungatedAsks[0]!.n} live asks with no ticket`,
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
    const halvorsen = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Halvorsen Institute'",
    ))!;
    const orsini = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Orsini Foundation'",
    ))!;
    const rail = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'grants'"))!;

    const blockedReport = await evaluateGuards({
      entityId: halvorsen.entity_id, connectorId: null, vehicleId: rail.id,
    });
    const openReport = await evaluateGuards({
      entityId: orsini.entity_id, connectorId: null, vehicleId: rail.id,
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
