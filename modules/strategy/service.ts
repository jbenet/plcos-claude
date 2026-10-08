import { getDb, type Db, type Queryable } from '@/lib/db';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { getPursuit } from './repo';
import {
  PASSED_BY_LABEL, REASONS, RUNGS, RUNG_LABEL, RUNG_REQUIRES, STATUSES, STATUS_LABEL, rungIndex,
  type LadderRung, type PassedBy, type PursuitStatus,
} from './types';

export class LadderRefused extends Error {
  constructor(readonly reason: 'skipped' | 'already_recorded' | 'no_evidence', message: string) {
    super(message);
    this.name = 'LadderRefused';
  }
}

/**
 * Open a STAGE ticket to advance one rung. The scope names the rung and the evidence,
 * because "advance Vetchling Wagtail" is exactly the kind of opaque bundle an approval must not be.
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
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
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

export interface ClimbRung {
  rung: LadderRung;
  evidenceKind: string;
  evidenceRef: string;
  evidenceNote: string;
  occurredAt: string;
}

/**
 * Record several rungs at once, each on its own record (N57, docs/18). Reconciliation proposes
 * this when the records on file are ahead of the ladder — a meeting on the calendar is the record
 * for "Meeting held" and, since they came, for "LP opted in" — and a person approves it as one
 * STAGE ticket for the pursuit. Fails closed without that approval, and refuses if the ladder
 * moved since the proposal or the rungs are not the next ones in order: there is still no
 * skipping, only a climb in which every step names its record.
 */
export async function recordClimb(
  actorId: string,
  args: { pursuitId: string; ticketId: string | null; from: LadderRung | null; rungs: ClimbRung[] },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
    await requireApprovedTicket(tx, {
      kind: 'STAGE', subjectType: 'pursuit', subjectId: args.pursuitId, ticketId: args.ticketId,
    });
    await climb(tx, actorId, args, 'ladder.climbed');
  });
}

/**
 * The conversation rungs, which Reconciliation records itself from the records on file (issue 0137).
 * Juan, 8 Oct 2026: "i dont think we need this "decisions / approval" thing for these things" and
 * "system should be able to figure it out". Above them a number, a countersignature or a wire is
 * involved, and those keep their STAGE ticket.
 */
export const ON_RECORD_RUNGS: readonly LadderRung[] = ['connector_willing', 'target_opted_in', 'meeting_held'];
const ON_RECORD_KINDS = new Set(['calendar', 'meeting', 'email', 'not_applicable']);
/** The only actor that records without a ticket: the system's own, which no person can switch to. */
const ON_RECORD_ACTOR = 'reconciliation';
export const ON_RECORD_NOTE = 'recorded by Reconciliation from the records on file, no approval asked';

/**
 * Record a climb with no STAGE ticket (issue 0137). Only Reconciliation, only the conversation rungs,
 * and only on a meeting, a call, a reply or our event on file: the same checks as an approved climb,
 * with the ticket replaced by those limits. Each rung says it was recorded this way, and a person can
 * take it back (`retractOnRecord`), after which the same record is not used again.
 */
export async function recordClimbOnRecord(
  actorId: string,
  args: { pursuitId: string; from: LadderRung | null; rungs: ClimbRung[] },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
    const actor = await tx.one<{ handle: string; active: boolean }>(`select handle, active from platform.app_user where id = $1`, [actorId]);
    if (!actor || actor.handle !== ON_RECORD_ACTOR || actor.active) {
      throw new LadderRefused('no_evidence', 'Only Reconciliation records a rung without a STAGE ticket; nothing was recorded.');
    }
    for (const r of args.rungs) {
      if (!ON_RECORD_RUNGS.includes(r.rung) || !ON_RECORD_KINDS.has(r.evidenceKind)) {
        throw new LadderRefused('no_evidence', `${RUNG_LABEL[r.rung]} on a ${r.evidenceKind} needs a STAGE ticket; nothing was recorded.`);
      }
    }
    await climb(tx, actorId, {
      ...args, ticketId: null,
      rungs: args.rungs.map((r) => ({ ...r, evidenceNote: `${r.evidenceNote} · ${ON_RECORD_NOTE}` })),
    }, 'ladder.recorded_on_file');
  });
}

/**
 * Take back a rung Reconciliation recorded without a ticket, and the rungs above it, when they were
 * recorded the same way (issue 0137). A rung above it that a person approved stays, so this refuses.
 */
export async function retractOnRecord(actorId: string, args: { pursuitId: string; rung: LadderRung; note?: string | null }): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
    const rows = await tx.query<{ event_id: string; rung: LadderRung; ticket_id: string | null; handle: string; evidence_ref: string }>(
      `select l.event_id::text, l.rung, l.ticket_id::text, u.handle, l.evidence_ref
         from strategy.ladder_event l join platform.app_user u on u.id = l.recorded_by
        where l.pursuit_id = $1`, [args.pursuitId]);
    const from = rungIndex(args.rung);
    const gone = rows.filter((r) => rungIndex(r.rung) >= from);
    if (!gone.some((r) => r.rung === args.rung)) throw new LadderRefused('skipped', `${RUNG_LABEL[args.rung]} is not on file; nothing was taken back.`);
    const kept = gone.find((r) => r.ticket_id || r.handle !== ON_RECORD_ACTOR);
    if (kept) {
      throw new LadderRefused('skipped', `${RUNG_LABEL[kept.rung]} was recorded by a person or on an approval and sits on it; nothing was taken back.`);
    }
    await tx.query(`delete from strategy.ladder_event where event_id = any($1::uuid[])`, [gone.map((r) => r.event_id)]);
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'ladder.retracted', 'pursuit', $2, $3)`,
      [actorId, args.pursuitId, JSON.stringify({ rungs: gone.map((r) => r.rung), refs: gone.map((r) => r.evidence_ref), note: args.note ?? null })],
    );
    return gone.length;
  });
}

/** The records a person took back from Reconciliation's own climbs: never used again for that LP. */
export async function retractedRefs(q: Queryable, pursuitId?: string): Promise<Set<string>> {
  const rows = await q.query<{ k: string }>(
    `select subject_id::text || '|' || ref as k from platform.audit_log, jsonb_array_elements_text(detail->'refs') ref
      where action = 'ladder.retracted' and ($1::text is null or subject_id::text = $1::text)`, [pursuitId ?? null]);
  return new Set(rows.map((r) => r.k));
}

async function climb(
  tx: Queryable,
  actorId: string,
  args: { pursuitId: string; ticketId: string | null; from: LadderRung | null; rungs: ClimbRung[] },
  action: string,
): Promise<void> {
  const pursuit = await getPursuit(args.pursuitId, tx);
  if (!pursuit) throw new Error(`No pursuit ${args.pursuitId}`);
  if ((pursuit.rung ?? null) !== (args.from ?? null)) {
    throw new LadderRefused(
      'skipped',
      `The ladder moved since this was proposed: ${pursuit.entityName} is at ` +
      `${pursuit.rung ? RUNG_LABEL[pursuit.rung] : 'nothing on file'}; nothing was recorded.`,
    );
  }
  let at = rungIndex(pursuit.rung);
  for (const r of args.rungs) {
    if (rungIndex(r.rung) !== at + 1) {
      throw new LadderRefused('skipped', `${RUNG_LABEL[r.rung]} is not the next rung; nothing was recorded.`);
    }
    if (!r.evidenceRef.trim() || !r.evidenceNote.trim()) {
      throw new LadderRefused('no_evidence', `${RUNG_LABEL[r.rung]} requires: ${RUNG_REQUIRES[r.rung]}`);
    }
    at++;
  }
  for (const r of args.rungs) {
    await tx.query(
      `insert into strategy.ladder_event
         (pursuit_id, rung, evidence_kind, evidence_ref, evidence_note, ticket_id, recorded_by, occurred_at)
       values ($1,$2::strategy.ladder_rung,$3,$4,$5,$6,$7,$8)`,
      [args.pursuitId, r.rung, r.evidenceKind, r.evidenceRef, r.evidenceNote, args.ticketId, actorId, new Date(r.occurredAt)],
    );
  }
  await tx.query(
    `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
     values ($1, $2, 'pursuit', $3, $4)`,
    [actorId, action, args.pursuitId, JSON.stringify({
      entity: pursuit.entityName, vehicle: pursuit.vehicleName, from: args.from,
      rungs: args.rungs.map((r) => `${r.rung}:${r.evidenceKind}:${r.evidenceRef}`),
    })],
  );
}

export class StatusRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusRefused';
  }
}

export interface StatusChange {
  status: PursuitStatus;
  /** Required when it passed: a decline, our own call, and a silence are different endings. */
  passedBy?: PassedBy | null;
  /** When it passed, one of REASONS; otherwise a line about the status, or nothing. */
  reason?: string | null;
  nextStep?: string | null;
  nextStepOn?: Date | null;
}

/**
 * Set where our effort is with an LP (N50, docs/17). Any status to any status: a process that
 * goes backwards is recorded as going backwards, and the audit log keeps the history.
 *
 * No ticket, deliberately. A status is our plan and claims nothing about the LP — it never
 * writes to the ladder, which keeps its STAGE tickets, and never touches money, which keeps its
 * MONEY tickets. A status set here is never overwritten by a translation from Affinity.
 *
 * Inside a caller's transaction when given one (N61: an update and the status it changes are
 * written together), and with the update named in the audit row, so the timeline can show the
 * change as a consequence of the update rather than as a second event.
 */
export async function setStatus(
  actorId: string, pursuitId: string, change: StatusChange, opts: { q?: Queryable; updateId?: string } = {},
): Promise<void> {
  if (!STATUSES.some((s) => s.id === change.status)) throw new StatusRefused(`"${change.status}" is not a status this tool has.`);
  const passed = change.status === 'passed';
  if (passed && !change.passedBy) {
    throw new StatusRefused(`Say who ended it: ${Object.values(PASSED_BY_LABEL).join(', ').toLowerCase()}. They are different endings, and only one of them can be reopened by asking again.`);
  }
  if (change.passedBy && !(change.passedBy in PASSED_BY_LABEL)) throw new StatusRefused(`"${change.passedBy}" is not who can end a pursuit.`);
  const reason = change.reason?.trim() || null;
  if (passed && reason && !(REASONS as readonly string[]).includes(reason)) {
    throw new StatusRefused(`A pass reason is one of: ${REASONS.join(', ')}.`);
  }
  const nextStep = change.nextStep?.trim() || null;
  if (change.nextStepOn && !nextStep) throw new StatusRefused('A date needs a next step to be the date of.');

  const write = async (tx: Queryable) => {
    // Serialize the read and person decision against pursuit consolidation.
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
    const pursuit = await getPursuit(pursuitId, tx);
    if (!pursuit) throw new Error(`No pursuit ${pursuitId}`);
    await tx.query(
      `update strategy.pursuit set
         status = $2::strategy.pursuit_status, passed_by = $3, status_reason = $4,
         status_source = 'us', status_set_at = now(), status_set_by = $5,
         next_step = $6, next_step_on = $7,
         -- A pass ends the pursuit; reopening one un-ends it — unless its vehicle is history.
         closed_at = case when $2 = 'passed' then coalesce(closed_at, now())
                          when $8 then closed_at else null end,
         close_reason = case when $2 = 'passed' then coalesce($4, 'passed')
                             when $8 then close_reason else null end
       where pursuit_id = $1`,
      [pursuitId, change.status, passed ? change.passedBy : null, reason, actorId, nextStep,
       change.nextStepOn ?? null, pursuit.historical],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'pursuit.status_set', 'pursuit', $2, $3)`,
      [actorId, pursuitId, JSON.stringify({
        entity: pursuit.entityName, vehicle: pursuit.vehicleName,
        from: STATUS_LABEL[pursuit.status], to: STATUS_LABEL[change.status],
        // The ids as well as the words (N61): a label can be renamed; the timeline reads these.
        fromId: pursuit.status, toId: change.status,
        ...(passed ? { passedBy: change.passedBy } : {}), ...(reason ? { reason } : {}), ...(nextStep ? { nextStep } : {}),
        ...(opts.updateId ? { updateId: opts.updateId } : {}),
      })],
    );
  };
  if (opts.q) return 'transaction' in opts.q ? (opts.q as Db).transaction(write) : write(opts.q);
  const db = await getDb();
  await db.transaction(write);
}

/**
 * The next step alone (N61), for an update that names one and leaves the status where it is.
 * Unlike setStatus, it leaves the status and where it came from alone: a status read from
 * Affinity stays Affinity's to update.
 */
export async function setNextStep(
  actorId: string, pursuitId: string, step: { nextStep: string; nextStepOn: Date | null },
  opts: { q?: Queryable; updateId?: string } = {},
): Promise<void> {
  const nextStep = step.nextStep.trim();
  if (!nextStep) throw new StatusRefused('A next step needs words.');
  const write = async (tx: Queryable) => {
    // Serialize the read and person decision against pursuit consolidation.
    await tx.exec('lock table strategy.pursuit in row exclusive mode');
    const pursuit = await getPursuit(pursuitId, tx);
    if (!pursuit) throw new Error(`No pursuit ${pursuitId}`);
    await tx.query(`update strategy.pursuit set next_step = $2, next_step_on = $3 where pursuit_id = $1`, [pursuitId, nextStep, step.nextStepOn]);
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'pursuit.next_step_set', 'pursuit', $2, $3)`,
      [actorId, pursuitId, JSON.stringify({
        entity: pursuit.entityName, vehicle: pursuit.vehicleName, nextStep,
        ...(step.nextStepOn ? { on: step.nextStepOn.toISOString().slice(0, 10) } : {}),
        ...(opts.updateId ? { updateId: opts.updateId } : {}),
      })],
    );
  };
  if (opts.q) return 'transaction' in opts.q ? (opts.q as Db).transaction(write) : write(opts.q);
  const db = await getDb();
  await db.transaction(write);
}

