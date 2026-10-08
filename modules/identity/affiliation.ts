import { getDb } from '@/lib/db';

export type AffilKind =
  | 'principal' | 'decision_maker' | 'staff' | 'adviser' | 'board' | 'contact';

export const AFFIL_LABEL: Record<AffilKind, string> = {
  principal: 'Principal',
  decision_maker: 'Decides',
  staff: 'Works there',
  adviser: 'Adviser',
  board: 'Board',
  contact: 'Our contact',
};

/** What each capacity licenses. The label is short; this is what it actually means. */
export const AFFIL_MEANS: Record<AffilKind, string> = {
  principal: 'It is their money, or their foundation. Nobody above them.',
  decision_maker: 'Signs, or can kill it. Named because somebody confirmed it, not inferred from a title.',
  staff: 'Works there. No decision right recorded either way.',
  adviser: 'Retained rather than employed — they advise the decision, they do not make it.',
  board: 'On the board. Governs, and is usually not in the room for an allocation.',
  contact: 'Who we actually deal with. Capacity not established, which is itself worth knowing.',
};

/** Ordering for display: who matters to an allocation, most first. */
const RANK: Record<AffilKind, number> = {
  principal: 0, decision_maker: 1, contact: 2, adviser: 3, board: 4, staff: 5,
};

export interface Affiliation {
  affiliationId: string;
  personId: string;
  personName: string;
  orgId: string;
  orgName: string;
  orgType: string;
  kind: AffilKind;
  role: string;
  startedOn: Date | null;
  endedOn: Date | null;
  isPrimary: boolean;
  source: string | null;
  asOf: Date;
  certainty: string;
  note: string | null;
  /** Derived: an ended row is former, and a former role never carries a route. */
  current: boolean;
}

type Row = {
  affiliation_id: string; person_entity: string; person_name: string;
  org_entity: string; org_name: string; org_type: string;
  kind: AffilKind; role: string; started_on: Date | string | null;
  ended_on: Date | string | null; is_primary: boolean; source: string | null;
  as_of: Date | string; certainty: string; note: string | null;
};

const SELECT = `
  select a.affiliation_id, a.kind, a.role, a.started_on, a.ended_on, a.is_primary,
         a.source, a.as_of, a.certainty, a.note, p.entity_id as person_entity,
         o.entity_id as org_entity, p.display_name as person_name,
         o.display_name as org_name, o.entity_type::text as org_type
    from identity.affiliation a
    join identity.entity p on p.entity_id = identity.canonical_entity_id(a.person_entity)
    join identity.entity o on o.entity_id = identity.canonical_entity_id(a.org_entity)`;

const toAffiliation = (r: Row): Affiliation => ({
  affiliationId: r.affiliation_id,
  personId: r.person_entity, personName: r.person_name,
  orgId: r.org_entity, orgName: r.org_name, orgType: r.org_type,
  kind: r.kind, role: r.role,
  startedOn: r.started_on ? new Date(r.started_on) : null,
  endedOn: r.ended_on ? new Date(r.ended_on) : null,
  isPrimary: r.is_primary, source: r.source, asOf: new Date(r.as_of),
  certainty: r.certainty, note: r.note,
  current: r.ended_on === null,
});

const order = (a: Affiliation, b: Affiliation) =>
  Number(b.current) - Number(a.current)
  || RANK[a.kind] - RANK[b.kind]
  || a.personName.localeCompare(b.personName);

export async function listAffiliations(): Promise<Affiliation[]> {
  const db = await getDb();
  return (await db.query<Row>(SELECT)).map(toAffiliation).sort(order);
}

/** Everyone who acts for this organisation. Former roles included, and labelled. */
export async function peopleAt(orgId: string): Promise<Affiliation[]> {
  const db = await getDb();
  // The organisation's aliases first, so the affiliation index answers (8 Oct 2026; a scan of every
  // affiliation was ~0.4 s per LP page on the live scale).
  return (await db.query<Row>(`${SELECT} where a.org_entity = any(identity.alias_ids(array[identity.canonical_entity_id($1::uuid)]))`, [orgId]))
    .map(toAffiliation).sort(order);
}

/** Every organisation this person acts for. More than one is normal, not an error. */
export async function orgsFor(personId: string): Promise<Affiliation[]> {
  const db = await getDb();
  return (await db.query<Row>(`${SELECT} where a.person_entity = any(identity.alias_ids(array[identity.canonical_entity_id($1::uuid)]))`, [personId]))
    .map(toAffiliation).sort((a, b) =>
      Number(b.current) - Number(a.current)
      || Number(b.isPrimary) - Number(a.isPrimary)
      || RANK[a.kind] - RANK[b.kind]);
}

/** Only relationships involving the shown identities. Raw FK filtering retains the
 * affiliation indexes, including all reversible aliases of a canonical record. */
export async function affiliationsFor(ids: string[], limit = 2000): Promise<Affiliation[]> {
  if (!ids.length) return [];
  const db = await getDb();
  return (await db.query<Row>(`with recursive wanted(id) as (
    select identity.canonical_entity_id(id) from unnest($1::uuid[]) id
    union select e.entity_id from identity.entity e join wanted w on e.merged_into = w.id
  ), selected_ids as materialized (
    select affiliation_id from (
      select a.affiliation_id from wanted w cross join lateral (
        select affiliation_id from identity.affiliation where person_entity = w.id order by affiliation_id limit $2
      ) a
      union select a.affiliation_id from wanted w cross join lateral (
        select affiliation_id from identity.affiliation where org_entity = w.id order by affiliation_id limit $2
      ) a
    ) ids order by affiliation_id limit $2
  ), selected as materialized (
    select a.* from identity.affiliation a join selected_ids using(affiliation_id)
  ) ${SELECT.replace('identity.affiliation a', 'selected a')}
    order by a.affiliation_id`, [ids, Math.min(2000, Math.max(1, limit))])).map(toAffiliation).sort(order);
}
