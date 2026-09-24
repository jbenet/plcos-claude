import { claimsFor } from '@/modules/research';
import { restrictionsFor } from '@/modules/coordination';
import { pursuitFor } from '@/modules/strategy';
import { getDb, type Queryable } from '@/lib/db';
import { listObjections, listQuestions, upcomingMeetings } from './repo';
import {
  CHANNELS, DIRECTION_LABEL, READS,
  type Channel, type Direction, type MeetingKind, type PrepBrief, type Read,
} from './types';

/**
 * Build a prep brief.
 *
 * Rule 9, enforced by construction: a claim reaches `supported` only if it carries a
 * source, an as-of date and a confidence. Anything missing one goes to `refused` with the
 * reason, so the brief shows the gap rather than omitting the row and reading as complete.
 */
export async function prepBrief(entityId: string, vehicleId: string): Promise<PrepBrief | null> {
  const [claims, objections, questions, restrictions, pursuit, upcoming] = await Promise.all([
    claimsFor(entityId),
    listObjections(entityId),
    listQuestions(entityId),
    restrictionsFor(entityId),
    pursuitFor(entityId, vehicleId),
    upcomingMeetings(),
  ]);

  const supported: PrepBrief['supported'] = [];
  const refused: PrepBrief['refused'] = [];

  for (const c of claims) {
    const p = c.provenance;
    if (!p.source || !p.asOf || !p.confidence) {
      refused.push({ field: c.field, why: 'No complete provenance tuple. The brief will not state it.' });
      continue;
    }
    if (p.confidence === 'low' && !p.lastVerifiedBy) {
      refused.push({
        field: c.field,
        why: `Low confidence from ${p.source} and nobody has verified it. Usable as a question, not as a statement.`,
      });
      continue;
    }
    supported.push({
      field: c.field, value: c.value, source: p.source, asOf: p.asOf, verifiedBy: p.lastVerifiedBy,
    });
  }

  const meeting = upcoming.find((m) => m.entityId === entityId) ?? null;

  return {
    entityId,
    entityName: pursuit?.entityName ?? claims[0]?.entityId ?? 'Unknown',
    vehicleName: pursuit?.vehicleName ?? '',
    meeting,
    supported,
    refused,
    openObjections: objections.filter((o) => o.status === 'open' || o.status === 'fatal'),
    openQuestions: questions.filter((q) => q.status === 'open' || q.status === 'blocked'),
    currentRung: pursuit?.rung ?? null,
    restriction: restrictions[0]?.instruction ?? null,
  };
}

export class TouchpointRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TouchpointRefused';
  }
}

export interface NewTouchpoint {
  entityId: string;
  /** The vehicle it was about, or null when it was about none in particular. */
  vehicleId: string | null;
  pursuitId?: string | null;
  channel: Channel;
  /** When it happened; a date ahead of today schedules it instead. */
  on: Date;
  direction?: Direction | null;
  summary?: string | null;
  /** Their read, by whoever logs it — only for something that has happened. */
  read?: Read | null;
  kind?: MeetingKind | null;
}

/**
 * Log a touchpoint (N51, docs/17). A record of what happened, not a claim on the ladder: a
 * meeting logged here is what a later "meeting held" request can point to as its evidence,
 * and the STAGE ticket is still where that is decided. No ticket, and nothing is sent.
 */
export async function logTouchpoint(actorId: string, t: NewTouchpoint, opts: { q?: Queryable; updateId?: string } = {}): Promise<string> {
  if (!CHANNELS.includes(t.channel)) throw new TouchpointRefused(`"${t.channel}" is not a kind of touchpoint this tool has.`);
  if (t.direction && !(t.direction in DIRECTION_LABEL)) throw new TouchpointRefused(`"${t.direction}" is not a direction.`);
  if (t.read && !READS.includes(t.read)) throw new TouchpointRefused(`"${t.read}" is not a read this tool records.`);
  if (!(t.on instanceof Date) || Number.isNaN(t.on.getTime())) throw new TouchpointRefused('A touchpoint needs the date it happened.');
  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  const ahead = t.on.getTime() > endOfToday.getTime();
  if (ahead && t.read) throw new TouchpointRefused('Their read is recorded after the touchpoint, by whoever was there — not before it.');
  const summary = t.summary?.trim() || null;
  // Rule 7: a search says what it inspected. A research pass with no corpus reads as thorough.
  if (t.channel === 'research' && !summary) throw new TouchpointRefused('Say what the research pass looked at, and over what dates (rule 7).');

  const write = async (tx: Queryable) => {
    const row = await tx.one<{ meeting_id: string }>(
      `insert into meetings.meeting
         (pursuit_id, entity_id, vehicle_id, kind, channel, direction, held_on, scheduled_for,
          owner_id, created_by, summary, read, read_by, source)
       values ($1,$2,$3,$4::meetings.meeting_kind,$5::meetings.channel,$6,$7,$8,$9,$9,$10,$11::meetings.read,$12,'us')
       returning meeting_id`,
      [t.pursuitId ?? null, t.entityId, t.vehicleId, t.kind ?? null, t.channel, t.direction ?? null,
       ahead ? null : t.on.toISOString().slice(0, 10), ahead ? t.on : null, actorId, summary,
       t.read ?? null, t.read ? actorId : null],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'touchpoint.logged', 'entity', $2, $3)`,
      [actorId, t.entityId, JSON.stringify({
        channel: t.channel, on: t.on.toISOString().slice(0, 10), scheduled: ahead, read: t.read ?? null,
        touchpointId: row!.meeting_id, ...(opts.updateId ? { updateId: opts.updateId } : {}),
      })],
    );
    return row!.meeting_id;
  };
  // Inside a caller's transaction when given one (N61: an update and what it logs are one write).
  if (opts.q) return write(opts.q);
  const db = await getDb();
  return db.transaction(write);
}
