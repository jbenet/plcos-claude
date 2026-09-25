import { getDb } from '@/lib/db';
import { listPursuits, STATUS_LABEL } from '@/modules/strategy';
import { RESEARCH_STATUSES } from './candidates';

/**
 * LPs added to Affinity in a bulk import, with nothing else on record (N81).
 *
 * Juan asked, 24 Sep, what "the 31 May names" were. Affinity's list entries say when each was added,
 * and 31 May 2026 added 625 of them — most likely one spreadsheet import. For a hundred or so in the
 * research set, that import is all there is: no meeting, no email, no note, no word from the team.
 * Nothing says who suggested them or who knows them, so a strategy can't choose a route, and asks why
 * they are on the list. One pass by whoever remembers the import unblocks them: where each came from,
 * or the whole import at once. The answer is saved as the team's context on the LP, which the
 * strategy step reads first and which makes the strategy due again.
 *
 * A day is a bulk import when BULK_DAY or more entries were added on it.
 */
export const BULK_DAY = 100; // GUESS — the real account's busiest five days added 101 to 625 entries each; an ordinary day adds a handful.

export interface Unsourced {
  pursuitId: string;
  entityId: string;
  vehicleId: string;
  name: string;
  org: string | null;
  vehicle: string;
  status: string;
  owner: string | null;
}

export interface BulkDay {
  day: string;
  /** Every entry added that day, on any list. */
  added: number;
  /** Research-set LPs added that day: those with anything else on record, and those without. */
  inSet: number;
  rows: Unsourced[];
}

export async function addedInBulk(): Promise<BulkDay[]> {
  const db = await getDb();
  const entries = await db.query<{ key: string; day: string }>(
    `select distinct on (source_id)
            (case when payload->>'type' = 'person' then 'person' else payload->>'type' end) || ':' || (payload->'entity'->>'id') as key,
            substr(payload->>'createdAt', 1, 10) as day
       from sources.raw_record where source = 'affinity' and kind = 'list_entry'
      order by source_id, fetched_at desc, id desc`,
  );
  const perDay = new Map<string, number>();
  for (const e of entries) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
  const bulk = new Set([...perDay].filter(([, k]) => k >= BULK_DAY).map(([d]) => d));
  if (!bulk.size) return [];
  // When each of our entities was first added: its earliest entry on any list.
  const firstAdded = new Map<string, string>();
  const links = await db.query<{ source_id: string; entity_id: string }>(
    `select source_id, entity_id::text from identity.source_record where source = 'affinity'`,
  );
  const entityOf = new Map(links.map((l) => [l.source_id, l.entity_id]));
  for (const e of entries) {
    const id = entityOf.get(e.key);
    if (id && (!firstAdded.has(id) || e.day < firstAdded.get(id)!)) firstAdded.set(id, e.day);
  }

  const pursuits = (await listPursuits(null)).filter((p) => !p.historical && RESEARCH_STATUSES.includes(p.status));
  const ids = [...new Set(pursuits.map((p) => p.entityId))];
  // Anything else on record: a touchpoint, a note in Affinity on them, the team's own context.
  const withRecord = new Set((await db.query<{ id: string }>(
    `select distinct entity_id::text as id from meetings.meeting where entity_id = any($1::uuid[])
     union
     select distinct entity_id::text from research.note where kind = 'context' and entity_id = any($1::uuid[])`,
    [ids],
  )).map((r) => r.id));
  const noted = new Set((await db.query<{ key: string }>(
    `with n as (select distinct on (source_id) payload from sources.raw_record where source = 'affinity' and kind = 'note' order by source_id, fetched_at desc, id desc)
     select distinct 'person:' || (p->>'id') as key from n cross join lateral jsonb_array_elements(coalesce(n.payload->'personsPreview'->'data', '[]'::jsonb)) p
     union
     select distinct 'company:' || (c->>'id') from n cross join lateral jsonb_array_elements(coalesce(n.payload->'companiesPreview'->'data', '[]'::jsonb)) c`,
  )).map((r) => r.key));
  for (const l of links) if (noted.has(l.source_id)) withRecord.add(l.entity_id);
  const orgs = new Map((await db.query<{ person: string; org: string }>(
    `select distinct on (a.person_entity) a.person_entity::text as person, o.display_name as org
       from identity.affiliation a join identity.entity o on o.entity_id = a.org_entity
      where a.ended_on is null and a.person_entity = any($1::uuid[]) order by a.person_entity, a.is_primary desc, a.as_of desc`,
    [ids],
  )).map((r) => [r.person, r.org]));

  const out = new Map<string, BulkDay>();
  for (const p of pursuits) {
    const day = firstAdded.get(p.entityId);
    if (!day || !bulk.has(day)) continue;
    const d = out.get(day) ?? { day, added: perDay.get(day) ?? 0, inSet: 0, rows: [] };
    d.inSet++;
    if (!withRecord.has(p.entityId)) {
      d.rows.push({
        pursuitId: p.pursuitId, entityId: p.entityId, vehicleId: p.vehicleId, name: p.entityName, org: orgs.get(p.entityId) ?? null,
        vehicle: p.vehicleName, status: STATUS_LABEL[p.status], owner: p.ownerSaid ?? p.ownerName ?? null,
      });
    }
    out.set(day, d);
  }
  return [...out.values()].filter((d) => d.rows.length).sort((a, b) => b.rows.length - a.rows.length)
    .map((d) => ({ ...d, rows: d.rows.sort((a, b) => a.name.localeCompare(b.name)) }));
}
