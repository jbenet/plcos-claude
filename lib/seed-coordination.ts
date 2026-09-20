import type { Db } from './db';

/**
 * L3 seed: a mid-raise picture with one live collision.
 *
 * The history is inserted directly, because it happened before this system existed. The
 * one new ask goes through `proposeAsk`, so the guards, the ticket and the conflict case
 * are produced by the real code path rather than written in by hand.
 */
export async function seedCoordination(db: Db): Promise<{ asks: number; tickets: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from coordination.ask');
  if (existing && Number(existing.n) > 0) return { asks: 0, tickets: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string; name: string }>(
    'select id, slug, name from platform.vehicle',
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!;

  const days = (n: number) => new Date(Date.now() - n * 86400_000);

  await db.transaction(async (tx) => {
    // The restriction from S05, promoted out of a note because a guard needs a precise input.
    await tx.query(
      `insert into coordination.restriction (entity_id, scope, connector_id, instruction, source, recorded_by)
       values ($1, 'connector', $2, $3, 'S05', $4)`,
      [
        e('Delia Roos'), e('Jonah Hale'),
        'Roos asked not to be introduced to fund managers through Jonah Hale.',
        u('mara'),
      ],
    );

    const history: Array<{
      entity: string; connector: string | null; vehicle: string; owner: string;
      purpose: string; madeDaysAgo: number; channel: string;
      outcome: 'opted_in' | 'declined' | 'no_reply' | 'deferred' | null; outcomeNote: string | null;
    }> = [
      {
        entity: 'Delia Roos', connector: 'Michael Okonjo', vehicle: 'rails', owner: 'mara',
        purpose: 'Opt-in request for a Rails conversation, carrying the Rails one-pager.',
        madeDaysAgo: 6, channel: 'email', outcome: null, outcomeNote: null,
      },
      {
        entity: 'Priya Raman', connector: null, vehicle: 'neurotech', owner: 'juan',
        purpose: 'Direct approach — Raman asked to be contacted at the Q3 event.',
        madeDaysAgo: 20, channel: 'email', outcome: 'opted_in', outcomeNote: 'Asked for the DDQ pack.',
      },
      {
        entity: 'Ivo Lindqvist', connector: 'Mercer & Bly', vehicle: 'neurotech', owner: 'mara',
        purpose: 'Opt-in request via the consultant who screens for Cedar.',
        madeDaysAgo: 40, channel: 'call', outcome: 'opted_in', outcomeNote: 'Moved to diligence 12 Sep.',
      },
      {
        entity: 'Michael Okonjo', connector: 'Allison Duettmann', vehicle: 'neurotech', owner: 'juan',
        purpose: 'Opt-in request for a Neurotech conversation.',
        madeDaysAgo: 30, channel: 'email', outcome: 'no_reply', outcomeNote: 'No reply after two weeks.',
      },
      {
        entity: 'Anne Quill', connector: 'Allison Duettmann', vehicle: 'spv-cortex', owner: 'juan',
        purpose: 'Opt-in request for the Cortex SPV.',
        madeDaysAgo: 10, channel: 'email', outcome: 'deferred', outcomeNote: 'Asked us to come back in November.',
      },
    ];

    for (const h of history) {
      await tx.query(
        `insert into coordination.ask
           (entity_id, connector_id, vehicle_id, status, owner_id, purpose, made_at, channel, outcome, outcome_note)
         values ($1,$2,$3,$4::coordination.ask_status,$5,$6,$7,$8,$9::coordination.ask_outcome,$10)`,
        [
          e(h.entity), h.connector ? e(h.connector) : null, v(h.vehicle).id,
          h.outcome ? 'answered' : 'made', u(h.owner), h.purpose,
          days(h.madeDaysAgo), h.channel, h.outcome, h.outcomeNote,
        ],
      );
    }

    // Tickets whose subjects belong to modules that do not exist yet. The subject_label
    // keeps the queue legible; the uuid keeps the foreign key honest when they land.
    const pending: Array<{
      kind: 'SEND' | 'STAGE'; label: string; subjectType: string;
      by: string; vehicle: string; authorizes: string; excludes: string[];
      basis: Array<{ label: string; value: string; source?: string }>;
    }> = [
      {
        kind: 'SEND', label: 'Neurotech primer v4 → Okonjo Family Office', subjectType: 'material_send',
        by: 'mara', vehicle: 'neurotech',
        authorizes: 'Sending the approved Neurotech primer, version 4, to Michael Okonjo and nobody else.',
        excludes: ['Sending the track record appendix', 'Any statement about the Rails vehicle', 'Forwarding rights'],
        basis: [
          { label: 'Wrap check', value: 'Passed — 506(c) fund, primer scope' },
          { label: 'Claims changed since last send', value: '2' },
          { label: 'Last verified', value: 'Mara Vance, 18 Sep' },
        ],
      },
      {
        kind: 'STAGE', label: 'Advance Northwood Capital to Diligence', subjectType: 'target_stage',
        by: 'sam', vehicle: 'neurotech',
        authorizes: 'Moving Northwood Capital from Meeting held to Diligence.',
        excludes: ['Any claim of indication or commitment', 'Any change to the forecast'],
        basis: [
          { label: 'Consent ladder', value: 'Meeting held' },
          { label: 'Evidence for the next rung', value: 'None on file' },
          { label: 'Requested because', value: 'Raman asked for the DDQ pack' },
        ],
      },
    ];

    for (const p of pending) {
      await tx.query(
        `insert into governance.approval_ticket
           (kind, subject_type, subject_id, subject_label, scope, vehicle_id, requested_by, expires_at, created_at)
         values ($1::governance.approval_kind, $2, gen_random_uuid(), $3, $4, $5, $6,
                 now() + interval '5 days', now() - interval '2 days')`,
        [p.kind, p.subjectType, p.label,
         JSON.stringify({ authorizes: p.authorizes, excludes: p.excludes, basis: p.basis }),
         v(p.vehicle).id, u(p.by)],
      );
    }
  });

  // The live one, through the real command path: guards run, a ticket opens, and the
  // collision with Rails produces a ConflictCase rather than a silent block.
  const { proposeAsk } = await import('@/modules/coordination');
  await proposeAsk(u('juan'), {
    entityId: e('Delia Roos'),
    entityName: 'Delia Roos',
    connectorId: e('Allison Duettmann'),
    connectorName: 'Allison Duettmann',
    vehicleId: v('neurotech').id,
    vehicleName: v('neurotech').name,
    purpose: 'Ask Duettmann for an opt-in, leading with the PRI path rather than the LP path.',
    carries:
      'One opt-in request to Allison Duettmann regarding Delia Roos, carrying the approved ' +
      'Neurotech primer (v4) and the PRI structure note, and nothing else.',
  });

  const counts = await db.one<{ asks: string; tickets: string }>(
    `select (select count(*)::text from coordination.ask) as asks,
            (select count(*)::text from governance.approval_ticket) as tickets`,
  );
  return { asks: Number(counts?.asks ?? 0), tickets: Number(counts?.tickets ?? 0) };
}
