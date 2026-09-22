import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { appendAudit } from '@/modules/platform';
import { getPlay } from './repo';
import type { Play } from './types';

/**
 * Assignment, commitment, and the Linear handoff that does not exist yet.
 *
 * Suggesting an owner and assigning one are different acts, and only the second is a
 * command. A board that assigned as it ranked would fill somebody's week with whatever the
 * arithmetic liked this morning.
 *
 * Neither of these is gated by an approval ticket, and that is deliberate: assigning work
 * is not in the five gated families (SEND · INTRO_ASK · MONEY · STAGE ·
 * ALLOCATION_EXCEPTION). What a play *leads to* may well be, which is why every play
 * carries the ticket kind it will eventually need and the board shows it.
 */

/** The shape a Linear issue would take. See docs/14-linear-integration-points.md. */
export interface LinearPayload {
  title: string;
  description: string;
  /** Handle, not an id — the mapping to Linear user ids does not exist yet. */
  assigneeHandle: string | null;
  labels: string[];
  /** Our id, so a returning webhook can find its way home. */
  sourceRef: string;
  sourceKind: 'play' | 'commitment';
}

function describe(play: Play): string {
  return [
    play.detail,
    '',
    `**Why this is on the list.** ${play.because}`,
    '',
    `**What it buys.** ${play.payoff}`,
    '',
    `Lever: ${play.lever} · likelihood ${play.likelihood}/5 · ${play.effortDays} person-days · `
    + `touches ${play.reach} target${play.reach === 1 ? '' : 's'}`,
    play.gate ? `\nThis needs an approved **${play.gate}** ticket before it can happen.` : '',
    play.entityName ? `\nTarget: ${play.entityName} · ${play.vehicleName}` : `\nVehicle: ${play.vehicleName}`,
  ].join('\n');
}

/**
 * Assign a play to someone, and record the ticket we would have opened.
 *
 * The handoff row is the integration point made visible: no Linear client is installed, so
 * instead of pretending to create an issue we write down exactly what would be sent and
 * leave it `pending`. When the connector lands it drains this table. The difference between
 * this and a stub is that this one is auditable and that one is a lie.
 */
export async function assignPlay(
  playId: string, assigneeId: string, actorId: string,
): Promise<{ handoffId: string; payload: LinearPayload }> {
  const db = await getDb();
  const play = await getPlay(playId);
  if (!play) throw new Error(`No such play: ${playId}`);

  return db.transaction(async (tx) => {
    const rows = await tx.query<{ handle: string; name: string }>(
      'select handle, name from platform.app_user where id = $1', [assigneeId],
    );
    const assignee = rows[0];
    if (!assignee) throw new Error('No such user.');

    await tx.query(
      `update plays.play
          set status = 'assigned', assigned_to = $2, assigned_at = now()
        where play_id = $1`,
      [playId, assigneeId],
    );

    const payload: LinearPayload = {
      title: play.title,
      description: describe(play),
      assigneeHandle: assignee.handle,
      labels: [config.product.slug, `lever:${play.lever}`, `horizon:${play.horizon}`,
        ...(play.gate ? [`gate:${play.gate}`] : [])],
      sourceRef: playId,
      sourceKind: 'play',
    };

    const out = await tx.query<{ handoff_id: string }>(
      `insert into plays.handoff (play_id, provider, payload, state, note)
       values ($1, 'linear', $2::jsonb, 'pending', $3)
       returning handoff_id`,
      [playId, JSON.stringify(payload),
       'No Linear connector is attached. This is the payload that would be sent.'],
    );

    await appendAudit({
      actorId, action: 'play.assigned', subjectType: 'play', subjectId: playId,
      detail: { assignee: assignee.handle, lever: play.lever, vehicle: play.vehicleName },
    }, tx);

    return { handoffId: out[0]!.handoff_id, payload };
  });
}

/**
 * What a parser can honestly pull out of free text, and nothing more.
 *
 * Lines that look like tasks, @handles, and dates. The original is kept beside it, because
 * a commitment that has been rewritten by a parser is a commitment nobody can be held to —
 * and because the moment this looks clever, somebody will trust it.
 */
export function parseCommitment(body: string): { lines: string[]; owners: string[]; dates: string[] } {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 0);
  const owners = [...new Set([...body.matchAll(/@([a-z0-9_-]+)/gi)].map((m) => m[1]!))];
  const dates = [...new Set([
    ...[...body.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!),
    ...[...body.matchAll(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/gi)]
      .map((m) => m[1]!),
  ])];
  return { lines, owners, dates };
}

export async function commit(
  vehicleId: string, entityId: string | null, body: string, actorId: string,
): Promise<{ commitmentId: string; handoffId: string }> {
  const db = await getDb();
  const parsed = parseCommitment(body);

  return db.transaction(async (tx) => {
    const rows = await tx.query<{ commitment_id: string }>(
      `insert into plays.commitment (vehicle_id, entity_id, body, written_by, parsed)
       values ($1, $2, $3, $4, $5::jsonb) returning commitment_id`,
      [vehicleId, entityId, body.trim(), actorId, JSON.stringify(parsed)],
    );
    const commitmentId = rows[0]!.commitment_id;

    const vehicle = (await tx.query<{ name: string }>(
      'select name from platform.vehicle where id = $1', [vehicleId]))[0];
    const entity = entityId
      ? (await tx.query<{ display_name: string }>(
          'select display_name from identity.entity where entity_id = $1', [entityId]))[0]
      : null;

    const payload: LinearPayload = {
      title: parsed.lines[0]?.slice(0, 96) ?? 'Commitment from the strategy board',
      description: [
        body.trim(),
        '',
        '---',
        `Committed on the strategy board for **${vehicle?.name ?? 'a vehicle'}**`
        + `${entity ? ` · ${entity.display_name}` : ''}.`,
        parsed.lines.length > 1 ? `\n${parsed.lines.length} lines were written.` : '',
        parsed.owners.length > 0 ? `Handles mentioned: ${parsed.owners.map((o) => `@${o}`).join(', ')}.` : '',
        parsed.dates.length > 0 ? `Dates mentioned: ${parsed.dates.join(', ')}.` : '',
      ].filter(Boolean).join('\n'),
      assigneeHandle: parsed.owners[0] ?? null,
      labels: [config.product.slug, 'commitment'],
      sourceRef: commitmentId,
      sourceKind: 'commitment',
    };

    const out = await tx.query<{ handoff_id: string }>(
      `insert into plays.handoff (commitment_id, provider, payload, state, note)
       values ($1, 'linear', $2::jsonb, 'pending', $3) returning handoff_id`,
      [commitmentId, JSON.stringify(payload),
       'No Linear connector is attached. This is the payload that would be sent.'],
    );

    await appendAudit({
      actorId, action: 'commitment.written', subjectType: 'commitment', subjectId: commitmentId,
      detail: { vehicle: vehicle?.name, entity: entity?.display_name ?? null, lines: parsed.lines.length },
    }, tx);

    return { commitmentId, handoffId: out[0]!.handoff_id };
  });
}
