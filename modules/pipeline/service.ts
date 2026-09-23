import { getDb, type Queryable } from '@/lib/db';
import { usdM } from '@/lib/money';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { accreditationGate } from '@/modules/compliance';
import { syncCountersignature } from '@/modules/close';
import { closeTracksFor, getExposure } from './repo';

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
    subjectLabel: `Record ${usdM(exposure.amount)} hard — ${exposure.entityName}`,
    scope: {
      authorizes:
        `Moving ${exposure.entityName}'s ${usdM(exposure.amount)} on ${exposure.vehicleName} ` +
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

    const now = new Date();
    await tx.query(
      `update pipeline.exposure
          set track = 'hard', probability = null, evidence_ref = $2,
              hardened_at = $4, hardened_ticket = $3
        where exposure_id = $1`,
      [args.exposureId, args.evidenceRef, args.ticketId, now],
    );
    // One event, two tables, one writer. The pack and the exposure record the same
    // countersignature and must not be able to disagree about it.
    const synced = await syncCountersignature(exposure.entityId, exposure.vehicleId, now, tx);
    // And the close track (N52) records it too, in the same transaction.
    await event(tx, actorId, exposure.exposureId, { step: 'countersigned', on: now, amount: exposure.amount, reference: args.evidenceRef });

    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'exposure.hardened', 'exposure', $2, $3)`,
      [actorId, args.exposureId, JSON.stringify({
        entity: exposure.entityName, vehicle: exposure.vehicleName,
        amount: exposure.amount, evidence: args.evidenceRef, packItemsSynced: synced,
      })],
    );
  });
}

/**
 * Cash landing is its own event. It is not an update to the commitment, it does not
 * change the hard total, and it never shares a check mark with the countersignature.
 * The whole of what is still outstanding; a fund's call in parts is recordWire.
 */
export async function recordCash(
  actorId: string, args: { exposureId: string; receivedAt: Date; reference: string },
): Promise<void> {
  const [track] = await tracks(args.exposureId);
  await recordWire(actorId, args.exposureId, {
    on: args.receivedAt, amount: track?.outstanding ?? 0, reference: args.reference,
  });
}

// ---------------------------------------------------------------- the close track (N52)

export class CloseRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloseRefused';
  }
}

async function event(
  tx: Queryable, actorId: string, exposureId: string,
  e: { step: string; on: Date | null; amount?: number | null; document?: string | null; reason?: string | null; reference?: string | null },
): Promise<void> {
  await tx.query(
    `insert into pipeline.commitment_event (exposure_id, step, occurred_on, amount, document, reason, reference, recorded_by)
     values ($1, $2::pipeline.commitment_step, $3, $4, $5, $6, $7, $8)`,
    [exposureId, e.step, e.on ? e.on.toISOString().slice(0, 10) : null, e.amount ?? null, e.document ?? null,
     e.reason ?? null, e.reference ?? null, actorId],
  );
  await tx.query(
    `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
     values ($1, $2, 'exposure', $3, $4)`,
    [actorId, `commitment.${e.step}`, exposureId, JSON.stringify({ on: e.on?.toISOString().slice(0, 10) ?? null, amount: e.amount ?? null, document: e.document ?? null, reason: e.reason ?? null })],
  );
}

async function tracks(exposureId: string) {
  const x = await getExposure(exposureId);
  if (!x) throw new CloseRefused(`No commitment ${exposureId}.`);
  return (await closeTracksFor(x.entityId, x.vehicleId)).filter((t) => t.exposure.exposureId === exposureId);
}

const dated = (on: Date) => {
  if (!(on instanceof Date) || Number.isNaN(on.getTime())) throw new CloseRefused('It needs the date it happened.');
  if (on.getTime() > Date.now() + 86_400_000) throw new CloseRefused('That date is ahead of today: the close track records what has happened.');
  return on;
};

/**
 * They signed — or signed again. A second signature needs its reason (the entity changed, the
 * documents were amended), because two signatures with no reason read as a mistake. Signing
 * moves no money: it is countersignature, through a MONEY ticket, that makes it hard.
 */
export async function recordSignature(
  actorId: string, exposureId: string, args: { on: Date; document: string; reason?: string | null },
): Promise<void> {
  const [t] = await tracks(exposureId);
  if (!t) throw new CloseRefused('That commitment is closed.');
  if (t.state === 'withdrawn') throw new CloseRefused('They withdrew; a signature now is a new commitment, not this one.');
  if (!args.document.trim()) throw new CloseRefused('Say which document, and which version of it.');
  const again = t.events.some((e) => (e.step === 'signed' || e.step === 'resigned') && e.source === 'us');
  if (again && !args.reason?.trim()) throw new CloseRefused('They have signed before: say why they signed again — the entity changed, the documents were amended.');
  const db = await getDb();
  await db.transaction((tx) => event(tx, actorId, exposureId, {
    step: again ? 'resigned' : 'signed', on: dated(args.on), document: args.document.trim(), reason: args.reason?.trim() || null,
  }));
}

/** Admitted at a closing. Only a hard commitment closes: a soft one has nothing to admit. */
export async function recordClosing(actorId: string, exposureId: string, args: { on: Date; closing: string }): Promise<void> {
  const [t] = await tracks(exposureId);
  if (!t || t.exposure.track !== 'hard') throw new CloseRefused('Only a countersigned commitment is admitted at a closing. Harden it first, on Soft → Hard.');
  if (t.state === 'closed') throw new CloseRefused(`Already closed${t.closedOn ? ` on ${t.closedOn.toISOString().slice(0, 10)}` : ''}.`);
  const db = await getDb();
  await db.transaction((tx) => event(tx, actorId, exposureId, { step: 'closed', on: dated(args.on), document: args.closing.trim() || 'closing' }));
}

/**
 * A wire landed: an amount on a date. Several to a commitment, because a fund is called in
 * parts; never more in total than the commitment, because that is a different commitment or
 * a mistake. Cash against a commitment nobody has accepted is refused, as before.
 */
export async function recordWire(
  actorId: string, exposureId: string, args: { on: Date; amount: number; reference: string },
): Promise<void> {
  const [t] = await tracks(exposureId);
  if (!t) throw new CloseRefused('That commitment is closed.');
  if (t.exposure.track !== 'hard') {
    throw new CloseRefused(`${t.exposure.entityName} is on the soft track. Cash cannot arrive against a commitment that has not been accepted.`);
  }
  if (!(args.amount > 0)) throw new CloseRefused('A wire is an amount: nothing has landed yet.');
  if (!args.reference.trim()) throw new CloseRefused('A wire needs its reference — the confirmation it can be reconciled against.');
  if (t.wired + args.amount > t.exposure.amount + 0.5) {
    throw new CloseRefused(`That would make ${usdM(t.wired + args.amount, 2)} wired against a ${usdM(t.exposure.amount, 2)} commitment. More than committed is a new commitment, or a mistake.`);
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await event(tx, actorId, exposureId, { step: 'wired', on: dated(args.on), amount: args.amount, reference: args.reference.trim() });
    // The first wire is when cash started arriving; kept for everything that reads it.
    await tx.query(`update pipeline.exposure set cash_received_at = coalesce(cash_received_at, $2) where exposure_id = $1`, [exposureId, args.on]);
  });
}

/** They named a different amount. Soft only: a hard number changes through the close room. */
export async function reviseSoft(actorId: string, exposureId: string, args: { on: Date; amount: number }): Promise<void> {
  const [t] = await tracks(exposureId);
  if (!t || t.exposure.track !== 'soft') throw new CloseRefused('Only a soft amount is revised here. A countersigned one changes through the documents.');
  if (!(args.amount > 0)) throw new CloseRefused('A soft commitment is an amount. None is a withdrawal — record that instead.');
  const db = await getDb();
  await db.transaction(async (tx) => {
    await event(tx, actorId, exposureId, { step: 'soft', on: dated(args.on), amount: args.amount });
    await tx.query(`update pipeline.exposure set amount = $2 where exposure_id = $1 and track = 'soft'`, [exposureId, args.amount]);
  });
}

/** They pulled out. Soft only; the commitment leaves every total, with the reason kept. */
export async function withdraw(actorId: string, exposureId: string, args: { on: Date; reason: string }): Promise<void> {
  const [t] = await tracks(exposureId);
  if (!t) throw new CloseRefused('That commitment is closed.');
  if (t.exposure.track === 'hard') throw new CloseRefused('A countersigned commitment is not withdrawn with a click. It is a legal matter; the close room has it.');
  if (!args.reason.trim()) throw new CloseRefused('Say why they withdrew.');
  const db = await getDb();
  await db.transaction(async (tx) => {
    await event(tx, actorId, exposureId, { step: 'withdrawn', on: dated(args.on), reason: args.reason.trim() });
    await tx.query(`update pipeline.exposure set closed_at = now() where exposure_id = $1`, [exposureId]);
  });
}
