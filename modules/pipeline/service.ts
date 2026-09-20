import { getDb } from '@/lib/db';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { accreditationGate } from '@/modules/compliance';
import { getExposure } from './repo';

/**
 * Ask to move a soft commitment onto the hard track. This opens a MONEY ticket and
 * changes nothing — the conversion happens when the ticket is approved, and the ticket
 * states on its face that cash is a separate matter.
 */
export async function requestHardening(
  actorId: string,
  args: { exposureId: string; evidenceRef: string; note: string },
): Promise<string> {
  const exposure = await getExposure(args.exposureId);
  if (!exposure) throw new Error(`No exposure ${args.exposureId}`);
  if (exposure.track === 'hard') throw new Error(`${exposure.entityName} is already on the hard track.`);
  if (!args.evidenceRef.trim()) {
    throw new Error(
      'A hard commitment needs the document that makes it hard. Signed and countersigned, ' +
      'with a reference — not a recollection.',
    );
  }

  // 506(c) verification is an obligation, not a formality. Refuse before the ticket exists.
  const gate = await accreditationGate(exposure.entityId, exposure.vehicleId);
  if (!gate.ok) {
    throw new Error(`Refused: ${gate.reason}`);
  }

  return openTicket(actorId, {
    kind: 'MONEY',
    subjectType: 'exposure',
    subjectId: exposure.exposureId,
    subjectLabel: `Record $${exposure.amount.toFixed(1)}M hard — ${exposure.entityName}`,
    scope: {
      authorizes:
        `Moving ${exposure.entityName}'s $${exposure.amount.toFixed(1)}M on ${exposure.vehicleName} ` +
        `from the soft track to the hard track, on ${args.evidenceRef}.`,
      excludes: [
        'Recognising cash — the wire is a separate state',
        'Any announcement',
        'Any change to another vehicle',
      ],
      basis: [
        { label: 'Countersigned', value: args.note },
        { label: 'Moves', value: 'soft → hard' },
        { label: 'Cash received', value: 'No — a separate state' },
      ],
      apply: { command: 'pipeline.harden', args: { exposureId: exposure.exposureId, evidenceRef: args.evidenceRef } },
    },
    vehicleId: exposure.vehicleId,
    expiresInDays: 7,
  });
}

/** Fails closed without an approved MONEY ticket for exactly this exposure. */
export async function harden(
  actorId: string, args: { exposureId: string; evidenceRef: string; ticketId: string | null },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await requireApprovedTicket(tx, {
      kind: 'MONEY', subjectType: 'exposure', subjectId: args.exposureId, ticketId: args.ticketId,
    });
    const exposure = await getExposure(args.exposureId, tx);
    if (!exposure) throw new Error(`No exposure ${args.exposureId}`);
    if (exposure.track === 'hard') return; // idempotent

    // Re-checked inside the transaction: an approval from three days ago does not survive
    // a verification that expired yesterday.
    const gate = await accreditationGate(exposure.entityId, exposure.vehicleId, tx);
    if (!gate.ok) {
      throw new Error(
        `Refused: ${gate.reason} Nothing was recorded, and the ticket stays approved — the ` +
        'blocker is the verification, not the decision.',
      );
    }

    await tx.query(
      `update pipeline.exposure
          set track = 'hard', probability = null, evidence_ref = $2,
              hardened_at = now(), hardened_ticket = $3
        where exposure_id = $1`,
      [args.exposureId, args.evidenceRef, args.ticketId],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'exposure.hardened', 'exposure', $2, $3)`,
      [actorId, args.exposureId, JSON.stringify({
        entity: exposure.entityName, vehicle: exposure.vehicleName,
        amount: exposure.amount, evidence: args.evidenceRef,
      })],
    );
  });
}

/**
 * Cash landing is its own event. It is not an update to the commitment, it does not
 * change the hard total, and it never shares a check mark with the countersignature.
 */
export async function recordCash(
  actorId: string, args: { exposureId: string; receivedAt: Date; reference: string },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const exposure = await getExposure(args.exposureId, tx);
    if (!exposure) throw new Error(`No exposure ${args.exposureId}`);
    if (exposure.track !== 'hard') {
      throw new Error(
        `${exposure.entityName} is on the soft track. Cash cannot arrive against a commitment ` +
        'that has not been accepted.',
      );
    }
    await tx.query(
      'update pipeline.exposure set cash_received_at = $2 where exposure_id = $1',
      [args.exposureId, args.receivedAt],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'exposure.cash_received', 'exposure', $2, $3)`,
      [actorId, args.exposureId, JSON.stringify({ entity: exposure.entityName, reference: args.reference })],
    );
  });
}
