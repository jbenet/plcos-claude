import { getDb } from '@/lib/db';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { getPursuit } from './repo';
import { RUNGS, RUNG_LABEL, RUNG_REQUIRES, rungIndex, type LadderRung } from './types';

export class LadderRefused extends Error {
  constructor(readonly reason: 'skipped' | 'already_recorded' | 'no_evidence', message: string) {
    super(message);
    this.name = 'LadderRefused';
  }
}

/**
 * Open a STAGE ticket to advance one rung. The scope names the rung and the evidence,
 * because "advance Northwood" is exactly the kind of opaque bundle an approval must not be.
 */
export async function requestAdvance(
  actorId: string,
  args: { pursuitId: string; rung: LadderRung; evidenceKind: string; evidenceRef: string; evidenceNote: string },
): Promise<string> {
  const pursuit = await getPursuit(args.pursuitId);
  if (!pursuit) throw new Error(`No pursuit ${args.pursuitId}`);

  const have = rungIndex(pursuit.rung);
  const want = rungIndex(args.rung);
  if (want <= have) {
    throw new LadderRefused('already_recorded', `${RUNG_LABEL[args.rung]} is already on file.`);
  }
  if (want > have + 1) {
    const missing = RUNGS.slice(have + 1, want).map((r) => RUNG_LABEL[r]).join(', ');
    throw new LadderRefused(
      'skipped',
      `Cannot go straight to ${RUNG_LABEL[args.rung]}: ${missing} ${want - have > 2 ? 'have' : 'has'} no evidence on file. ` +
      'There are no implicit transitions on this ladder.',
    );
  }
  if (!args.evidenceRef.trim() || !args.evidenceNote.trim()) {
    throw new LadderRefused(
      'no_evidence',
      `${RUNG_LABEL[args.rung]} requires: ${RUNG_REQUIRES[args.rung]}`,
    );
  }

  return openTicket(actorId, {
    kind: 'STAGE',
    subjectType: 'pursuit',
    subjectId: args.pursuitId,
    subjectLabel: `Advance ${pursuit.entityName} to ${RUNG_LABEL[args.rung]}`,
    scope: {
      authorizes:
        `Recording that ${pursuit.entityName} reached "${RUNG_LABEL[args.rung]}" on ${pursuit.vehicleName}, ` +
        `on the evidence below.`,
      excludes: [
        'Any claim about a later rung',
        'Any change to the forecast or to the hard total',
        'Any outbound message',
      ],
      basis: [
        { label: 'Currently at', value: pursuit.rung ? RUNG_LABEL[pursuit.rung] : 'Nothing on file' },
        { label: 'This rung requires', value: RUNG_REQUIRES[args.rung] },
        { label: 'Evidence offered', value: `${args.evidenceKind} ${args.evidenceRef} — ${args.evidenceNote}` },
      ],
      apply: {
        command: 'strategy.recordAdvance',
        args: {
          pursuitId: args.pursuitId, rung: args.rung, evidenceKind: args.evidenceKind,
          evidenceRef: args.evidenceRef, evidenceNote: args.evidenceNote,
        },
      },
    },
    vehicleId: pursuit.vehicleId,
    expiresInDays: 14,
  });
}

/**
 * Record the rung. Fails closed without an approved STAGE ticket for this exact pursuit,
 * and re-checks the no-skipping rule inside the transaction.
 */
export async function recordAdvance(
  actorId: string,
  args: {
    pursuitId: string; rung: LadderRung; ticketId: string | null;
    evidenceKind: string; evidenceRef: string; evidenceNote: string; occurredAt: Date;
  },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await requireApprovedTicket(tx, {
      kind: 'STAGE', subjectType: 'pursuit', subjectId: args.pursuitId, ticketId: args.ticketId,
    });
    const pursuit = await getPursuit(args.pursuitId, tx);
    if (!pursuit) throw new Error(`No pursuit ${args.pursuitId}`);
    if (rungIndex(args.rung) !== rungIndex(pursuit.rung) + 1) {
      throw new LadderRefused(
        'skipped',
        `The ladder moved since this was approved. ${pursuit.entityName} is at ` +
        `${pursuit.rung ? RUNG_LABEL[pursuit.rung] : 'nothing on file'}; nothing was recorded.`,
      );
    }
    await tx.query(
      `insert into strategy.ladder_event
         (pursuit_id, rung, evidence_kind, evidence_ref, evidence_note, ticket_id, recorded_by, occurred_at)
       values ($1,$2::strategy.ladder_rung,$3,$4,$5,$6,$7,$8)`,
      [args.pursuitId, args.rung, args.evidenceKind, args.evidenceRef, args.evidenceNote,
       args.ticketId, actorId, args.occurredAt],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'ladder.advanced', 'pursuit', $2, $3)`,
      [actorId, args.pursuitId, JSON.stringify({
        entity: pursuit.entityName, vehicle: pursuit.vehicleName, rung: args.rung,
        evidence: `${args.evidenceKind}:${args.evidenceRef}`,
      })],
    );
  });
}
