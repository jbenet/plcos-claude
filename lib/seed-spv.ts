import type { Db } from './db';
import { deriveSpvStance, recordResearchSpv, setSpvStance } from '@/modules/strategy';

/**
 * Demo seed for the SPV stance (Juan, 27 Sep 2026): invented LPs on SPV — Cortex covering every state
 * — research facts, a person's setting over contrary research, research text in a claim and in a
 * profile, our own SPV commitments, a conflict inside the derived signals, and nothing at all.
 * Fictional names and invented example.org pages. No Dakota rows: the Dakota properties expect an
 * empty replica, so Dakota's flag is exercised by scripts/properties/spv-stance.ts instead.
 */
export async function seedSpv(db: Db): Promise<{ spvLps: number }> {
  const existing = await db.one<{ n: string }>(`select count(*)::text n from strategy.spv_setting`);
  if (Number(existing?.n ?? 0) > 0) return { spvLps: 0 };
  const users = await db.query<{ id: string; handle: string }>('select id::text, handle from platform.app_user');
  const user = (h: string) => users.find((u) => u.handle === h)?.id ?? users[0]!.id;
  const vehicles = await db.query<{ id: string; slug: string }>('select id::text, slug from platform.vehicle');
  const v = (slug: string) => vehicles.find((x) => x.slug === slug)!.id;

  const org = async (name: string) => (await db.one<{ id: string }>(
    `insert into identity.entity (entity_type, display_name) values ('org', $1) returning entity_id::text id`, [name]))!.id;
  const pursue = (entity: string, vehicle: string, status: string, owner: string, headline: string) => db.query(
    `insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, status_source, status_set_at, status_set_by, headline)
     values ($1,$2,$3,$4::strategy.pursuit_status,'us',now() - interval '3 days',$3,$5)`, [entity, v(vehicle), user(owner), status, headline]);
  const fact = async (entity: string, field: 'spv_appetite' | 'spv_deals', value: string, quote: string, url: string, asOf: string, confidence: 'high' | 'medium' | 'low') => {
    const doc = `pub:demo-spv-${Buffer.from(url).toString('hex').slice(-16)}`;
    await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
      values ($1,$2,'public:press',$3,$4,'moderate','An invented demo page. It supports what it says, and nothing it doesn''t.',$5) on conflict (doc_id) do nothing`,
      [doc, `Invented page (${new URL(url).hostname})`, url, asOf, quote]);
    const claim = await db.one<{ id: string }>(`insert into research.claim (entity_id, field, value, source, as_of, confidence)
      values ($1,$2,$3,$4,$5,$6::research.confidence) returning claim_id::text id`, [entity, `public.${field}`, value, doc, asOf, confidence]);
    await recordResearchSpv(db, claim!.id, entity, { field, value, quote, confidence, source: { url } }, doc, asOf);
  };

  // 1. Research: does, with a count.
  const halvorsen = await org('Halvorsen Family Office');
  await pursue(halvorsen, 'spv-cortex', 'sourcing', 'juan', 'A single-family office that syndicates deep-tech deals to its network.');
  await fact(halvorsen, 'spv_appetite', 'does', 'We regularly co-invest through single-deal SPVs alongside lead managers.', 'https://example.org/halvorsen/approach', '2026-06-14', 'high');
  await fact(halvorsen, 'spv_deals', '6', 'Six co-investment SPVs since 2022, including two neurotech rounds.', 'https://example.org/halvorsen/portfolio', '2026-06-14', 'medium');

  // 2. Research: doesn't. Dimmed on the SPV's selection, flagged before a move.
  const tamsin = await org('Tamsin Ridge Endowment');
  await pursue(tamsin, 'spv-cortex', 'sourcing', 'mara', 'A university endowment with a venture allocation.');
  await pursue(tamsin, 'neurotech', 'sourcing', 'mara', 'A university endowment with a venture allocation.');
  await fact(tamsin, 'spv_appetite', 'does-not', 'The endowment invests only through commingled funds and does not participate in SPVs.', 'https://example.org/tamsin/policy', '2026-03-02', 'high');

  // 3. A person's setting over contrary research: the setting wins, the conflict shows.
  const brightwater = await org('Brightwater Partners');
  await pursue(brightwater, 'spv-cortex', 'new', 'sam', 'A multi-family office; research says it co-invests.');
  await fact(brightwater, 'spv_appetite', 'does', 'Brightwater offers clients co-investment opportunities alongside its fund commitments.', 'https://example.org/brightwater/services', '2025-11-20', 'medium');
  await setSpvStance(db, brightwater, user('juan'), { stance: 'does-not', note: 'Their CIO told us on a call: no single-deal SPVs this year.' });

  // 4. A person's setting: does, with a count.
  const sable = await org('Sable Crest Ventures');
  await pursue(sable, 'spv-cortex', 'sourcing', 'tomas', 'A venture firm whose partners back SPVs personally and through the firm.');
  await setSpvStance(db, sable, user('tomas'), { stance: 'does', minDeals: 4, note: 'Four SPVs with us at their last firm.' });

  // 5. Research text in a claim: an investment fact that names an SPV.
  const kestrel = await org('Kestrel Point Capital');
  await pursue(kestrel, 'spv-cortex', 'sourcing', 'juan', 'An allocator whose research names an SPV investment.');
  const doc = 'pub:demo-spv-kestrel';
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ($1,'Invented press release','public:press','https://example.org/kestrel/news','2026-07-01','moderate','An invented demo page.','') on conflict do nothing`, [doc]);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence)
    values ($1,'public.investment','Joined the Series B of an invented neurotech company through a lead investor’s SPV.',$2,'2026-07-01','medium')`, [kestrel, doc]);

  // 6. Research text: a profile that names co-investments, with a count.
  const aldermoor = await org('Aldermoor Trust');
  await pursue(aldermoor, 'spv-cortex', 'new', 'mara', 'A trust whose research profile mentions co-investments.');
  await db.query(`insert into research.note (entity_id, kind, body, data) values ($1,'public_profile',$2,$3)`, [aldermoor,
    'Aldermoor Trust backs early-stage science funds. It has made 3 co-investments alongside its managers since 2023.',
    JSON.stringify({ profile: { investorType: 'fo_principal', summary: 'Backs science funds and co-invests alongside managers.' }, researched: { at: '2026-08-30', by: 'demo seed' } })]);

  // 7. A conflict inside the derived signals: our own SPV over research text saying no.
  const pell = await org('Pell & Vance Holdings');
  await pursue(pell, 'spv-cortex', 'sourcing', 'sam', 'A holding company; our records and the research disagree on SPVs.');
  await pursue(pell, 'spv-lattice', 'committed', 'sam', 'Committed to Lattice.');
  await db.query(`insert into research.note (entity_id, kind, body, data) values ($1,'public_profile',$2,$3)`, [pell,
    'Pell & Vance Holdings does not do SPVs; it commits to funds and holds operating companies directly.',
    JSON.stringify({ profile: { investorType: 'corporate' }, researched: { at: '2026-05-10', by: 'demo seed' } })]);

  // 8. Our own SPVs: Committed on two of ours (one kept for its history), now on Cortex.
  const oriel = await org('Oriel Bay Capital');
  await pursue(oriel, 'spv-cortex', 'sourcing', 'juan', 'Committed to two of our earlier SPVs.');
  await pursue(oriel, 'spv-halo', 'committed', 'juan', 'Committed to Halo.');
  await pursue(oriel, 'spv-meridian', 'committed', 'juan', 'Committed to Meridian in 2025.');

  // 9. Nothing on file: unknown, likely open.
  const marrow = await org('Marrow Lane Capital');
  await pursue(marrow, 'spv-cortex', 'sourcing', 'tomas', 'A new name; nothing known about SPVs.');

  await deriveSpvStance(db);
  return { spvLps: 9 };
}
