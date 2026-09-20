import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { RULE_LABEL, type ConflictReason, type GuardBlock, type GuardReport } from './types';
import {
  asksToEntitySince, asksViaConnectorSince, competingAsks, getAsk, restrictionsFor,
} from './repo';

const quarterAgo = () => new Date(Date.now() - 92 * 86400_000);
const windowStart = () => new Date(Date.now() - config.guard.conflictWindowDays * 86400_000);

/**
 * Every rule that can refuse an ask, run in one place and reported together.
 *
 * The report always states what was inspected. An empty block list means "nothing in the
 * material available refused this", not "this is definitely fine" — the same distinction
 * the coverage disclosure makes for search.
 */
export async function evaluateGuards(
  args: { entityId: string; connectorId: string | null; vehicleId: string },
  q?: Queryable,
): Promise<GuardReport> {
  const blocks: GuardBlock[] = [];
  const since = quarterAgo();

  const priorToTarget = await asksToEntitySince(args.entityId, since, q);
  if (priorToTarget.length >= config.guard.asksPerRelationshipPerQuarter) {
    const last = priorToTarget[0]!;
    blocks.push({
      rule: 'relationship_frequency',
      message:
        `${priorToTarget.length} ask${priorToTarget.length === 1 ? '' : 's'} already made to ` +
        `${last.entityName} this quarter; the cap is ${config.guard.asksPerRelationshipPerQuarter}.`,
      evidence: `Most recent: ${last.vehicleName}, owned by ${last.ownerName}.`,
      opensCase: false,
    });
  }

  if (args.connectorId) {
    const viaConnector = await asksViaConnectorSince(args.connectorId, since, q);
    if (viaConnector.length >= config.guard.asksPerConnectorPerQuarter) {
      blocks.push({
        rule: 'connector_load',
        message:
          `${viaConnector[0]?.connectorName ?? 'This connector'} has been asked ` +
          `${viaConnector.length} times this quarter; the cap is ${config.guard.asksPerConnectorPerQuarter}.`,
        evidence:
          'Connector goodwill is the scarcer resource and the one you cannot buy back. ' +
          'The cap is a guess in config/deployment.ts and should move once real data exists.',
        opensCase: false,
      });
    }
  }

  // Rule 8. The restriction attaches to the target. A connector-scoped instruction is not
  // an invitation to find a different connector toward the same approach.
  const restrictions = await restrictionsFor(args.entityId, q);
  for (const r of restrictions) {
    const hitsThisConnector = r.connectorId && r.connectorId === args.connectorId;
    if (r.scope === 'blanket' || hitsThisConnector) {
      blocks.push({
        rule: 'non_circumvention',
        message: r.instruction,
        evidence:
          `Recorded by ${r.recordedByName ?? 'unattributed'}${r.source ? ` from ${r.source}` : ''}. ` +
          (r.scope === 'blanket'
            ? 'This is a blanket instruction: no route is available.'
            : 'Substituting another connector toward the same approach does not satisfy this.'),
        opensCase: false,
      });
    }
  }

  const competing = await competingAsks(args.entityId, args.vehicleId, windowStart(), q);
  if (competing.length > 0) {
    const other = competing[0]!;
    blocks.push({
      rule: 'cross_vehicle_conflict',
      message:
        `${other.vehicleName} has an open ask on the same actor, ` +
        `opened ${Math.round((Date.now() - (other.madeAt ?? other.createdAt).getTime()) / 86400_000)} days ago.`,
      evidence:
        `Inside the ${config.guard.conflictWindowDays}-day window. One vehicle proceeds; the other ` +
        'receives a dated follow-up rather than a silent loss.',
      opensCase: true,
    });
  }

  return {
    ok: blocks.length === 0,
    blocks,
    inspected:
      `Asks to this actor since ${since.toISOString().slice(0, 10)} across all vehicles, ` +
      `asks via this connector in the same period, restrictions on file for the target, and ` +
      `open asks in other vehicles inside ${config.guard.conflictWindowDays} days.`,
  };
}

export interface ProposeAskCommand {
  entityId: string;
  entityName: string;
  connectorId: string | null;
  connectorName: string | null;
  vehicleId: string;
  vehicleName: string;
  purpose: string;
  /** What the approval will and will not authorize. Written by the proposer, not inferred. */
  carries: string;
}

/**
 * Propose an ask. This never contacts anyone: it writes the ask, runs the guards, opens
 * an INTRO_ASK ticket, and opens a ConflictCase if another vehicle is already in the way.
 */
export async function proposeAsk(actorId: string, cmd: ProposeAskCommand) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const guard = await evaluateGuards(
      { entityId: cmd.entityId, connectorId: cmd.connectorId, vehicleId: cmd.vehicleId },
      tx,
    );
    const conflicting = guard.blocks.find((b) => b.opensCase);
    const status = guard.ok ? 'proposed' : 'blocked';

    const rows = await tx.query<{ ask_id: string }>(
      `insert into coordination.ask (entity_id, connector_id, vehicle_id, status, owner_id, purpose)
       values ($1,$2,$3,$4::coordination.ask_status,$5,$6) returning ask_id`,
      [cmd.entityId, cmd.connectorId, cmd.vehicleId, status, actorId, cmd.purpose],
    );
    const askId = rows[0]!.ask_id;

    const ticketId = await openTicket(
      actorId,
      {
        kind: 'INTRO_ASK',
        subjectType: 'ask',
        subjectId: askId,
        subjectLabel: cmd.connectorName
          ? `Route to ${cmd.entityName} via ${cmd.connectorName}`
          : `Direct approach to ${cmd.entityName}`,
        scope: {
          authorizes: cmd.carries,
          excludes: [
            'Contacting the target directly',
            'Moving the target to any pipeline stage',
            'Sending any material not named above',
          ],
          basis: guard.blocks.map((b) => ({ label: RULE_LABEL[b.rule], value: b.message })),
        },
        vehicleId: cmd.vehicleId,
        expiresInDays: 7,
      },
      tx,
    );
    await tx.query('update coordination.ask set ticket_id = $2 where ask_id = $1', [askId, ticketId]);

    let conflictCaseId: string | null = null;
    if (conflicting) {
      const competing = await competingAsks(cmd.entityId, cmd.vehicleId, windowStart(), tx);
      const other = competing[0];
      if (other) {
        const c = await tx.query<{ case_id: string }>(
          `insert into coordination.conflict_case (entity_id, window_days, claimant_a, claimant_b)
           values ($1,$2,$3,$4) returning case_id`,
          [cmd.entityId, config.guard.conflictWindowDays, other.askId, askId],
        );
        conflictCaseId = c[0]!.case_id;
      }
    }

    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'ask.proposed', 'ask', $2, $3)`,
      [actorId, askId, JSON.stringify({
        entity: cmd.entityName, vehicle: cmd.vehicleName, blocked: !guard.ok,
        rules: guard.blocks.map((b) => b.rule),
      })],
    );

    return { askId, ticketId, conflictCaseId, guard };
  });
}

/**
 * Record that the ask was actually made. Fails closed without an approved, unexpired
 * INTRO_ASK ticket, and re-runs the guards — an approval from four days ago does not
 * license an ask that a newer conflict has since blocked.
 */
export async function makeAsk(
  actorId: string,
  askId: string,
  ticketId: string | null,
  channel: string,
  override?: { reason: string },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const ask = await getAsk(askId, tx);
    if (!ask) throw new Error(`No ask ${askId}`);

    await requireApprovedTicket(tx, {
      kind: 'INTRO_ASK', subjectType: 'ask', subjectId: askId, ticketId,
    });

    const guard = await evaluateGuards(
      { entityId: ask.entityId, connectorId: ask.connectorId, vehicleId: ask.vehicleId },
      tx,
    );
    // The conflict that this ask itself created is not a reason to refuse it.
    const blocking = guard.blocks.filter((b) => !b.opensCase);

    // Rule 8 is not overridable. A do-not-approach instruction changes the plan; there is
    // no reason string that turns it into a permission.
    const absolute = blocking.filter((b) => b.rule === 'non_circumvention');
    if (absolute.length > 0) {
      throw new Error(
        `Refused: ${absolute[0]!.message} This restriction cannot be overridden — it is the ` +
        'target\u2019s instruction, not our policy.',
      );
    }

    const overridable = blocking.filter((b) => b.rule !== 'non_circumvention');
    if (overridable.length > 0 && !override?.reason) {
      throw new Error(
        `The ask was approved but a guard now refuses it: ${overridable[0]!.message} ` +
        'An override is permitted, but it must carry a reason. Nothing was recorded.',
      );
    }
    if (overridable.length > 0 && override?.reason) {
      await tx.query(
        'update coordination.ask set override_reason = $2 where ask_id = $1',
        [askId, override.reason],
      );
      await tx.query(
        `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
         values ($1, 'ask.guard_overridden', 'ask', $2, $3)`,
        [actorId, askId, JSON.stringify({
          reason: override.reason, rules: overridable.map((b) => b.rule),
        })],
      );
    }

    await tx.query(
      `update coordination.ask set status = 'made', made_at = now(), channel = $2 where ask_id = $1`,
      [askId, channel],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'ask.made', 'ask', $2, $3)`,
      [actorId, askId, JSON.stringify({ entity: ask.entityName, vehicle: ask.vehicleName, channel })],
    );
  });
}

/**
 * Adjudicate a conflict. The dated follow-up for the loser is required, not optional:
 * blocking without it protects the relationship and loses the opportunity silently, which
 * is the bug this whole table exists to prevent.
 */
export async function adjudicateConflict(
  actorId: string,
  args: {
    caseId: string; winnerAskId: string; reasonCode: ConflictReason;
    loserFollowupAt: string; note: string | null;
  },
): Promise<void> {
  if (!args.loserFollowupAt) {
    throw new Error(
      'Adjudication requires a dated follow-up for the losing vehicle. Without it this is a ' +
      'silent loss rather than a deferral.',
    );
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const row = await tx.one<{ claimant_a: string; claimant_b: string; status: string; entity_id: string }>(
      'select claimant_a, claimant_b, status, entity_id from coordination.conflict_case where case_id = $1',
      [args.caseId],
    );
    if (!row) throw new Error(`No conflict case ${args.caseId}`);
    if (row.status !== 'open') return; // idempotent: a double click must not re-adjudicate

    const loserAskId = row.claimant_a === args.winnerAskId ? row.claimant_b : row.claimant_a;
    if (![row.claimant_a, row.claimant_b].includes(args.winnerAskId)) {
      throw new Error('The winner must be one of the two claimants.');
    }

    await tx.query(
      `update coordination.conflict_case
          set status = 'adjudicated', winner_ask_id = $2, loser_ask_id = $3,
              reason_code = $4::coordination.conflict_reason, loser_followup_at = $5::date,
              adjudicated_by = $6, adjudicated_at = now(), note = $7
        where case_id = $1 and status = 'open'`,
      [args.caseId, args.winnerAskId, loserAskId, args.reasonCode, args.loserFollowupAt, actorId, args.note],
    );
    // The winner is unblocked; the loser keeps its dated second bite.
    await tx.query(`update coordination.ask set status = 'proposed' where ask_id = $1 and status = 'blocked'`, [args.winnerAskId]);
    await tx.query(
      `update coordination.ask set status = 'blocked', scheduled_for = $2::date where ask_id = $1`,
      [loserAskId, args.loserFollowupAt],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'conflict.adjudicated', 'conflict_case', $2, $3)`,
      [actorId, args.caseId, JSON.stringify({
        winner: args.winnerAskId, loser: loserAskId, reason: args.reasonCode,
        loser_followup_at: args.loserFollowupAt,
      })],
    );
  });
}
