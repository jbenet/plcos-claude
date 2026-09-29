import type { Db } from './db';

/**
 * L6 seed: a mid-raise balance sheet with two things deliberately wrong.
 *
 *  - Fernhollow Umberfield Trust's $4.0M sits on the SOFT track with an open MONEY ticket against it.
 *    Approving that ticket is what moves it, and the headline moves with it. Nothing else
 *    in the system can.
 *  - Two actors are over their conserved budget. The forecast says so in arithmetic rather
 *    than in a warning banner.
 */
export async function seedPipeline(db: Db): Promise<{ exposures: number; pools: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from pipeline.exposure');
  if (existing && Number(existing.n) > 0) return { exposures: 0, pools: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const on = (iso: string) => new Date(`${iso}T10:00:00Z`);

  interface Row {
    entity: string; vehicle: string; instrument: string; track: 'soft' | 'hard';
    amount: number; probability?: number; owner: string; evidence?: string;
    hardened?: string; cash?: string;
  }

  const rows: Row[] = [
    // PLC Neurotech I — hard, $56.0M countersigned
    { entity: 'Valdivieso Endowment',  vehicle: 'neurotech', instrument: 'lp_commitment', track: 'hard', amount: 18_000_000, owner: 'juan', evidence: 'sub-doc:valdivieso-v2', hardened: '2026-06-30', cash: '2026-07-14' },
    { entity: 'Greylag Gorsebrook Partners',   vehicle: 'neurotech', instrument: 'lp_commitment', track: 'hard', amount: 15_000_000, owner: 'juan', evidence: 'sub-doc:greylag-gorsebrook-nt', hardened: '2026-07-08', cash: '2026-07-29' },
    { entity: 'Jaramillo Family Trust',vehicle: 'neurotech', instrument: 'lp_commitment', track: 'hard', amount: 12_500_000, owner: 'mara', evidence: 'sub-doc:jaramillo-nt', hardened: '2026-07-22', cash: '2026-08-05' },
    { entity: 'Mbatha Foundation',  vehicle: 'neurotech', instrument: 'lp_commitment', track: 'hard', amount: 10_500_000, owner: 'mara', evidence: 'sub-doc:mbatha', hardened: '2026-08-11', cash: '2026-08-26' },

    // PLC Neurotech I — soft. Fernhollow Umberfield is the one with a ticket waiting.
    { entity: 'Fernhollow Umberfield Trust',           vehicle: 'neurotech', instrument: 'lp_commitment', track: 'soft', amount: 4_000_000, probability: 0.9,  owner: 'mara' },
    { entity: 'Vetchling Wagtail Capital',     vehicle: 'neurotech', instrument: 'lp_commitment', track: 'soft', amount: 6_000_000, probability: 0.6,  owner: 'juan' },
    { entity: 'Albescu Capital',      vehicle: 'neurotech', instrument: 'lp_commitment', track: 'soft', amount: 5_000_000, probability: 0.85, owner: 'juan' },
    { entity: 'Quaresma Foundation',       vehicle: 'neurotech', instrument: 'pri',           track: 'soft', amount: 4_000_000, probability: 0.5,  owner: 'juan' },
    { entity: 'Kowalczyk Family Office',  vehicle: 'neurotech', instrument: 'lp_commitment', track: 'soft', amount: 3_500_000, probability: 0.4,  owner: 'juan' },

    // PLC Crypto/Rails
    { entity: 'Greylag Gorsebrook Partners',    vehicle: 'rails', instrument: 'lp_commitment', track: 'hard', amount: 12_000_000, owner: 'juan', evidence: 'sub-doc:greylag-gorsebrook-rails', hardened: '2026-05-19', cash: '2026-06-02' },
    { entity: 'Valdivieso Endowment',   vehicle: 'rails', instrument: 'lp_commitment', track: 'hard', amount: 10_000_000, owner: 'juan', evidence: 'sub-doc:valdivieso-rails', hardened: '2026-06-03', cash: '2026-06-20' },
    { entity: 'Jaramillo Family Trust', vehicle: 'rails', instrument: 'lp_commitment', track: 'hard', amount: 8_000_000,  owner: 'mara', evidence: 'sub-doc:jaramillo-rails', hardened: '2026-06-17', cash: '2026-07-01' },
    { entity: 'Solveig Quaresma',          vehicle: 'rails', instrument: 'lp_commitment', track: 'soft', amount: 2_000_000, probability: 0.2, owner: 'mara' },

    // SPVs
    { entity: 'Albescu Capital',     vehicle: 'spv-cortex',  instrument: 'spv', track: 'hard', amount: 2_500_000, owner: 'juan', evidence: 'spv-sub:cortex-albescu', hardened: '2026-09-02', cash: '2026-09-09' },
    { entity: 'Kowalczyk Family Office', vehicle: 'spv-cortex',  instrument: 'spv', track: 'soft', amount: 3_000_000, probability: 0.5, owner: 'juan' },
    { entity: 'Renata Corcoran',           vehicle: 'spv-lattice', instrument: 'spv', track: 'soft', amount: 2_000_000, probability: 0.3, owner: 'juan' },
    { entity: 'Mbatha Foundation',    vehicle: 'spv-halo',    instrument: 'spv', track: 'hard', amount: 1_000_000, owner: 'mara', evidence: 'spv-sub:halo-mbatha', hardened: '2026-09-12' },
  ];

  const pools: Array<{ entity: string; budget: number; source: string; as_of: string; verified: string | null; note?: string }> = [
    { entity: 'Greylag Gorsebrook Partners',    budget: 25_000_000, source: 'Stated by their CIO on 12 May 2026', as_of: '2026-05-12', verified: 'juan' },
    { entity: 'Valdivieso Endowment',   budget: 30_000_000, source: 'Allocation letter, March 2026', as_of: '2026-03-01', verified: 'mara' },
    { entity: 'Jaramillo Family Trust', budget: 25_000_000, source: 'Stated in the first meeting', as_of: '2026-04-02', verified: 'mara' },
    { entity: 'Albescu Capital',    budget: 8_000_000,  source: 'Stated by Albescu, unconfirmed since', as_of: '2026-08-01', verified: 'juan' },
    { entity: 'Kowalczyk Family Office',budget: 5_000_000,  source: 'Inferred from their last three commitments', as_of: '2026-07-15', verified: 'juan' },
    { entity: 'Quaresma Foundation',     budget: 5_000_000,  source: 'Forwarded letter excerpt S03 — an excerpt, not a statement to us', as_of: '2026-08-30', verified: null,
      note: 'Unverified, so it is excluded from the conserved-pool check rather than guessed at.' },
  ];

  let exposures = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.query(
        `insert into pipeline.exposure
           (entity_id, vehicle_id, instrument, track, amount, probability, owner_id,
            evidence_ref, hardened_at, cash_received_at, opened_at)
         values ($1,$2,$3::pipeline.instrument,$4::pipeline.track,$5,$6,$7,$8,$9,$10,$11)`,
        [e(r.entity), v(r.vehicle), r.instrument, r.track, r.amount, r.probability ?? null,
         u(r.owner), r.evidence ?? null, r.hardened ? on(r.hardened) : null,
         r.cash ? on(r.cash) : null, r.hardened ? on(r.hardened) : on('2026-08-01')],
      );
      exposures += 1;
    }

    for (const p of pools) {
      await tx.query(
        `insert into pipeline.capital_pool (entity_id, budget, source, as_of, verified_by, note)
         values ($1,$2,$3,$4::date,$5,$6)`,
        [e(p.entity), p.budget, p.source, p.as_of, p.verified ? u(p.verified) : null, p.note ?? null],
      );
    }

    // The MONEY ticket points at the real Fernhollow Umberfield exposure, and its scope carries the
    // bounded action as data. Approving it is the only thing that moves the headline.
    const fernhollowUmberfield = await tx.one<{ exposure_id: string }>(
      `select x.exposure_id from pipeline.exposure x
         join identity.entity e on e.entity_id = x.entity_id
         join platform.vehicle v on v.id = x.vehicle_id
        where e.display_name = 'Fernhollow Umberfield Trust' and v.slug = 'neurotech'`,
    );
    if (fernhollowUmberfield) {
      await tx.query(
        `insert into governance.approval_ticket
           (kind, subject_type, subject_id, subject_label, scope, vehicle_id, requested_by,
            expires_at, created_at)
         values ('MONEY', 'exposure', $1, 'Record $4.0M hard — Fernhollow Umberfield Trust', $2, $3, $4,
                 now() + interval '5 days', now() - interval '2 days')`,
        [
          fernhollowUmberfield.exposure_id,
          JSON.stringify({
            authorizes:
              "Moving Fernhollow Umberfield Trust's $4.0M on PLC Neurotech I from the soft track to the hard " +
              'track, on the subscription document countersigned 18 September.',
            excludes: [
              'Recognising cash — the wire has not landed',
              'Any announcement',
              'Any change to another vehicle',
            ],
            basis: [
              { label: 'Countersigned', value: '18 Sep 2026' },
              { label: 'Moves', value: 'soft → hard' },
              { label: 'Cash received', value: 'No — a separate state' },
              { label: 'Headline moves', value: '$56.0M → $60.0M hard' },
            ],
            apply: {
              command: 'pipeline.harden',
              args: { exposureId: fernhollowUmberfield.exposure_id, evidenceRef: 'sub-doc:fernhollow-umberfield-v3' },
            },
          }),
          v('neurotech'), u('sam'),
        ],
      );
    }
  });

  return { exposures, pools: pools.length };
}
