import type { Check } from './harness';
import { freshDb } from './harness';

export async function directContactProperties(check: Check) {
  {
    // Issue 0027 (real): whom the team is in touch with. A meeting held, or word from them — never
    // only our own message; and a colleague's meeting is not the person's (N55), though it counts for
    // their firm, which says through whom. On a fresh database, last, so nothing after it sees the rows.
    const d = await freshDb();
    const mt = await import('../../modules/meetings');
    const juan = (await d.one<{ id: string }>(`select id from platform.app_user where handle = 'juan'`))!.id;
    const make = async (type: 'person' | 'org', name: string) =>
      (await d.one<{ entity_id: string }>(`insert into identity.entity (entity_type, display_name) values ($1, $2) returning entity_id`, [type, name]))!.entity_id;
    const [firm, wrote, met, heard] = [await make('org', 'Test Firm'), await make('person', 'Only Written To'), await make('person', 'Met Once'), await make('person', 'Wrote Back')];
    for (const person of [wrote, met]) {
      await d.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, as_of, is_primary) values ($1, $2, 'staff', 'Partner', current_date, true)`, [person, firm]);
    }
    const day = new Date(Date.now() - 20 * 86_400_000);
    await mt.logTouchpoint(juan, { entityId: wrote, vehicleId: null, channel: 'email', direction: 'ours', on: day, summary: 'Sent a note' });
    await mt.logTouchpoint(juan, { entityId: met, vehicleId: null, channel: 'meeting', direction: 'both', on: day, summary: 'Coffee' });
    await mt.logTouchpoint(juan, { entityId: heard, vehicleId: null, channel: 'email', direction: 'theirs', on: day, summary: 'They wrote' });
    const c = await mt.directContact([firm, wrote, met, heard]);
    check('In touch means a meeting held or word from them; our own message is not, and a colleague\u2019s meeting counts for their firm, not for them',
      !c.has(wrote) && c.get(met)?.how === 'met' && c.get(heard)?.how === 'heard' && c.get(firm)?.via === 'Met Once' && c.get(met)?.via === null,
      `only written to: ${c.has(wrote) ? 'in touch' : 'not in touch'}; met: ${c.get(met)?.how ?? 'none'}; wrote back: ${c.get(heard)?.how ?? 'none'}; their firm: ${c.get(firm) ? `through ${c.get(firm)!.via}` : 'none'}`);
  }
}
