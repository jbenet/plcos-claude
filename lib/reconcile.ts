import { getDb, type Queryable } from '@/lib/db';
import { shortDate } from '@/lib/time';
import { openTicket } from '@/modules/governance';
import { finishRun, startRun } from '@/modules/sources';
import { CHANNEL_LABEL, touchpointsByPair, type Touchpoint } from '@/modules/meetings';
import { STEP_LABEL, closeStates, type CloseTrack, type CommitmentEvent } from '@/modules/pipeline';
import {
  RUNGS, RUNG_LABEL, getPursuit, listPursuits, rungIndex, type ClimbRung, type LadderRung, type Pursuit,
} from '@/modules/strategy';

/**
 * Reconciliation (N57, docs/18). The records don't move in step: the calendar shows three
 * meetings, Affinity says "Due Diligence" and $5M soft, and the ladder says nothing on file,
 * because every rung waited for somebody to open a STAGE ticket, one rung at a time. Juan, 23 Sep
 * (issue 0002): "this will be messy and things wont move cleanly, we'll need to tolerate getting
 * 'the current state of affairs' from the available data we have. we may need to build in some
 * reconciliation."
 *
 * So after each translation this lays the records side by side for every pursuit: what the
 * ladder has accepted, what records in this system support, and what Affinity's word claims.
 * Where the records are ahead of the ladder, it proposes the climb — one STAGE ticket per
 * pursuit, requested by the system's own actor, listing every rung and the record behind it —
 * and a person approves it, one at a time or in a batch.
 *
 * What it never does: write a rung, set a status, change a read, count an Affinity field or a
 * note as evidence, or approve anything. Its proposals are data for a person.
 */

/** The record behind one rung, in the form the ladder stores it. */
export interface RungRecord {
  rung: LadderRung;
  /** 'calendar', 'meeting', 'email', 'commitment', 'countersignature', 'wire' or 'not_applicable'. */
  kind: string;
  ref: string;
  note: string;
  on: Date;
}

export interface OnFile {
  /** For each rung, the record in this system that supports it, if there is one. */
  byRung: Partial<Record<LadderRung, RungRecord>>;
  /** The rungs above what the ladder has accepted that the records support, in order, unbroken. */
  climb: RungRecord[];
  /** Where the climb would end, or null when the records are no further than the ladder. */
  to: LadderRung | null;
  /** The records behind the climb, so a proposal a person rejected is not made again. */
  key: string;
}

/** How a rung names the touchpoint behind it: the timeline matches on it (N61). */
export const refOf = (t: Touchpoint) => (t.sourceRef ? `${t.source}:${t.sourceRef}` : `touchpoint:${t.touchpointId}`);

function said(t: Touchpoint): string {
  const who = t.attendees.length ? `, with ${t.attendees.join(', ')}` : '';
  const from = t.source === 'us' ? 'logged here' : t.source === 'affinity' ? 'from Affinity' : `from ${t.source}`;
  // Why it counts for this raise (N59): the rule that read it, so a correction finds the others.
  const why = t.source !== 'us' && t.aboutBasis ? `; about the raise: ${t.aboutBasis}` : '';
  return `${CHANNEL_LABEL[t.channel]} on ${t.on ? shortDate(t.on) : 'an unknown date'}${who} (${from}${why})`;
}

const money = (n: number | null) => (n ? ` of $${n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}K`}` : '');

/**
 * What the records here support, rung by rung. Evidence only: a meeting or call that happened,
 * from the calendar or logged here; a reply from them; and close-track events a person recorded
 * here. An Affinity field, an Affinity "signed" or "wired", and a note are claims, not records,
 * and are not read at all.
 */
export function recordsOnFile(touches: Touchpoint[], tracks: CloseTrack[], now = new Date()): Partial<Record<LadderRung, RungRecord>> {
  const out: Partial<Record<LadderRung, RungRecord>> = {};
  const held = touches
    .filter((t) => !t.viaOrganization && t.on && t.on.getTime() <= now.getTime())
    .sort((a, b) => a.on!.getTime() - b.on!.getTime());
  const meeting = held.find((t) => t.channel === 'meeting' || t.channel === 'call');
  const reply = held.find((t) => (t.channel === 'email' || t.channel === 'message') && t.direction === 'theirs');

  if (meeting) {
    out.meeting_held = {
      rung: 'meeting_held', kind: meeting.source === 'us' ? 'meeting' : 'calendar', ref: refOf(meeting),
      note: `${said(meeting)} — the first on record`, on: meeting.on!,
    };
  }
  // They opted in when they first answered, or first came to a meeting, whichever was earlier.
  const first = [meeting, reply].filter((t): t is Touchpoint => Boolean(t)).sort((a, b) => a.on!.getTime() - b.on!.getTime())[0];
  if (first) {
    const isReply = first === reply;
    out.target_opted_in = {
      rung: 'target_opted_in', kind: isReply ? 'email' : first.source === 'us' ? 'meeting' : 'calendar', ref: refOf(first),
      note: isReply ? `A reply from them: ${said(first)}` : `They came to a meeting: ${said(first)}`, on: first.on!,
    };
    // In direct contact, the connector's rung has nothing to record: not applicable.
    out.connector_willing = {
      rung: 'connector_willing', kind: 'not_applicable', ref: refOf(first),
      note: `Not applicable: in direct contact with us since ${shortDate(first.on!)}`, on: first.on!,
    };
  }

  const ours = tracks.flatMap((t) => t.events).filter((e) => e.source === 'us')
    .sort((a, b) => (a.on ?? a.recordedAt).getTime() - (b.on ?? b.recordedAt).getTime());
  const event = (e: CommitmentEvent, rung: LadderRung, kind: string, what: string): RungRecord => ({
    rung, kind, ref: `commitment_event:${e.eventId}`, on: e.on ?? e.recordedAt,
    note: `${what}${money(e.amount)}, ${e.on ? `dated ${shortDate(e.on)}` : 'undated'}, recorded here${e.recordedByName ? ` by ${e.recordedByName}` : ''}`,
  });
  // A number from them: a soft amount, or documents they signed, recorded by a person here.
  const number = ours.find((e) => e.step === 'soft' || e.step === 'signed' || e.step === 'resigned' || e.step === 'countersigned');
  if (number) out.indication_given = event(number, 'indication_given', 'commitment', STEP_LABEL[number.step]);
  const counter = ours.find((e) => e.step === 'countersigned');
  if (counter) out.commitment_accepted = event(counter, 'commitment_accepted', 'countersignature', 'Countersigned');
  const wire = ours.find((e) => e.step === 'wired');
  if (wire) out.cash_received = event(wire, 'cash_received', 'wire', 'Wired');
  return out;
}

export function onFile(pursuit: Pursuit, touches: Touchpoint[], tracks: CloseTrack[], now = new Date()): OnFile {
  const byRung = recordsOnFile(touches, tracks, now);
  const climb: RungRecord[] = [];
  for (let i = rungIndex(pursuit.rung) + 1; i < RUNGS.length; i++) {
    const r = byRung[RUNGS[i]!];
    if (!r) break;
    climb.push(r);
  }
  const to = climb.length ? climb[climb.length - 1]!.rung : null;
  // A rejection holds for these records. A meeting held since is a new record, and asks again.
  const held = touches.filter((t) => !t.viaOrganization && t.on && t.on.getTime() <= now.getTime() && (t.channel === 'meeting' || t.channel === 'call')).length;
  // And what the proposal says about each record is part of it: an approval is of exactly the
  // words shown, so a reworded rule makes a new proposal rather than approving old words.
  const said = climb.map((r) => r.note).join('\u241E');
  let h = 0;
  for (let i = 0; i < said.length; i++) h = (Math.imul(h, 31) + said.charCodeAt(i)) | 0;
  return { byRung, climb, to, key: `${pursuit.rung ?? 'none'}>${climb.map((r) => `${r.rung}=${r.ref}`).join(',')}|meetings=${held}|said=${(h >>> 0).toString(36)}` };
}

export interface ReconcileCounts {
  pursuits: number;
  /** New proposals opened this run. */
  proposed: number;
  /** A STAGE ticket was already open for the pursuit: a person's, or an earlier proposal. */
  alreadyOpen: number;
  /** The same climb, on the same records, was rejected by a person before. */
  rejectedBefore: number;
  /** Earlier proposals of the system's that expired undecided, withdrawn and made again. */
  renewed: number;
  /** Earlier proposals of the system's whose records have changed — withdrawn, and made again if a climb still holds. */
  withdrawn: number;
  /** The records are no further than the ladder. */
  inStep: number;
  /** On a vehicle kept for its history: not proposed. */
  skipped: number;
}

const COMMAND = 'strategy.recordClimb';
export const SYSTEM_HANDLE = 'reconciliation';

export async function systemActor(): Promise<string> {
  const db = await getDb();
  const row = await db.one<{ id: string }>(`select id from platform.app_user where handle = $1 and not active`, [SYSTEM_HANDLE]);
  if (!row) throw new Error('No system actor: the platform migration 003 has not run.');
  return row.id;
}

/** Scope of one proposal: every rung it would record, and the record behind each. */
export function climbScope(p: Pursuit, f: OnFile) {
  const rungs: ClimbRung[] = f.climb.map((r) => ({
    rung: r.rung, evidenceKind: r.kind, evidenceRef: r.ref, evidenceNote: r.note, occurredAt: r.on.toISOString(),
  }));
  return {
    authorizes:
      `Recording that ${p.entityName} reached "${RUNG_LABEL[f.to!]}" on ${p.vehicleName}, one rung at a time from ` +
      `${p.rung ? `"${RUNG_LABEL[p.rung]}"` : 'nothing on file'}, each on the record named below.`,
    excludes: [
      `Any rung above ${RUNG_LABEL[f.to!]}`,
      'Any change to the status, the close track, the forecast or the hard total',
      'Any outbound message',
    ],
    basis: [
      { label: 'Currently at', value: p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file' },
      ...f.climb.map((r) => ({ label: RUNG_LABEL[r.rung], value: r.note, source: r.ref })),
      ...(p.stageSaid && p.source !== 'us' ? [{ label: 'Affinity says', value: `“${p.stageSaid}” — a claim, not used here` }] : []),
      { label: 'Proposed by', value: 'Reconciliation, from the records on file after a translation. Nothing is recorded until someone approves.' },
    ],
    apply: { command: COMMAND, args: { pursuitId: p.pursuitId, from: p.rung ?? null, rungs, key: f.key } },
  };
}

/**
 * Propose the climb for every pursuit whose records are ahead of its ladder. Safe to run again:
 * a pursuit with an open STAGE ticket is left alone, and a climb a person rejected is not proposed
 * again on the same records.
 */
export async function reconcile(runBy: string | null = null): Promise<ReconcileCounts> {
  const run = await startRun('reconcile', 'ladder', runBy);
  try {
    const counts = await propose();
    await finishRun(run, {
      status: 'ok', requests: 0, records: counts.pursuits, newRecords: counts.proposed,
      note: `${counts.proposed} new ladder ${counts.proposed === 1 ? 'proposal' : 'proposals'} · ${counts.alreadyOpen} already open · ${counts.inStep} in step${counts.withdrawn ? ` · ${counts.withdrawn} withdrawn` : ''}${counts.rejectedBefore ? ` · ${counts.rejectedBefore} rejected before` : ''}${counts.renewed ? ` · ${counts.renewed} renewed` : ''}`,
      detail: { ...counts },
    });
    return counts;
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error' });
    throw err;
  }
}

/**
 * The same, for one LP (N61): after an update logs a meeting, its climb is proposed at once
 * instead of at the next translation. No run is recorded — that is the whole pipeline's summary.
 */
export async function reconcilePursuit(pursuitId: string): Promise<ReconcileCounts> {
  return propose(pursuitId);
}

async function propose(only?: string): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = { pursuits: 0, proposed: 0, alreadyOpen: 0, rejectedBefore: 0, renewed: 0, withdrawn: 0, inStep: 0, skipped: 0 };
  const db = await getDb();
  const actor = await systemActor();
  const pursuits = only ? [await getPursuit(only)].filter((p): p is Pursuit => Boolean(p)) : await listPursuits(null);
  counts.pursuits = pursuits.length;
  // A passed LP's meetings still happened (N60): only a vehicle kept for its history is skipped.
  const live = pursuits.filter((p) => !p.historical);
  counts.skipped = pursuits.length - live.length;
  const pairs = live.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const [touches, closes] = await Promise.all([touchpointsByPair(pairs), closeStates(pairs)]);

  const open = new Map((await db.query<{ subject_id: string; id: string; mine: boolean; expired: boolean; key: string | null }>(
    `select subject_id::text, id::text, requested_by = $1 and scope->'apply'->>'command' = $2 as mine,
            coalesce(expires_at < now(), false) as expired, scope->'apply'->'args'->>'key' as key
       from governance.approval_ticket where kind = 'STAGE' and subject_type = 'pursuit' and decision is null
        and ($3::text is null or subject_id::text = $3::text)`,
    [actor, COMMAND, only ?? null],
  )).map((r) => [r.subject_id, r]));
  const withdraw = (tx: Queryable, id: string, why: string) => tx.query(
    `update governance.approval_ticket set decision = 'defer', decided_by = $2, decided_at = now(), decision_note = $3
      where id = $1 and decision is null`,
    [id, actor, why],
  );
  const rejected = new Set((await db.query<{ key: string }>(
    `select scope->'apply'->'args'->>'key' as key from governance.approval_ticket
      where kind = 'STAGE' and decision = 'reject' and scope->'apply'->>'command' = $1`,
    [COMMAND],
  )).map((r) => r.key));

  // A proposal of its own whose records no longer read the same is withdrawn — what it rested
  // on changed, or the rules that read the records did (N59). Withdrawing approves nothing.
  const changed = 'The records it rested on no longer read the same (N59: only what is about this raise, inside its window, counts). Proposed again from the records on file, if a climb still holds.';
  const liveIds = new Set(live.map((p) => p.pursuitId));
  for (const [pursuitId, t] of open) {
    if (t.mine && !liveIds.has(pursuitId)) {
      await db.transaction((tx) => withdraw(tx, t.id, 'Its vehicle is kept for its history; not proposed.'));
      counts.withdrawn++;
    }
  }
  for (const p of live) {
    const k = `${p.entityId}:${p.vehicleId}`;
    const track = closes.get(k);
    const f = onFile(p, touches.get(k) ?? [], track ? [track] : []);
    const existing = open.get(p.pursuitId);
    if (existing?.mine && existing.key !== f.key && !(f.climb.length && existing.expired)) {
      await db.transaction((tx) => withdraw(tx, existing.id, changed));
      counts.withdrawn++;
      open.delete(p.pursuitId);
    }
    if (!f.climb.length) { counts.inStep++; continue; }
    if (rejected.has(f.key)) { counts.rejectedBefore++; continue; }
    const still = open.get(p.pursuitId);
    if (still && !(still.mine && still.expired)) { counts.alreadyOpen++; continue; }
    await db.transaction(async (tx) => {
      if (still) {
        // Its own proposal ran out undecided. Withdrawing it approves nothing; it is asked again.
        await withdraw(tx, still.id, 'Expired undecided; proposed again from the records on file.');
        counts.renewed++;
      }
      await openTicket(actor, {
        kind: 'STAGE', subjectType: 'pursuit', subjectId: p.pursuitId,
        subjectLabel: `Advance ${p.entityName} to ${RUNG_LABEL[f.to!]} — on file`,
        scope: climbScope(p, f),
        vehicleId: p.vehicleId,
        expiresInDays: 30,
      }, tx);
    });
    counts.proposed++;
  }
  return counts;
}
