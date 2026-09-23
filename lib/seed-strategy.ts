import type { Db } from './db';

/**
 * L5 seed: five pursuits at five different heights on the ladder.
 *
 * The point of the spread is that the screens have to render every rung honestly —
 * including a target sitting at "connector willing", which is the rung most likely to be
 * summarised into "interested" three hops later.
 */
export async function seedStrategy(db: Db): Promise<{ pursuits: number; ladderEvents: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from strategy.pursuit');
  if (existing && Number(existing.n) > 0) return { pursuits: 0, ladderEvents: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const on = (iso: string) => new Date(`${iso}T10:00:00Z`);

  interface Seeded {
    entity: string; vehicle: string; owner: string; headline: string;
    plan: Array<{ move: string; because: string; blockedBy?: string }>;
    events: Array<{ rung: string; kind: string; ref: string; note: string; at: string; by: string }>;
  }

  const seeded: Seeded[] = [
    {
      entity: 'Delia Roos', vehicle: 'neurotech', owner: 'juan',
      headline: 'Dual mandate: PRI-capable philanthropy and direct fund commitments. $2–5M band.',
      plan: [
        {
          move: 'Ask Duettmann for an opt-in, carrying the primer and the PRI structure note.',
          because: 'She is the only tier-A route, and she has already offered.',
          blockedBy: 'Conflict with PLC Crypto/Rails, who opened an ask on the same actor six days ago.',
        },
        {
          move: 'If she opts in, lead with the PRI path rather than the LP path.',
          because: 'Her last 47 grants include no LP positions at all — six recoverable grants and two PRIs.',
        },
        {
          move: 'Have the §4944(c) position ready before the first call, not after.',
          because: 'Her counsel raised jurisdictional questions in 2024 and nothing on file resolves them.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'relationship_note', ref: 'S04',
          note: 'Duettmann: "Happy to ask Delia whether she wants an intro." Explicitly not a commitment to advocate.',
          at: '2026-09-14', by: 'juan',
        },
      ],
    },
    {
      entity: 'Northwood Capital', vehicle: 'neurotech', owner: 'juan',
      headline: 'Multi-family office, $1.4B. Emerging-manager programme, 3–5 new managers a year.',
      plan: [
        {
          move: 'Send the DDQ pack Raman asked for.',
          because: 'She asked for it directly on 31 August.',
          blockedBy: 'No SEND ticket has been opened for it yet.',
        },
        {
          move: 'Do not record an indication until there is a number from them.',
          because: 'Asking for a DDQ is process interest. It is not a range.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'not_applicable', ref: 'direct',
          note: 'Direct approach — Raman asked at the Q3 event to be contacted. No connector was involved.',
          at: '2026-08-28', by: 'juan',
        },
        {
          rung: 'target_opted_in', kind: 'ask_outcome', ref: 'ask:raman',
          note: 'Raman replied the same week and asked for the DDQ pack.',
          at: '2026-08-31', by: 'juan',
        },
        {
          rung: 'meeting_held', kind: 'meeting', ref: 'meeting:2026-09-08',
          note: '45 minutes with Raman and one analyst. Neuro thesis and team; no terms discussed.',
          at: '2026-09-08', by: 'juan',
        },
      ],
    },
    {
      entity: 'Cedar Trust', vehicle: 'neurotech', owner: 'mara',
      headline: 'Endowment. Screened by Mercer & Bly. Countersigned 18 September; the wire has not landed.',
      plan: [
        {
          move: 'Confirm the wire and record cash separately from the commitment.',
          because: 'Commitment accepted and cash received are two states and never share one check mark.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'relationship_note', ref: 'note:mercer-2026-08-05',
          note: 'Mercer & Bly agreed to put us in front of Cedar as part of their screen.',
          at: '2026-08-05', by: 'mara',
        },
        {
          rung: 'target_opted_in', kind: 'ask_outcome', ref: 'ask:lindqvist',
          note: 'Lindqvist agreed to a first call.',
          at: '2026-08-11', by: 'mara',
        },
        {
          rung: 'meeting_held', kind: 'meeting', ref: 'meeting:2026-08-20',
          note: 'Lindqvist plus two of the investment team. Full pitch.',
          at: '2026-08-20', by: 'mara',
        },
        {
          rung: 'indication_given', kind: 'email', ref: 'email:2026-09-02',
          note: '"We would look at four, subject to the committee." A number, from them, in writing.',
          at: '2026-09-02', by: 'mara',
        },
        {
          rung: 'commitment_accepted', kind: 'document', ref: 'sub-doc:cedar-v3',
          note: 'Subscription document signed and countersigned. $4.0M.',
          at: '2026-09-18', by: 'tomas',
        },
      ],
    },
    {
      entity: 'Okonjo Family Office', vehicle: 'neurotech', owner: 'juan',
      headline: 'Generalist single family office with a neuro interest since 2024. No reply in three weeks.',
      plan: [
        {
          move: 'Leave it. Do not ask Duettmann again this quarter.',
          because: 'She is at 2 of 3 asks, and a second ask on a silent target spends goodwill for nothing.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'relationship_note', ref: 'note:duettmann-2026-08-21',
          note: 'Duettmann forwarded the opt-in request to Okonjo.',
          at: '2026-08-21', by: 'juan',
        },
      ],
    },
    {
      entity: 'Anne Quill', vehicle: 'spv-cortex', owner: 'juan',
      headline: 'Asked us to come back in November. Not a decline.',
      plan: [
        {
          move: 'Diarise a return in the first week of November.',
          because: 'She set the date herself, which is the strongest kind of permission to come back.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'relationship_note', ref: 'note:duettmann-2026-09-10',
          note: 'Duettmann agreed to make the introduction for the Cortex SPV.',
          at: '2026-09-10', by: 'juan',
        },
      ],
    },
    {
      entity: 'Delia Roos', vehicle: 'rails', owner: 'mara',
      headline: 'Same actor as the Neurotech pursuit. This is the collision.',
      plan: [
        {
          move: 'Hold until the conflict case is adjudicated.',
          because: 'Two vehicles reaching for the same person inside fourteen days is a case, not a race.',
        },
      ],
      events: [
        {
          rung: 'connector_willing', kind: 'relationship_note', ref: 'note:okonjo-2026-09-14',
          note: 'Okonjo agreed to ask Roos about a Rails conversation.',
          at: '2026-09-14', by: 'mara',
        },
      ],
    },
  ];

  let ladderEvents = 0;
  await db.transaction(async (tx) => {
    for (const s of seeded) {
      const rows = await tx.query<{ pursuit_id: string }>(
        `insert into strategy.pursuit (entity_id, vehicle_id, owner_id, headline, plan, opened_at)
         values ($1,$2,$3,$4,$5,$6) returning pursuit_id`,
        [e(s.entity), v(s.vehicle), u(s.owner), s.headline, JSON.stringify(s.plan),
         on(s.events[0]!.at)],
      );
      const pursuitId = rows[0]!.pursuit_id;
      for (const ev of s.events) {
        await tx.query(
          `insert into strategy.ladder_event
             (pursuit_id, rung, evidence_kind, evidence_ref, evidence_note, recorded_by, occurred_at)
           values ($1,$2::strategy.ladder_rung,$3,$4,$5,$6,$7)`,
          [pursuitId, ev.rung, ev.kind, ev.ref, ev.note, u(ev.by), on(ev.at)],
        );
        ladderEvents += 1;
      }
    }
  });

  return { pursuits: seeded.length, ladderEvents };
}

/**
 * The seed's pursuits get a status from their evidence (N50): the ladder is what they have, so
 * the status says no more than it does. The same reading migration 003 gave pursuits that
 * existed before statuses did. Run last, after every seed that opens pursuits.
 */
export async function statusFromEvidence(db: Db): Promise<{ statuses: number }> {
  const rows = await db.query<{ pursuit_id: string }>(
    `update strategy.pursuit p set status = (case
         when p.closed_at is not null and v.phase <> 'historical' then 'passed'
         when r.top in ('indication_given', 'commitment_accepted', 'cash_received') then 'committed'
         when r.top in ('target_opted_in', 'meeting_held') then 'discussing'
         when r.top = 'connector_willing' then 'selected'
         else 'sourcing' end)::strategy.pursuit_status,
       passed_by = case when p.closed_at is not null and v.phase <> 'historical' then 'them' end
       from platform.vehicle v,
            (select pp.pursuit_id,
                    (select l.rung::text from strategy.ladder_event l
                      where l.pursuit_id = pp.pursuit_id order by l.rung desc limit 1) as top
               from strategy.pursuit pp) r
      where v.id = p.vehicle_id and r.pursuit_id = p.pursuit_id and p.source = 'us' and p.status_source = 'us'
        and p.status_set_at is null
      returning p.pursuit_id`,
  );
  return { statuses: rows.length };
}
