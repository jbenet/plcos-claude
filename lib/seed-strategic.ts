import type { Db } from './db';

/**
 * Demo seed for strategic value (issue 0120): invented inputs on SPV — Cortex, an invented neurotech
 * company, so its selection shows every level. A tie to the company by name, research in the field,
 * a prospect row marked strategic, one sourced and not marked, and nothing at all (the rest). On the
 * Neurotech fund the fit assessments' "Beyond capital" grades already give the assessed levels.
 * Fictional names and invented example.org pages.
 */
export async function seedStrategic(db: Db): Promise<{ strategicInputs: number }> {
  const done = await db.one<{ n: string }>(`select count(*)::text n from research.source_doc where doc_id like 'pub:demo-strategic-%'`);
  if (Number(done?.n ?? 0) > 0) return { strategicInputs: 0 };
  const cortex = await db.one<{ id: string }>(`select id::text from platform.vehicle where slug = 'spv-cortex'`);
  if (!cortex) return { strategicInputs: 0 };
  const lp = async (name: string) => (await db.one<{ entity: string; pursuit: string }>(
    `select p.entity_id::text entity, p.pursuit_id::text pursuit from strategy.pursuit p join identity.entity e using (entity_id)
      where e.display_name = $1 and p.vehicle_id = $2`, [name, cortex.id]));
  let n = 0;

  const fact = async (name: string, field: string, value: string, asOf: string) => {
    const who = await lp(name);
    if (!who) return;
    const doc = `pub:demo-strategic-${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${field}`;
    await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
      values ($1,'Invented page','public:press',$2,$3,'moderate','An invented demo page. It supports what it says, and nothing it doesn''t.',$4)
      on conflict (doc_id) do nothing`, [doc, `https://example.org/${doc.slice(19)}`, asOf, value]);
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1,$2,$3,$4,$5,'medium')`,
      [who.entity, `public.${field}`, value, doc, asOf]);
    n++;
  };
  const sourced = async (name: string, strategic: boolean, reason: string) => {
    const who = await lp(name);
    if (!who) return;
    await db.query(`insert into research.note (entity_id, kind, body, data) values ($1,'context',$2,$3::jsonb)`, [who.entity,
      `Added by rule (demo): ${reason}`, JSON.stringify({ source: 'prospects', pursuitId: who.pursuit, vehicleId: cortex.id, vehicle: 'spv-cortex',
        status: 'sourcing', strategic, reason, name, org: null, capacity: { band: 'unknown', basis: 'Invented', guess: true }, route: null,
        sources: ['https://example.org/demo-prospects'] })]);
    n++;
  };

  // High: a tie to the company itself.
  await fact('Petrel Meadowsweet Capital', 'board', 'Board observer at Cortex since its seed round, for a partner who ran a clinical neurology practice.', '2026-08-12');
  // High: two ties to the field — an operating role and a stated interest.
  await fact('Iwasaki Family Office', 'role', 'The principal is a former neurosurgeon and chairs the family office’s investment committee.', '2026-06-14');
  await fact('Iwasaki Family Office', 'interest', 'Writes about brain-computer interfaces and funds a neurorehabilitation lab.', '2026-06-14');
  // Some: marked strategic when sourced.
  await sourced('Kittiwake Cindervale Trust', true, 'Its science advisers include two neuroscientists who could help Cortex recruit clinical sites.');
  // None: sourced, researched, and not marked strategic.
  await sourced('Delahunt & Grimaldo Holdings', false, 'A holding company that qualifies on check size alone; nothing ties it to neuroscience.');
  return { strategicInputs: n };
}
