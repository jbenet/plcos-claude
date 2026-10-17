import { resolveEntity, type EntityCreation } from './create';
// entity.entity_type is the effective local type, protected by the correction migration.
import { getDb } from '@/lib/db';
import { buildCache } from '@/lib/build-cache';
import type { Entity, EntityType } from './types';

type Row = {
  entity_id: string; entity_type: EntityType; display_name: string;
  merged_into: string | null; retired_at: Date | string | null;
};

const toEntity = (r: Row): Entity => ({
  entityId: r.entity_id,
  entityType: r.entity_type,
  displayName: r.display_name,
  mergedInto: r.merged_into,
  retiredAt: r.retired_at ? new Date(r.retired_at) : null,
});

const COLS = 'entity_id, entity_type, display_name, merged_into, retired_at';

export async function listEntities(ids?: string[]): Promise<Entity[]> {
  if (ids?.length === 0) return [];
  const db = await getDb();
  const rows = await db.query<Row>(
    `select ${COLS} from identity.entity where merged_into is null and retired_at is null
      ${ids ? `and entity_id in (select case when x.merged_into is null then x.entity_id else identity.canonical_entity_id(x.entity_id) end
        from unnest($1::uuid[]) id join identity.entity x on x.entity_id = id)` : ''} order by display_name`,
    ids ? [ids] : [],
  );
  return rows.map(toEntity);
}

/** Any live person or organization by name, for pickers that reach beyond the pipeline. Names that
 * start with the text come first. One bounded scan per typed search, never per keystroke. */
export async function searchEntities(text: string, limit = 40): Promise<Entity[]> {
  const q = text.trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await (await getDb()).query<Row>(
    `select ${COLS} from identity.entity where merged_into is null and retired_at is null and display_name ilike $1
      order by (display_name ilike $2) desc, lower(display_name), entity_id limit $3`,
    [`%${escaped}%`, `${escaped}%`, take]);
  return rows.map(toEntity);
}

/** A name found by the search page: the record, the names it is tied to that matched, and the other records with the
 * same name and kind (unmerged duplicates), folded under it. */
export interface NameHit extends Entity { via: string[]; related: string[]; sameName: string[] }

/**
 * The search page's names (issues 0150–0152): every word typed must be in the name or in the name of a firm or person it
 * is currently tied to (identity.affiliation), so "person firm" finds the person and a firm's name brings its people.
 * Names that hold every word come first, those starting with the text before them. Records with the same name and kind
 * are one row, led by the one with the most sources on file; the others are listed with it, never merged here.
 */
export async function searchNames(text: string, limit = 40): Promise<NameHit[]> {
  // GUESS: five words is more than any name typed into search needs.
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  const like = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const prefix = `${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await (await getDb()).query<Row & { related: string[] | null; sources: number }>(`
    with hit as materialized (
      select entity_id from identity.entity where merged_into is null and retired_at is null and display_name ilike any($1::text[])
    ), near as (
      -- GUESS: the ties of the first 500 names found are enough to look through; a one-letter search finds thousands.
      select array_agg(entity_id) ids from (select entity_id from hit limit 500) x
    ), cand as (
      select entity_id from hit
      union select identity.canonical_entity_id(a.person_entity) from identity.affiliation a, near
       where a.ended_on is null and a.org_entity = any(identity.alias_ids(near.ids))
      union select identity.canonical_entity_id(a.org_entity) from identity.affiliation a, near
       where a.ended_on is null and a.person_entity = any(identity.alias_ids(near.ids))
    )
    select ${COLS.split(', ').map((c) => `e.${c}`).join(', ')}, rel.names related,
           (select count(*)::int from identity.source_record s where s.entity_id = e.entity_id) sources
      from cand c join identity.entity e on e.entity_id = c.entity_id and e.merged_into is null and e.retired_at is null
      left join lateral (
        select array_agg(distinct o.display_name order by o.display_name) names
          from identity.affiliation a join identity.entity o on o.entity_id = identity.canonical_entity_id(
                 case when identity.canonical_entity_id(a.person_entity) = e.entity_id then a.org_entity else a.person_entity end)
         where a.ended_on is null and o.entity_id <> e.entity_id and o.merged_into is null and o.retired_at is null
           and (a.person_entity = any(identity.alias_ids(array[e.entity_id])) or a.org_entity = any(identity.alias_ids(array[e.entity_id])))
      ) rel on true
     where (select bool_and(e.display_name ilike w or exists (select 1 from unnest(rel.names) n where n ilike w)) from unnest($1::text[]) w)
     order by (select bool_and(e.display_name ilike w) from unnest($1::text[]) w) desc, (e.display_name ilike $2) desc, lower(e.display_name), sources desc, e.entity_id
     limit $3`, [like, prefix, take * 3]);
  const matches = (n: string) => words.some((w) => n.toLowerCase().includes(w.toLowerCase()));
  const out = new Map<string, NameHit & { sources: number }>();
  for (const r of rows) {
    const key = `${r.entity_type}|${r.display_name.trim().toLowerCase()}`;
    const related = r.related ?? [];
    const hit = { ...toEntity(r), via: related.filter(matches), related, sameName: [] as string[], sources: r.sources };
    const had = out.get(key);
    if (!had) { out.set(key, hit); continue; }
    // The record with the most sources leads its name; the other is kept with it.
    if (hit.sources > had.sources) out.set(key, { ...hit, sameName: [had.entityId, ...had.sameName] });
    else had.sameName.push(hit.entityId);
  }
  return [...out.values()].slice(0, take).map(({ sources: _s, ...h }) => h);
}

/** A bounded discovery preview. Pipeline identities are retained first; remaining slots
 * contain the first names in the address book. Callers must disclose this scope. */
export async function listEntityPreview(preferredIds: string[], limit = 1000): Promise<Entity[]> {
  // GUESS: 1,000 names is the maximum useful foreground map preview.
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 1000;
  return [...await previewAt([...new Set(preferredIds)].slice(0, take).join(','), String(take))];
}

/** Kept per read revision (identity.entity moves it), keyed by the ids in order: the visualizations ask for the same
 * preview on every visit (15 Oct 2026). Rows are shared: never change one. */
const previewAt = buildCache((ids: string, take: string) => loadPreview(ids ? ids.split(',') : [], Number(take)));

async function loadPreview(ids: string[], take: number): Promise<Entity[]> {
  const preferred = await listEntities(ids);
  if (preferred.length >= take) return preferred;
  const db = await getDb();
  const rows = await db.query<Row>(
    `select ${COLS} from identity.entity where merged_into is null and retired_at is null
      order by lower(display_name), entity_id limit $1`, [take],
  );
  const seen = new Set(preferred.map((e) => e.entityId));
  return [...preferred, ...rows.filter((r) => !seen.has(r.entity_id)).map(toEntity)].slice(0, take);
}

/** Follows the merge redirect, which is the whole reason merged ids are never reused. */
export async function getEntity(id: string): Promise<Entity | null> {
  const db = await getDb();
  const row = await db.one<Row>(`select ${COLS} from identity.entity where entity_id = identity.canonical_entity_id($1::uuid)`, [id]);
  return row ? toEntity(row) : null;
}

export async function createEntity(entityType: EntityType, displayName: string, evidence: Pick<EntityCreation, 'domains' | 'organizations' | 'personalUrls'> = {}): Promise<Entity> {
  const db = await getDb();
  const resolved = await resolveEntity(db, {type:entityType,name:displayName,...evidence});
  const row = await db.one<Row>(`select ${COLS} from identity.entity where entity_id=$1`,[resolved.id]);
  if (!row) throw new Error('Resolved entity is missing');
  return toEntity(row);
}

export async function countEntities(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    'select count(*)::text as n from identity.entity where merged_into is null and retired_at is null',
  );
  return Number(row?.n ?? 0);
}
