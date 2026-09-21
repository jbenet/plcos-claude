import type { Db } from './db';

/**
 * Floor seed: enough concurrent work that the five views have something to disagree about.
 *
 * The earlier seeds are teaching fixtures — each one exists to make a single rule visible.
 * Six pursuits is plenty for that and far too few for a wall display, where the question is
 * "what does forty things at once look like" and the answer has to include the boring ones.
 *
 * Dates here are **relative to the moment the database is seeded**, unlike every other seed
 * in this directory. A floor whose most recent record is four months old looks calm, and
 * calm is exactly the reading these views must never give by accident.
 */
export async function seedFloor(db: Db): Promise<{ floorPursuits: number; floorMeetings: number; floorRuns: number }> {
  const existing = await db.one<{ n: string }>(
    "select count(*)::text as n from strategy.pursuit where headline like '%[floor]%'",
  );
  if (existing && Number(existing.n) > 0) return { floorPursuits: 0, floorMeetings: 0, floorRuns: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;

  /** Days ago, at a plausible hour. */
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000 + 10 * 3_600_000);
  const ahead = (d: number) => new Date(Date.now() + d * 86_400_000 + 14 * 3_600_000);

  interface P {
    entity: string; vehicle: string; owner: string; headline: string;
    /** rung → days ago it was evidenced. Order is the order they happened. */
    walk: Array<[string, number, string]>;
    blockedBy?: string;
    next?: string;
    soft?: { amount: number; probability: number };
  }

  const pursuits: P[] = [
    {
      entity: 'Sable Point Capital', vehicle: 'neurotech', owner: 'sam',
      headline: '[floor] Credit-heavy allocator testing a venture sleeve. No route on file yet.',
      walk: [['connector_willing', 12, 'Mork said she would raise it with their CIO.']],
      next: 'A reply from Sable Point, not from Mork.',
      soft: { amount: 7_000_000, probability: 0.35 },
    },
    {
      entity: 'Tessaro Family Office', vehicle: 'neurotech', owner: 'ines',
      headline: '[floor] Single family office, neuro interest stated publicly in 2025.',
      walk: [['connector_willing', 41, 'Marisa Tessaro agreed to pass the primer to her father.']],
      next: 'Anything at all from the family. Nothing for six weeks.',
      soft: { amount: 3_000_000, probability: 0.25 },
    },
    {
      entity: 'Elena Navarro', vehicle: 'neurotech', owner: 'juan',
      headline: '[floor] Angel turned family-office principal. Writes her own cheques, fast.',
      walk: [
        ['connector_willing', 17, 'Hale offered the intro at the September dinner.'],
        ['target_opted_in', 12, 'Navarro replied directly and asked for the deck.'],
        ['meeting_held', 4, '40 minutes, no terms. She asked twice about reserves.'],
      ],
      next: 'A number or a range from her. She has not given one.',
      soft: { amount: 2_500_000, probability: 0.45 },
    },
    {
      entity: 'Priya Raman', vehicle: 'rails', owner: 'mara',
      headline: '[floor] Northwood’s principal, acting personally on the Rails side.',
      walk: [
        ['connector_willing', 30, 'Direct — she asked to be contacted about Rails.'],
        ['target_opted_in', 23, 'Replied within the week.'],
        ['meeting_held', 15, 'Rails thesis and the custody question.'],
        ['indication_given', 9, '“Somewhere between one and two” — recorded as a range, not a commitment.'],
      ],
      next: 'Signed and countersigned. Nothing below that moves it to hard.',
      soft: { amount: 1_500_000, probability: 0.6 },
    },
    {
      entity: 'Halvorsen Institute', vehicle: 'rails', owner: 'mara',
      headline: '[floor] Institute treasury exploring a rails allocation. Not the grants rail.',
      walk: [
        ['connector_willing', 6, 'Adeyemi offered to introduce their treasurer.'],
        ['target_opted_in', 3, 'Treasurer replied asking what the custody model is.'],
      ],
      next: 'A meeting with a date on it.',
    },
    {
      entity: 'Anneliese Mork', vehicle: 'rails', owner: 'sam',
      headline: '[floor] Adviser to two of our targets. Reads as a connector, not a cheque.',
      walk: [['connector_willing', 27, 'Said yes to asking Sable Point, then went quiet.']],
      next: 'Anything from Mork. Three and a half weeks of nothing.',
    },
    {
      entity: 'Curtis Adeyemi', vehicle: 'spv-lattice', owner: 'tomas',
      headline: '[floor] Operator angel, wrote into two prior SPVs at this size.',
      walk: [
        ['connector_willing', 3, 'Lindqvist offered to forward the Lattice memo.'],
        ['target_opted_in', 1, 'Adeyemi asked for the cap table and the timeline.'],
      ],
      next: 'A number from him.',
      soft: { amount: 750_000, probability: 0.55 },
    },
    {
      entity: 'Rosa Iglesias', vehicle: 'spv-cortex', owner: 'tomas',
      headline: '[floor] Vantage’s deal lead, exploring a personal allocation.',
      walk: [['connector_willing', 9, 'Iglesias raised it herself after the Cortex briefing.']],
      next: 'Confirmation she can invest personally alongside Vantage.',
    },
    {
      entity: 'Hannah Boyle', vehicle: 'rails', owner: 'ines',
      headline: '[floor] Cedar Trust’s analyst. Not a decision-maker; a route to one.',
      walk: [
        ['connector_willing', 21, 'Boyle agreed to put Rails in front of Lindqvist.'],
        ['target_opted_in', 15, 'Lindqvist asked for a one-pager. Cedar, not Boyle, is the target.'],
      ],
      next: 'A meeting with Lindqvist, not with Boyle.',
    },
    {
      entity: 'Gordon Whitcomb', vehicle: 'spv-halo', owner: 'sam',
      headline: '[floor] Already in Cortex. Halo is a second, smaller ask of the same person.',
      walk: [['connector_willing', 34, 'Agreed in principle at the Cortex close. Nothing since.']],
      blockedBy: 'One ask per relationship per quarter — the Cortex ask used this quarter’s.',
      next: 'The frequency window opens again in October.',
    },
    {
      entity: 'Marisa Tessaro', vehicle: 'spv-lattice', owner: 'mara',
      headline: '[floor] The daughter, who actually runs the office’s venture sleeve.',
      walk: [
        ['connector_willing', 7, 'Offered to look at Lattice personally.'],
        ['target_opted_in', 2, 'Asked for the memo and the co-investor list.'],
      ],
      next: 'A meeting, or a number.',
      soft: { amount: 1_000_000, probability: 0.4 },
    },
    {
      entity: 'Michael Okonjo', vehicle: 'neurotech', owner: 'ines',
      headline: '[floor] Principal of the family office. The office already has an open ask.',
      walk: [['connector_willing', 11, 'Said he would rather be asked directly than through the office.']],
      blockedBy: 'The Okonjo Family Office ask is open in the same window — same money, two doors.',
      next: 'Decide which door. Both is not an option.',
    },
    {
      entity: 'Ivo Lindqvist', vehicle: 'spv-cortex', owner: 'juan',
      headline: '[floor] Cedar’s CIO, asked about a personal allocation to Cortex.',
      walk: [
        ['connector_willing', 5, 'Raised it himself.'],
        ['target_opted_in', 1, 'Confirmed in writing that he wants the memo.'],
      ],
      next: 'A number. He has not given one.',
      soft: { amount: 500_000, probability: 0.5 },
    },
    {
      entity: 'Rachel Kaplan', vehicle: 'neurotech', owner: 'juan',
      headline: '[floor] Signs for the trust. A second neuro allocation is hers to decide.',
      walk: [
        ['connector_willing', 19, 'Direct — she asked at the annual meeting.'],
        ['target_opted_in', 16, 'Asked for the Q3 update pack.'],
        ['meeting_held', 9, 'Update meeting. No new money discussed.'],
      ],
      next: 'An indication for the second allocation. The first is already wired.',
    },
  ];

  const meetings: Array<{ entity: string; vehicle: string; kind: string; when: number; owner: string; attendees: string[] }> = [
    { entity: 'Elena Navarro', vehicle: 'neurotech', kind: 'follow_up', when: 3, owner: 'juan', attendees: ['Elena Navarro', 'Juan'] },
    { entity: 'Halvorsen Institute', vehicle: 'rails', kind: 'intro', when: 5, owner: 'mara', attendees: ['Their treasurer', 'Mara Vance'] },
    { entity: 'Priya Raman', vehicle: 'rails', kind: 'diligence', when: 8, owner: 'mara', attendees: ['Priya Raman', 'Mara Vance', 'Tomás Reyes'] },
    { entity: 'Marisa Tessaro', vehicle: 'spv-lattice', kind: 'pitch', when: 6, owner: 'mara', attendees: ['Marisa Tessaro', 'Mara Vance'] },
    { entity: 'Curtis Adeyemi', vehicle: 'spv-lattice', kind: 'intro', when: 2, owner: 'tomas', attendees: ['Curtis Adeyemi', 'Tomás Reyes'] },
    { entity: 'Rachel Kaplan', vehicle: 'neurotech', kind: 'committee', when: 12, owner: 'juan', attendees: ['Rachel Kaplan', 'Two trustees', 'Juan'] },
    { entity: 'Ivo Lindqvist', vehicle: 'spv-cortex', kind: 'follow_up', when: 4, owner: 'juan', attendees: ['Ivo Lindqvist', 'Juan'] },
    { entity: 'Sable Point Capital', vehicle: 'neurotech', kind: 'intro', when: 15, owner: 'sam', attendees: ['Their CIO', 'Anneliese Mork', 'Sam Ferreira'] },
  ];

  let floorMeetings = 0;
  let floorRuns = 0;

  await db.transaction(async (tx) => {
    // Two more budgets, so the pool check has something to check on the new names.
    for (const p of [
      { entity: 'Sable Point Capital', budget: 12_000_000, source: 'Stated by Mork, second-hand', as_of: 30, verified: null },
      { entity: 'Tessaro Family Office', budget: 6_000_000, source: 'Their published annual letter, 2025', as_of: 120, verified: 'ines' },
    ]) {
      await tx.query(
        `insert into pipeline.capital_pool (entity_id, budget, source, as_of, verified_by)
         values ($1,$2,$3,$4::date,$5)
         on conflict do nothing`,
        [e(p.entity), p.budget, p.source, ago(p.as_of).toISOString().slice(0, 10),
         p.verified ? u(p.verified) : null],
      );
    }

    for (const p of pursuits) {
      const plan = [
        { move: p.next ?? 'Decide what the next rung needs.', because: 'The rung above needs its own evidence record.',
          ...(p.blockedBy ? { blockedBy: p.blockedBy } : {}) },
      ];
      const rows = await tx.query<{ pursuit_id: string }>(
        `insert into strategy.pursuit (entity_id, vehicle_id, owner_id, headline, plan, opened_at)
         values ($1,$2,$3,$4,$5,$6) returning pursuit_id`,
        [e(p.entity), v(p.vehicle), u(p.owner), p.headline, JSON.stringify(plan),
         ago(p.walk[0]![1])],
      );
      const pursuitId = rows[0]!.pursuit_id;
      for (const [rung, when, note] of p.walk) {
        await tx.query(
          `insert into strategy.ladder_event
             (pursuit_id, rung, evidence_kind, evidence_ref, evidence_note, recorded_by, occurred_at)
           values ($1,$2::strategy.ladder_rung,$3,$4,$5,$6,$7)`,
          [pursuitId, rung, 'relationship_note', `note:floor-${pursuitId.slice(0, 8)}-${rung}`,
           note, u(p.owner), ago(when)],
        );
      }
      if (p.soft) {
        await tx.query(
          `insert into pipeline.exposure
             (entity_id, vehicle_id, instrument, track, amount, probability, owner_id, opened_at)
           values ($1,$2,$3::pipeline.instrument,'soft',$4,$5,$6,$7)`,
          [e(p.entity), v(p.vehicle), p.vehicle.startsWith('spv') ? 'spv' : 'lp_commitment',
           p.soft.amount, p.soft.probability, u(p.owner), ago(p.walk[0]![1])],
        );
      }
    }

    for (const m of meetings) {
      await tx.query(
        `insert into meetings.meeting (entity_id, vehicle_id, kind, scheduled_for, attendees, owner_id)
         values ($1,$2,$3::meetings.meeting_kind,$4,$5,$6)`,
        [e(m.entity), v(m.vehicle), m.kind, ahead(m.when), m.attendees, u(m.owner)],
      );
      floorMeetings += 1;
    }

    /**
     * Agent work in flight. Two running, two finished and waiting on a person — which is
     * the only end state a run is allowed to have, since no tool sends anything and no
     * tool accepts its own task.
     */
    const env = await tx.query<{ envelope_id: string }>(
      `insert into agents.envelope
         (task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
          acceptance_criteria, escalation_owner, created_by)
       values ($1,$2,$3,$4,$5,null,$6,$7,$8,$9) returning envelope_id`,
      [
        'Find public portfolio pages for eight unqualified targets',
        'Eight named targets. Public sources only. Read-only, no outbound anything.',
        ['research.source_doc', 'research.claim'],
        ['research.read', 'research.write_note'],
        JSON.stringify({ tokens: 120_000, seconds: 900 }),
        'NoteDraft[]',
        [
          'Every note carries source, as-of, confidence and verifier',
          'Nothing inferred about a person’s health, or their family’s, ever',
          'A target with no public page is reported as not found, not as nothing',
        ],
        u('ines'), u('ines'),
      ],
    );
    const envelopeId = env[0]!.envelope_id;

    const runs: Array<{ status: string; kind: string; minutesAgo: number; finished: boolean; rationale: string }> = [
      { status: 'proposed', kind: 'enrichment', minutesAgo: 22, finished: false,
        rationale: 'Running. Four of eight targets read so far.' },
      { status: 'proposed', kind: 'enrichment', minutesAgo: 35, finished: false,
        rationale: 'Running. Reading the Tessaro annual letter.' },
      { status: 'proposed', kind: 'brief', minutesAgo: 90, finished: true,
        rationale: 'Draft prep brief for the Navarro follow-up. Waiting on a person to accept it.' },
      { status: 'proposed', kind: 'enrichment', minutesAgo: 240, finished: true,
        rationale: 'Six notes drafted, two targets reported as not found. Waiting on a person.' },
    ];
    for (const r of runs) {
      await tx.query(
        `insert into agents.run
           (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash,
            agent_kind, rationale, started_at, finished_at)
         values ($1,$2::agents.run_status,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
        [
          envelopeId, r.status, 'seed-config-floor', '{}', `seed-input-${r.minutesAgo}`,
          'seed-prompt-floor', r.kind, r.rationale,
          new Date(Date.now() - r.minutesAgo * 60_000),
          r.finished ? new Date(Date.now() - (r.minutesAgo - 15) * 60_000) : null,
        ],
      );
      floorRuns += 1;
    }
  });

  return { floorPursuits: pursuits.length, floorMeetings, floorRuns };
}
