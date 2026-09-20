import type { Db } from './db';

/**
 * Compliance seed. Four of five vehicles are 506(c), which makes verification an
 * obligation rather than a formality — and one of the seeded records is complete, signed
 * and still insufficient, because self-certification is not reasonable steps.
 */
export async function seedCompliance(db: Db): Promise<{ accreditation: number; claims: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from compliance.accreditation');
  if (existing && Number(existing.n) > 0) return { accreditation: 0, claims: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const assets = await db.query<{ asset_id: string; title: string }>(
    'select asset_id, title from content.asset',
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const a = (t: string) => assets.find((x) => x.title === t)?.asset_id ?? null;

  const records: Array<{
    entity: string; vehicle: string; method: string; status: string;
    ref?: string; by?: string; on?: string; expires?: string; note?: string;
  }> = [
    { entity: 'Brenner Endowment', vehicle: 'neurotech', method: 'third_party_letter', status: 'verified', ref: 'doc:brenner-accred-2026', by: 'tomas', on: '2026-06-24', expires: '2027-06-24' },
    { entity: 'Vantage Partners', vehicle: 'neurotech', method: 'registered_professional', status: 'verified', ref: 'doc:vantage-cpa-letter', by: 'tomas', on: '2026-07-02', expires: '2027-07-02' },
    { entity: 'Kaplan Family Trust', vehicle: 'neurotech', method: 'net_worth', status: 'verified', ref: 'doc:kaplan-nw-2026', by: 'tomas', on: '2026-07-16', expires: '2027-07-16' },
    { entity: 'Orsini Foundation', vehicle: 'neurotech', method: 'third_party_letter', status: 'verified', ref: 'doc:orsini-accred', by: 'tomas', on: '2026-08-05', expires: '2027-08-05' },
    { entity: 'Cedar Trust', vehicle: 'neurotech', method: 'third_party_letter', status: 'verified', ref: 'doc:cedar-counsel-letter', by: 'tomas', on: '2026-09-15', expires: '2027-09-15',
      note: 'Completed before the subscription pack went out, which is why the MONEY ticket can be approved at all.' },
    { entity: 'Whitcomb Capital', vehicle: 'neurotech', method: 'self_certified', status: 'verified', ref: 'form:whitcomb-self-cert', by: 'sam', on: '2026-08-14',
      note: 'Signed by the principal on the day the SPV allocation was confirmed.' },
    { entity: 'Northwood Capital', vehicle: 'neurotech', method: 'third_party_letter', status: 'requested', note: 'Requested with the DDQ pack. Nothing back yet.' },
    { entity: 'Orsini Foundation', vehicle: 'spv-halo', method: 'self_certified', status: 'verified', ref: 'form:orsini-halo-cert', by: 'sam', on: '2026-09-01',
      note: 'Halo is 506(b). Self-certification plus a reasonable belief is the standard there, and it is met.' },
  ];

  const claims: Array<{ statement: string; channel: string; asset?: string; vehicle?: string; used: string; sub: string; ref?: string; by?: string; on?: string; status?: string }> = [
    {
      statement: 'A team that has built and operated three prior vehicles in this field.',
      channel: 'deck', asset: 'Neurotech primer v4', vehicle: 'neurotech', used: '2026-06-10',
      sub: 'Audited marks and entity registrations for all three, held by counsel.',
      ref: 'doc:track-record-2026', by: 'tomas', on: '2026-06-08',
    },
    {
      statement: 'Focused exclusively on neurodegeneration and longevity biology.',
      channel: 'website', vehicle: 'neurotech', used: '2026-05-02',
      sub: 'Investment policy statement, section 2. Matches every deployment to date.',
      ref: 'doc:ips-v2', by: 'tomas', on: '2026-05-01',
    },
    {
      statement: 'Backed by a $60M first close.',
      channel: 'email', vehicle: 'neurotech', used: '2026-09-19',
      sub: 'NOT YET TRUE. Hard is $56.0M until the Cedar MONEY ticket is approved.',
      by: 'tomas', on: '2026-09-19', status: 'needs_review',
    },
    {
      statement: 'Our science advisers include two principal investigators in the field.',
      channel: 'conference', vehicle: 'neurotech', used: '2026-08-14',
      sub: 'Signed adviser agreements for both, with consent to be named.',
      ref: 'doc:adviser-agreements', by: 'tomas', on: '2026-08-12',
    },
  ];

  await db.transaction(async (tx) => {
    for (const r of records) {
      await tx.query(
        `insert into compliance.accreditation
           (entity_id, vehicle_id, method, status, evidence_ref, verified_by, verified_on, expires_on, note)
         values ($1,$2,$3::compliance.verification_method,$4::compliance.verification_status,
                 $5,$6,$7::date,$8::date,$9)`,
        [e(r.entity), v(r.vehicle), r.method, r.status, r.ref ?? null,
         r.by ? u(r.by) : null, r.on ?? null, r.expires ?? null, r.note ?? null],
      );
    }

    for (const c of claims) {
      await tx.query(
        `insert into compliance.public_claim
           (statement, channel, asset_id, vehicle_id, first_used_on, substantiation,
            substantiation_ref, reviewed_by, reviewed_on, status)
         values ($1,$2::compliance.channel,$3,$4,$5::date,$6,$7,$8,$9::date,
                 $10::compliance.claim_status)`,
        [c.statement, c.channel, c.asset ? a(c.asset) : null, c.vehicle ? v(c.vehicle) : null,
         c.used, c.sub, c.ref ?? null, c.by ? u(c.by) : null, c.on ?? null, c.status ?? 'in_use'],
      );
    }

    const solicitations: Array<{ vehicle: string; channel: string; audience: string; on: string; asset?: string; by: string; note?: string }> = [
      { vehicle: 'neurotech', channel: 'website', audience: 'Anyone visiting the public site.', on: '2026-05-02', asset: 'Neurotech primer v4', by: 'mara',
        note: 'General solicitation, permitted under 506(c) and the reason every subscriber must be verified.' },
      { vehicle: 'neurotech', channel: 'conference', audience: 'Roughly 300 attendees at a neuro research conference.', on: '2026-08-14', asset: 'Neuro seminar outline', by: 'ines',
        note: 'The vehicle was named once in the biography slide.' },
      { vehicle: 'neurotech', channel: 'podcast', audience: 'Public podcast audience, unknown size.', on: '2026-07-21', by: 'juan',
        note: 'Thesis only. No terms, no returns, no vehicle name.' },
    ];
    for (const s of solicitations) {
      await tx.query(
        `insert into compliance.solicitation (vehicle_id, channel, audience, occurred_on, asset_id, recorded_by, note)
         values ($1,$2::compliance.channel,$3,$4::date,$5,$6,$7)`,
        [v(s.vehicle), s.channel, s.audience, s.on, s.asset ? a(s.asset) : null, u(s.by), s.note ?? null],
      );
    }

    const letters: Array<{ entity: string; vehicle: string; provision: string; mfn: boolean; risk: string; on: string; by: string }> = [
      { entity: 'Vantage Partners', vehicle: 'neurotech', provision: 'Most-favoured-nation on fees and reporting.', mfn: true,
        risk: 'Every later side letter has to be read against this one. A fee break granted to anyone smaller flows through.',
        on: '2026-07-08', by: 'tomas' },
      { entity: 'Brenner Endowment', vehicle: 'neurotech', provision: 'Quarterly reporting with portfolio-level detail.', mfn: false,
        risk: 'Operational load rather than economic. Falls under the Vantage MFN for reporting.',
        on: '2026-06-30', by: 'tomas' },
      { entity: 'Cedar Trust', vehicle: 'neurotech', provision: 'Fee break at $4M and above.', mfn: false,
        risk: 'Triggers the Vantage MFN. Vantage is entitled to the same break and has not been told.',
        on: '2026-09-18', by: 'tomas' },
    ];
    for (const l of letters) {
      await tx.query(
        `insert into compliance.side_letter (entity_id, vehicle_id, provision, mfn, risk, signed_on, reviewed_by)
         values ($1,$2,$3,$4,$5,$6::date,$7)`,
        [e(l.entity), v(l.vehicle), l.provision, l.mfn, l.risk, l.on, u(l.by)],
      );
    }
  });

  return { accreditation: records.length, claims: claims.length };
}
