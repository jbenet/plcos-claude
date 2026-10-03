import { resolveEntity, type EntityCreation } from './create';
// entity.entity_type is the effective local type, protected by the correction migration.
import { getDb } from '@/lib/db';
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
      ${ids ? 'and entity_id in (select identity.canonical_entity_id(id) from unnest($1::uuid[]) id)' : ''} order by display_name`,
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

/** A bounded discovery preview. Pipeline identities are retained first; remaining slots
 * contain the first names in the address book. Callers must disclose this scope. */
export async function listEntityPreview(preferredIds: string[], limit = 1000): Promise<Entity[]> {
  // GUESS: 1,000 names is the maximum useful foreground map preview.
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 1000;
  const preferred = await listEntities([...new Set(preferredIds)].slice(0, take));
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
