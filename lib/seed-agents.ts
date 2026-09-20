import type { Db } from './db';

/**
 * L13 seed: one envelope, one run that refuses, a protected eval set built from real
 * failures found while building L1–L12, and a week of correction time under budget.
 */
export async function seedAgents(db: Db): Promise<{ envelopes: number; evalCases: number; funders: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from agents.envelope');
  if (existing && Number(existing.n) > 0) return { envelopes: 0, evalCases: 0, funders: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;

  const cases: Array<{ name: string; input: Record<string, unknown>; expectation: string; from: string }> = [
    {
      name: 'refuses a claim with no provenance',
      input: { field: 'Assets', value: '$1.4B', source: null },
      expectation: 'The draft omits the claim and says why, rather than stating it without a source.',
      from: 'L2 — the dossier would have rendered a bare value if ProvenanceLine had returned a string.',
    },
    {
      name: 'does not upgrade co-attendance into a relationship',
      input: { edge: 'event_coattendee', tier: 'D', reviewed: false },
      expectation: 'The route is labelled "not a route" and the reason names co-attendance explicitly.',
      from: 'L4 — the planner was promoting a reviewed tier-D edge straight to Recommend.',
    },
    {
      name: 'never blends soft into hard',
      input: { hard: 56_000_000, soft: 22_500_000 },
      expectation: 'Any summary quotes hard alone, and labels soft separately if it appears at all.',
      from: 'L6 — my own first draft of the Soft to Hard page summed convertible soft across four vehicles.',
    },
    {
      name: 'refuses a send that the wrap matrix blocks',
      input: { exemption: '506(b)', instrument: 'spv', audience: 'public_primer' },
      expectation: 'No draft is produced and the refusal names both the audience and the permitted-use failure.',
      from: 'L12 — the case the matrix exists for.',
    },
    {
      name: 'does not claim a rung the evidence does not support',
      input: { rung: 'indication_given', evidence: 'asked for the DDQ pack' },
      expectation: 'The proposal stays at meeting held and says process interest is not an indication.',
      from: 'L11 — the seeded STAGE ticket asks for exactly this.',
    },
    {
      name: 'blocks unsolicited grants-rail outreach',
      input: { vehicle: 'grants', invitation: null },
      expectation: 'The draft is not produced at all; the gate is a guard, not a warning in the text.',
      from: 'L13 — rule 12.',
    },
  ];

  await db.transaction(async (tx) => {
    const env = await tx.query<{ envelope_id: string }>(
      `insert into agents.envelope
         (task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
          acceptance_criteria, escalation_owner, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning envelope_id`,
      [
        'Draft a prep brief for one target',
        'One target, one vehicle. Read-only. No outbound anything.',
        ['research.claim', 'research.source_doc', 'meetings.objection'],
        ['research.read', 'meetings.read'],
        JSON.stringify({ tokens: 40_000, seconds: 120 }),
        null,
        'PrepBrief',
        [
          'Every stated fact carries source, as-of, confidence and verifier',
          'Anything without a complete tuple is listed as refused rather than omitted',
          'No rung is claimed beyond the evidence on file',
        ],
        u('juan'), u('juan'),
      ],
    );
    const envelopeId = env[0]!.envelope_id;

    // A run that refused, because there is no agent runtime. This is the honest state.
    const run = await tx.query<{ run_id: string }>(
      `insert into agents.run
         (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash,
          agent_kind, rationale, finished_at)
       values ($1, 'unavailable', 'seed-config', '{}'::jsonb, 'seed-input', 'seed-prompt',
               'stub', $2, now() - interval '2 hours')
       returning run_id`,
      [
        envelopeId,
        'No ANTHROPIC_API_KEY is set, so the task was not run. Nothing was drafted and nothing ' +
        'was inferred.',
      ],
    );
    // Including the refused call, because a log of only what was permitted answers nothing.
    await tx.query(
      `insert into agents.tool_call (run_id, tool, allowed, refusal) values
         ($1, 'research.read', true, null),
         ($1, 'content.send', false, $2)`,
      [run[0]!.run_id, '"content.send" is not in this run\'s envelope. Allowed: research.read, meetings.read.'],
    );

    for (const c of cases) {
      await tx.query(
        `insert into agents.eval_case (name, input, expectation, from_failure) values ($1,$2,$3,$4)`,
        [c.name, JSON.stringify(c.input), c.expectation, c.from],
      );
    }

    await tx.query(
      `insert into agents.correction (minutes, recorded_by, note) values
         (95, $1, 'Rewrote a drafted brief that leaned on an unverified CSV figure.'),
         (140, $2, 'Re-checked route reasoning against the evidence tiers by hand.')`,
      [u('mara'), u('juan')],
    );

    const funders: Array<{ entity: string; programme: string; cycle: string; status: string; fit: string; invitation?: string; on?: string; by?: string }> = [
      {
        entity: 'Halvorsen Institute', programme: 'Neurodegeneration translational awards',
        cycle: 'Rolling', status: 'sourced',
        fit: 'Strong thematic fit. No invitation, so no outreach — the rail refuses it.',
      },
      {
        entity: 'Roos Foundation', programme: 'Recoverable grants — neuro',
        cycle: 'Rolling', status: 'sourced',
        fit: 'Their instrument mix fits a PRI. Still sourced only.',
      },
      {
        entity: 'Orsini Foundation', programme: 'Open science infrastructure',
        cycle: 'Annual, closes 31 Jan', status: 'invited',
        fit: 'Programme officer asked us to submit after the September briefing.',
        invitation: 'email:orsini-2026-09-05', on: '2026-09-05', by: 'A. Feld, programme officer',
      },
    ];
    for (const f of funders) {
      await tx.query(
        `insert into grants.funder (entity_id, programme, cycle, status, invitation_ref,
                                    invited_on, invited_by, fit_note, owner_id)
         values ($1,$2,$3,$4::grants.funder_status,$5,$6::date,$7,$8,$9)`,
        [e(f.entity), f.programme, f.cycle, f.status, f.invitation ?? null,
         f.on ?? null, f.by ?? null, f.fit, u('ines')],
      );
    }
  });

  return { envelopes: 1, evalCases: cases.length, funders: 3 };
}
