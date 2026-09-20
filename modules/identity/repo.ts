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

export async function listEntities(): Promise<Entity[]> {
  const db = await getDb();
  const rows = await db.query<Row>(
    `select ${COLS} from identity.entity where merged_into is null and retired_at is null
      order by display_name`,
  );
  return rows.map(toEntity);
}

/** Follows the merge redirect, which is the whole reason merged ids are never reused. */
export async function getEntity(id: string): Promise<Entity | null> {
  const db = await getDb();
  let row = await db.one<Row>(`select ${COLS} from identity.entity where entity_id = $1`, [id]);
  let hops = 0;
  while (row?.merged_into && hops < 8) {
    row = await db.one<Row>(`select ${COLS} from identity.entity where entity_id = $1`, [row.merged_into]);
    hops += 1;
  }
  return row ? toEntity(row) : null;
}

export async function createEntity(entityType: EntityType, displayName: string): Promise<Entity> {
  const db = await getDb();
  const row = await db.one<Row>(
    `insert into identity.entity (entity_type, display_name) values ($1::identity.entity_type, $2)
     returning ${COLS}`,
    [entityType, displayName],
  );
  if (!row) throw new Error('entity insert returned no row');
  return toEntity(row);
}

export async function countEntities(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    'select count(*)::text as n from identity.entity where merged_into is null and retired_at is null',
  );
  return Number(row?.n ?? 0);
}
