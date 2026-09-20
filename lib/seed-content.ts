import type { Db } from './db';

/**
 * L12 seed: one canonical asset with five audience variants, the wrap matrix, and a
 * refused send.
 *
 * The refused send is the point. The public primer is genuinely approved and genuinely
 * good; sending it on behalf of the 506(b) SPV would be general solicitation, and the
 * matrix refuses it before a ticket is ever opened.
 */
export async function seedContent(db: Db): Promise<{ assets: number; wrapRules: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from content.asset');
  if (existing && Number(existing.n) > 0) return { assets: 0, wrapRules: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const claims = await db.query<{ claim_id: string; field: string }>(
    `select c.claim_id, c.field from research.claim c
       join identity.entity e on e.entity_id = c.entity_id
      where e.display_name in ('Roos Foundation', 'Delia Roos')`,
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;

  const rules: Array<{
    exemption: string; instrument: string; audiences: string[]; maxUse: string; note: string;
  }> = [
    {
      exemption: '506(c)', instrument: 'lp_commitment',
      audiences: ['lp_memo', 'public_primer', 'ddq_response', 'seminar_outline', 'social_post', 'video_script'],
      maxUse: 'public',
      note: 'A 506(c) vehicle may advertise, provided every subscriber is verified as accredited.',
    },
    {
      exemption: '506(b)', instrument: 'spv',
      audiences: ['lp_memo', 'ddq_response'],
      maxUse: 'accredited_only',
      note: 'No general solicitation. A public primer used for a 506(b) vehicle can break the exemption for the whole raise.',
    },
    {
      exemption: '506(c)', instrument: 'spv',
      audiences: ['lp_memo', 'ddq_response', 'public_primer'],
      maxUse: 'public',
      note: 'Same advertising latitude as the fund, same verification obligation.',
    },
    {
      exemption: 'n/a', instrument: 'grant',
      audiences: ['grant_framing', 'seminar_outline'],
      maxUse: 'accredited_only',
      note: 'The grants rail is not an investment offering and must never be framed as one.',
    },
    {
      exemption: 'n/a', instrument: 'pri',
      audiences: ['grant_framing', 'lp_memo'],
      maxUse: 'accredited_only',
      note: 'A programme-related investment is a grant instrument with a return, and is described as such.',
    },
    {
      exemption: '506(c)', instrument: 'pri',
      audiences: ['lp_memo', 'grant_framing'],
      maxUse: 'accredited_only',
      note: 'A PRI into a 506(c) fund is still a private placement to that investor.',
    },
  ];

  await db.transaction(async (tx) => {
    for (const r of rules) {
      await tx.query(
        `insert into content.wrap_rule (exemption, instrument, allowed_audiences, max_permitted_use, note)
         values ($1,$2::pipeline.instrument,$3::content.audience[],$4::content.permitted_use,$5)`,
        // PGlite needs the Postgres array literal for an enum[] parameter.
        [r.exemption, r.instrument, `{${r.audiences.join(',')}}`, r.maxUse, r.note],
      );
    }

    const canonical = await tx.query<{ asset_id: string }>(
      `insert into content.asset (title, parent_id, audience, vehicle_id, version, owner_id,
                                  permitted_use, summary, body, status, approved_at)
       values ('Neurotech thesis — canonical', null, null, $1, 4, $2, 'internal',
               'The source of truth for every Neurotech claim. Nothing is sent from here.',
               $3, 'approved', now() - interval '12 days')
       returning asset_id`,
      [
        v('neurotech'), u('juan'),
        'Four claims carry this document: the neurodegeneration mandate concentration, the ' +
        'instrument mix, the $2–5M band for new relationships, and the co-funder condition. ' +
        'Each variant below inherits from here, and changing a claim marks every one of them ' +
        'for refresh.',
      ],
    );
    const canonicalId = canonical[0]!.asset_id;

    for (const c of claims) {
      await tx.query('insert into content.claim_ref (asset_id, claim_id) values ($1,$2)', [canonicalId, c.claim_id]);
    }

    const variants: Array<{
      title: string; audience: string; use: string; status: string; summary: string; body: string; owner: string;
    }> = [
      {
        title: 'Neurotech primer v4', audience: 'public_primer', use: 'public', status: 'approved', owner: 'mara',
        summary: 'The one that goes out first. Public because 506(c) allows it.',
        body: 'Eight pages. Thesis, team, why now, and what we will not claim. No returns, no forward-looking numbers.',
      },
      {
        title: 'Neurotech LP memo', audience: 'lp_memo', use: 'accredited_only', status: 'approved', owner: 'juan',
        summary: 'Terms, structure and track record. Accredited only regardless of the vehicle.',
        body: 'Twenty-two pages with the LPA summary, fee schedule and the operating-company marks.',
      },
      {
        title: 'PRI structure note', audience: 'grant_framing', use: 'accredited_only', status: 'approved', owner: 'tomas',
        summary: 'For foundations. Describes the instrument as a grant with a return, never as a fund position.',
        body: 'Four pages on §4944(c) treatment, recoverability and reporting.',
      },
      {
        title: 'Neuro seminar outline', audience: 'seminar_outline', use: 'public', status: 'approved', owner: 'ines',
        summary: 'For the conference circuit. No vehicle is named.',
        body: 'Forty-minute talk on the science. The fund appears in one line of the biography.',
      },
      {
        title: 'Neurotech primer v5 draft', audience: 'public_primer', use: 'public', status: 'draft', owner: 'mara',
        summary: 'Rewrite after the Cedar close. Not approved, therefore not sendable.',
        body: 'Adds the first-close anchor language. Needs counsel on the performance wording.',
      },
    ];

    for (const va of variants) {
      const rows = await tx.query<{ asset_id: string }>(
        `insert into content.asset (title, parent_id, audience, vehicle_id, version, owner_id,
                                    permitted_use, summary, body, status, approved_at)
         values ($1,$2,$3::content.audience,$4,1,$5,$6::content.permitted_use,$7,$8,
                 $9::content.asset_status,$10)
         returning asset_id`,
        [va.title, canonicalId, va.audience, v('neurotech'), u(va.owner), va.use,
         va.summary, va.body, va.status,
         va.status === 'approved' ? new Date(Date.now() - 9 * 86400_000) : null],
      );
      for (const c of claims.slice(0, 2)) {
        await tx.query('insert into content.claim_ref (asset_id, claim_id) values ($1,$2)', [rows[0]!.asset_id, c.claim_id]);
      }
    }

    // A refusal already on the record, so "wrong-wrap sends = 0" has something to measure.
    const primer = await tx.one<{ asset_id: string }>(
      "select asset_id from content.asset where title = 'Neurotech primer v4'",
    );
    await tx.query(
      `insert into content.send (asset_id, entity_id, vehicle_id, instrument, status, requested_by, refusal)
       values ($1,$2,$3,'spv','refused',$4,$5)`,
      [
        primer!.asset_id, e('Orsini Foundation'), v('spv-halo'), u('sam'),
        'public_primer is not an allowed audience for 506(b) × spv. No general solicitation. ' +
        'A public primer used for a 506(b) vehicle can break the exemption for the whole raise.',
      ],
    );
  });

  return { assets: 6, wrapRules: rules.length };
}
