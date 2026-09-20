import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';

interface EdgeFixture {
  from: string; to: string; kind: string; tier: string;
  strength: number; tie_band: string; valid_from: string; valid_to?: string;
  reviewed_by?: string; review_note?: string;
  evidence: Array<{ doc?: string; note: string }>;
}

/**
 * L4 seed: the team as entities, and the edges between them and the universe.
 *
 * The team members exist twice on purpose — once in `platform.app_user` as people who log
 * in, once in `identity.entity` as nodes in the graph — and `identity.source_record` joins
 * them with `source = 'app_user'`. That is what the source_record table is for.
 */
export async function seedNetwork(db: Db): Promise<{ teamEntities: number; edges: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from network.edge');
  if (existing && Number(existing.n) > 0) return { teamEntities: 0, edges: 0 };

  const edges: EdgeFixture[] = JSON.parse(
    await readFile(join(process.cwd(), 'fixtures', 'edges.json'), 'utf8'),
  ) as EdgeFixture[];

  const users = await db.query<{ id: string; handle: string; name: string }>(
    'select id, handle, name from platform.app_user',
  );
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const bySource = await db.query<{ source_id: string; entity_id: string }>(
    "select source_id, entity_id from identity.source_record where source = 'seed'",
  );

  const key = new Map(bySource.map((r) => [r.source_id, r.entity_id]));
  const userId = (h: string) => users.find((u) => u.handle === h)?.id ?? null;
  let teamEntities = 0;

  await db.transaction(async (tx) => {
    for (const u of users) {
      const existingEntity = entities.find((e) => e.display_name === u.name);
      let entityId = existingEntity?.entity_id;
      if (!entityId) {
        const rows = await tx.query<{ entity_id: string }>(
          `insert into identity.entity (entity_type, display_name)
           values ('person', $1) returning entity_id`,
          [u.name],
        );
        entityId = rows[0]!.entity_id;
        teamEntities += 1;
      }
      await tx.query(
        `insert into identity.source_record (source, source_id, entity_id, resolved_by)
         values ('app_user', $1, $2, 'rule:handle') on conflict (source, source_id) do nothing`,
        [u.handle, entityId],
      );
      key.set(u.handle, entityId);
    }

    for (const e of edges) {
      const from = key.get(e.from);
      const to = key.get(e.to);
      if (!from || !to) throw new Error(`edge fixture references an unknown node: ${e.from} → ${e.to}`);
      const reviewer = e.reviewed_by ? userId(e.reviewed_by) : null;
      await tx.query(
        `insert into network.edge
           (from_entity, to_entity, kind, tier, strength, tie_band, evidence,
            reviewed_by, reviewed_at, review_note, valid_from, valid_to)
         values ($1,$2,$3::network.edge_kind,$4::network.evidence_tier,$5,$6,$7,$8,$9,$10,$11::date,$12::date)`,
        [
          from, to, e.kind, e.tier, e.strength, e.tie_band, JSON.stringify(e.evidence),
          reviewer, reviewer ? new Date() : null, e.review_note ?? null,
          e.valid_from, e.valid_to ?? null,
        ],
      );
    }
  });

  return { teamEntities, edges: edges.length };
}
