import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';

const fixture = async <T>(name: string): Promise<T[]> =>
  JSON.parse(await readFile(join(process.cwd(), 'fixtures', name), 'utf8')) as T[];

/**
 * Enough for every screen to have something in it. Deliberately fictional: real names and
 * amounts should not reach a shared repo (docs/12, "Seeds").
 */
export async function seed(db: Db): Promise<{ users: number; vehicles: number; sources: number }> {
  const users = await fixture<{ handle: string; name: string; initials: string; role: string; email: string }>('users.json');
  const vehicles = await fixture<{ slug: string; name: string; kind: string; exemption: string; target_amount: number | null; sort_order: number }>('vehicles.json');
  const sources = await fixture<{ source: string; label: string; status: string; detail: string }>('sources.json');

  await db.transaction(async (tx) => {
    for (const u of users) {
      await tx.query(
        `insert into platform.app_user (handle, name, initials, role, email)
         values ($1,$2,$3,$4,$5) on conflict (handle) do nothing`,
        [u.handle, u.name, u.initials, u.role, u.email],
      );
    }
    for (const v of vehicles) {
      await tx.query(
        `insert into platform.vehicle (slug, name, kind, exemption, target_amount, sort_order)
         values ($1,$2,$3::platform.vehicle_kind,$4,$5,$6) on conflict (slug) do nothing`,
        [v.slug, v.name, v.kind, v.exemption, v.target_amount, v.sort_order],
      );
    }
    for (const s of sources) {
      await tx.query(
        `insert into platform.source_sync (source, label, status, last_sync_at, detail)
         values ($1,$2,$3::platform.sync_status,$4,$5)
         on conflict (source) do update set status = excluded.status, last_sync_at = excluded.last_sync_at, detail = excluded.detail`,
        [s.source, s.label, s.status, s.status === 'ok' ? new Date() : null, s.detail],
      );
    }
    await tx.query(
      `insert into platform.audit_log (action, subject_type, detail)
       values ('seed.loaded', 'database', $1)`,
      [JSON.stringify({ users: users.length, vehicles: vehicles.length, sources: sources.length })],
    );
  });

  const research = await seedResearch(db);
  const { seedNetwork } = await import('./seed-network');
  const network = await seedNetwork(db);
  const { seedCoordination } = await import('./seed-coordination');
  const coordination = await seedCoordination(db);
  const { seedStrategy } = await import('./seed-strategy');
  const strategy = await seedStrategy(db);
  return {
    users: users.length, vehicles: vehicles.length, sources: sources.length,
    ...research, ...network, ...coordination, ...strategy,
  };
}

interface EntityFixture { key: string; type: string; name: string; note: string }
interface DocFixture {
  doc_id: string; title: string; kind: string; origin: string; as_of: string;
  strength: string; supports: string; body: string;
}
interface ClaimFixture {
  entity: string; field: string; value: string; source: string; as_of: string;
  confidence: string; verified_by: string | null;
}
interface NoteFixture {
  entity: string; kind: string; author: string; body: string; tags: string[];
  data: Record<string, unknown>;
}

/**
 * L2 seed: the target-pursuit corpus. Eleven source documents of deliberately varying
 * evidentiary strength — including a do-not-approach restriction and a co-attendance-only
 * lead — so that the discipline can be tested before any connector exists.
 */
async function seedResearch(db: Db) {
  const entities = await fixture<EntityFixture>('entities.json');
  const docs = await fixture<DocFixture>('source-docs.json');
  const claims = await fixture<ClaimFixture>('claims.json');
  const notes = await fixture<NoteFixture>('notes.json');

  const existing = await db.one<{ n: string }>('select count(*)::text as n from identity.entity');
  if (existing && Number(existing.n) > 0) {
    return { entities: 0, docs: 0, claims: 0, notes: 0 };
  }

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const userId = (handle: string | null) => (handle ? users.find((u) => u.handle === handle)?.id ?? null : null);
  const ids = new Map<string, string>();

  await db.transaction(async (tx) => {
    for (const e of entities) {
      const row = await tx.query<{ entity_id: string }>(
        `insert into identity.entity (entity_type, display_name)
         values ($1::identity.entity_type, $2) returning entity_id`,
        [e.type, e.name],
      );
      const id = row[0]!.entity_id;
      ids.set(e.key, id);
      await tx.query(
        `insert into identity.source_record (source, source_id, entity_id, confidence, resolved_by)
         values ('seed', $1, $2, null, 'human:seed')`,
        [e.key, id],
      );
      if (e.note) {
        await tx.query(
          `insert into research.note (entity_id, kind, body, tags) values ($1, 'summary', $2, '{}')`,
          [id, e.note],
        );
      }
    }

    for (const d of docs) {
      await tx.query(
        `insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
         values ($1,$2,$3,$4,$5::date,$6::research.doc_strength,$7,$8)`,
        [d.doc_id, d.title, d.kind, d.origin, d.as_of, d.strength, d.supports, d.body],
      );
    }

    for (const c of claims) {
      const entityId = ids.get(c.entity);
      if (!entityId) continue;
      const verifier = userId(c.verified_by);
      await tx.query(
        `insert into research.claim
           (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
         values ($1,$2,$3,$4,$5::date,$6::research.confidence,$7,$8)`,
        [entityId, c.field, c.value, c.source, c.as_of, c.confidence, verifier, verifier ? new Date() : null],
      );
    }

    for (const n of notes) {
      const entityId = ids.get(n.entity);
      if (!entityId) continue;
      await tx.query(
        `insert into research.note (entity_id, author_id, kind, body, tags, data)
         values ($1,$2,$3,$4,$5,$6)`,
        [entityId, userId(n.author), n.kind, n.body, n.tags, JSON.stringify(n.data)],
      );
    }

    // One of each, so the distinction is visible in the UI rather than only in a README.
    await tx.query(
      `insert into research.read_cache (source, source_id, payload, expires_at)
       values ('seed', 'roos-fdn', $1, now() + interval '1 hour')`,
      [JSON.stringify({ note: 'A cache exists for latency and quota. It may vanish at any time.' })],
    );
    await tx.query(
      `insert into research.snapshot (source, source_id, payload, taken_for, note)
       values ('seed', 'roos-fdn', $1, 'dossier draft, 14 Sep', $2)`,
      [
        JSON.stringify({ mandate: 'Neurodegeneration and longevity biology', band: '$2\u20135M' }),
        'What we saw on 14 September. Not today\u2019s truth, and labelled as such wherever it appears.',
      ],
    );
  });

  return { entities: entities.length, docs: docs.length, claims: claims.length, notes: notes.length };
}

/** Called on boot so `npm run dev` on a fresh clone lands on a populated screen. */
export async function seedIfEmpty(db: Db): Promise<void> {
  const row = await db.one<{ n: string }>('select count(*)::text as n from platform.app_user');
  if (row && Number(row.n) > 0) return;
  await seed(db);
}
