import type { Db } from './db';

/**
 * L8 seed: one fund close on a long clock, three SPVs on short ones.
 *
 * The numbers are chosen so the two rooms disagree about what is urgent — which is the
 * condition the bandwidth-steal alert exists to name.
 */
export async function seedClose(db: Db): Promise<{ conditions: number; seats: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from close.cycle');
  if (existing && Number(existing.n) > 0) return { conditions: 0, seats: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const on = (iso: string) => new Date(`${iso}T10:00:00Z`);

  let conditions = 0;
  let seats = 0;

  await db.transaction(async (tx) => {
    const cycle = await tx.query<{ cycle_id: string }>(
      `insert into close.cycle (vehicle_id, label, target_date, target_amount)
       values ($1, 'First close', '2026-12-19'::date, 90000000) returning cycle_id`,
      [v('neurotech')],
    );
    const cycleId = cycle[0]!.cycle_id;

    const conds: Array<{
      label: string; detail: string; owner: string; due: string | null;
      status: string; entity?: string; evidence?: string; compliance?: boolean;
    }> = [
      {
        label: 'Accredited-investor verification for every subscriber',
        detail:
          'Every vehicle here except SPV — Halo is 506(c), which means verification is an obligation ' +
          'and not a checkbox. One 506(b) among four 506(c) vehicles is open question 4.',
        owner: 'sam', due: '2026-12-05', status: 'open', compliance: true,
      },
      {
        label: 'Counsel position on §4944(c) for PRI subscriptions',
        detail: 'The Roos Foundation route is a PRI. The only note on file is from March 2024 and is stale.',
        owner: 'tomas', due: '2026-11-20', status: 'open', compliance: true,
      },
      {
        label: 'Side-letter review — Vantage MFN',
        detail: 'Most-favoured-nation clause. Every later side letter has to be read against it.',
        owner: 'tomas', due: '2026-11-01', status: 'open',
      },
      {
        label: 'Administrator onboarding — Cedar Trust',
        detail: 'Cannot accept the wire until the administrator has them set up.',
        owner: 'sam', due: '2026-10-15', status: 'open', entity: 'Cedar Trust',
      },
      {
        label: 'Audit engagement letter signed',
        detail: 'Signed in July.',
        owner: 'sam', due: '2026-07-31', status: 'satisfied', evidence: 'doc:audit-engagement-2026',
      },
      {
        label: 'Solicitation record for the public primer',
        detail:
          'A 506(c) vehicle may advertise; what it may not do is lose the record of what was said ' +
          'to whom. This lands properly with module 24.',
        owner: 'mara', due: '2026-09-15', status: 'open', compliance: true,
      },
    ];

    for (const c of conds) {
      await tx.query(
        `insert into close.condition
           (cycle_id, entity_id, label, detail, owner_id, due_on, status, evidence_ref, compliance)
         values ($1,$2,$3,$4,$5,$6::date,$7::close.condition_status,$8,$9)`,
        [cycleId, c.entity ? e(c.entity) : null, c.label, c.detail, u(c.owner), c.due,
         c.status, c.evidence ?? null, c.compliance ?? false],
      );
      conditions += 1;
    }

    const pack: Array<{ entity: string; status: string; sent?: string; returned?: string; signed?: string; note?: string }> = [
      { entity: 'Brenner Endowment', status: 'countersigned', sent: '2026-06-12', returned: '2026-06-25', signed: '2026-06-30' },
      { entity: 'Vantage Partners', status: 'countersigned', sent: '2026-06-20', returned: '2026-07-02', signed: '2026-07-08', note: 'MFN side letter attached.' },
      { entity: 'Kaplan Family Trust', status: 'countersigned', sent: '2026-07-06', returned: '2026-07-18', signed: '2026-07-22' },
      { entity: 'Orsini Foundation', status: 'countersigned', sent: '2026-07-24', returned: '2026-08-06', signed: '2026-08-11' },
      { entity: 'Cedar Trust', status: 'returned', sent: '2026-09-04', returned: '2026-09-16', note: 'Countersignature pending the administrator onboarding condition.' },
      { entity: 'Whitcomb Capital', status: 'not_sent', note: 'Still on the soft track. Nothing is sent before there is something to sign.' },
      { entity: 'Northwood Capital', status: 'not_sent', note: 'DDQ pack requested; the subscription pack is a later document.' },
    ];

    for (const p of pack) {
      await tx.query(
        `insert into close.pack_item
           (cycle_id, entity_id, document, status, sent_at, returned_at, countersigned_at, note)
         values ($1,$2,'Subscription agreement',$3::close.pack_status,$4,$5,$6,$7)`,
        [cycleId, e(p.entity), p.status, p.sent ? on(p.sent) : null,
         p.returned ? on(p.returned) : null, p.signed ? on(p.signed) : null, p.note ?? null],
      );
    }

    const spv: Array<{
      vehicle: string; entity: string; stage: string; amount: number | null; owner: string;
      invited: string; ioi?: string; allocated?: string; wired?: string; note?: string;
    }> = [
      { vehicle: 'spv-cortex', entity: 'Whitcomb Capital', stage: 'wired', amount: 2_500_000, owner: 'juan',
        invited: '2026-08-10', ioi: '2026-08-14', allocated: '2026-08-20', wired: '2026-09-09' },
      { vehicle: 'spv-cortex', entity: 'Okonjo Family Office', stage: 'ioi', amount: 3_000_000, owner: 'juan',
        invited: '2026-08-28', ioi: '2026-09-05', note: 'Also in the Neurotech pipeline. One budget.' },
      { vehicle: 'spv-cortex', entity: 'Kaplan Family Trust', stage: 'allocated', amount: 1_500_000, owner: 'mara',
        invited: '2026-08-25', ioi: '2026-09-01', allocated: '2026-09-15' },
      { vehicle: 'spv-cortex', entity: 'Orsini Foundation', stage: 'passed', amount: null, owner: 'mara',
        invited: '2026-08-26', note: 'Passed — outside their neuro remit.' },
      { vehicle: 'spv-lattice', entity: 'Anne Quill', stage: 'ioi', amount: 2_000_000, owner: 'juan',
        invited: '2026-09-10', ioi: '2026-09-12', note: 'Asked us to come back in November.' },
      { vehicle: 'spv-lattice', entity: 'Northwood Capital', stage: 'invited', amount: null, owner: 'juan',
        invited: '2026-09-14' },
      { vehicle: 'spv-halo', entity: 'Orsini Foundation', stage: 'wired', amount: 1_000_000, owner: 'mara',
        invited: '2026-08-20', ioi: '2026-08-25', allocated: '2026-09-01', wired: '2026-09-12' },
    ];

    for (const s of spv) {
      await tx.query(
        `insert into close.spv_seat
           (vehicle_id, entity_id, stage, amount, owner_id, invited_at, ioi_at, allocated_at, wired_at, note)
         values ($1,$2,$3::close.spv_stage,$4,$5,$6,$7,$8,$9,$10)`,
        [v(s.vehicle), e(s.entity), s.stage, s.amount, u(s.owner), on(s.invited),
         s.ioi ? on(s.ioi) : null, s.allocated ? on(s.allocated) : null,
         s.wired ? on(s.wired) : null, s.note ?? null],
      );
      seats += 1;
    }
  });

  return { conditions, seats };
}
