import type { Check } from './harness';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';

/**
 * Revisions move at commit (network 016, performance pass, 8 Oct 2026). A long writer used to hold
 * the one revision row until it committed, so every other write to ~30 tables waited for it: an LP
 * moved to Selected waited for a research import. Invented rows only.
 */
export async function commitRevisionProperties(check: Check) {
  const db = await openTestDb();
  try {
    await migrate(db);
    const rev = async () => (await db.one<{ read: string; route: string; edge: string }>(`select r.revision::text read, rr.revision::text route,
      e.revision::text edge from network.read_revision r, network.route_revision rr, network.edge_revision e`))!;
    const user = (await db.one<{ id: string }>(`insert into platform.app_user (handle, name, initials, role, email, access)
      values ('rev-fixture', 'Invented Reviser', 'IR', 'Invented', 'rev-fixture@example.invalid', 'admin') returning id::text`))!.id;
    const vehicle = (await db.one<{ id: string }>(`insert into platform.vehicle (slug, name, kind, exemption) values ('rev-fixture', 'Invented Fund', 'fund', '506(c)') returning id::text`))!.id;
    const [person, org] = (await db.query<{ id: string }>(`insert into identity.entity (entity_type, display_name)
      values ('person', 'Invented Person'), ('org', 'Invented Org') returning entity_id::text id`)).map(r => r.id);
    const pursuit = (await db.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id) values ($1, $2, $3) returning pursuit_id::text id`,
      [org, vehicle, user]))!.id;

    // Inside a transaction the revision has not moved yet; at commit it has, and only once.
    const before = await rev();
    let inside = '';
    await db.transaction(async tx => {
      await tx.query(`update strategy.pursuit set status = 'sourcing' where pursuit_id = $1`, [pursuit]);
      await tx.query(`update strategy.pursuit set status = 'selected' where pursuit_id = $1`, [pursuit]);
      inside = (await tx.one<{ r: string }>('select revision::text r from network.read_revision'))!.r;
    });
    const after = await rev();
    check('REVISIONS move at commit, once per transaction', inside === before.read && after.read !== before.read
      && BigInt(after.read) > BigInt(before.read) && after.route === before.route,
      `before ${before.read}, inside ${inside}, after ${after.read}; route ${before.route} → ${after.route}`);
    check('REVISIONS leave no pending marks after commit',
      (await db.one<{ n: number }>('select count(*)::int n from network.revision_bump'))!.n === 0, 'network.revision_bump is empty');

    // An identity change moves the route revision, and the entity it changed carries the new value.
    await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty)
      values ($1, $2, 'staff', 'Invented', 'fixture', now(), 'inferred')`, [person, org]);
    const routed = await rev();
    const changed = await db.query<{ revision: string }>(`select revision::text from network.route_changed_entity where entity_id = any($1::uuid[])`, [[person, org]]);
    check('REVISIONS stamp changed entities with the committed route revision', BigInt(routed.route) > BigInt(after.route)
      && changed.length === 2 && changed.every(c => c.revision === routed.route), `route ${routed.route}; entities ${changed.map(c => c.revision).join(', ')}`);

    // A rolled-back write moves nothing.
    try {
      await db.transaction(async tx => {
        await tx.query(`update strategy.pursuit set status = 'new' where pursuit_id = $1`, [pursuit]);
        throw new Error('Invented rollback');
      });
    } catch { /* expected */ }
    check('REVISIONS do not move for a rolled-back write', (await rev()).read === routed.read, 'same read revision');

    // An import worker's write (its session sets plcos.background, network 017) moves the revision, not
    // the foreground; a person's write moves both.
    const fg = async () => (await db.one<{ r: string; f: string }>('select revision::text r, foreground::text f from network.read_revision'))!;
    const start = await fg();
    await db.transaction(async tx => {
      await tx.query(`select set_config('plcos.background', 'on', true)`);
      await tx.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'context', 'Invented import note', '{}')`, [org]);
    });
    const background = await fg();
    await db.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'context', 'Invented person note', '{}')`, [org]);
    const personal = await fg();
    check('REVISIONS tell an import worker\'s writes from a person\'s', background.r !== start.r && background.f === start.f
      && personal.r !== background.r && personal.f === personal.r,
      `start ${start.r}/${start.f}, import ${background.r}/${background.f}, person ${personal.r}/${personal.f}`);

    // The route generation's contact signature skips its recompute while its inputs are unchanged
    // (modules/network/cache.ts): a status move keeps it; a new pursuit contact or affiliation moves it.
    const { revisionFor } = await import('../../modules/network/cache');
    const { withDb } = await import('../../lib/db');
    const generation = async () => (await withDb(db, () => revisionFor(db))).generation.split(':')[3];
    const g0 = await generation();
    await db.query(`update strategy.pursuit set status = 'discussing' where pursuit_id = $1`, [pursuit]);
    const g1 = await generation();
    await db.query(`insert into strategy.pursuit_contact (pursuit_id, person_entity, role, origin_pursuit_id, source)
      values ($1, $2, 'Invented contact', $1, 'us')`, [pursuit, person]);
    const g2 = await generation();
    await db.query(`delete from strategy.pursuit_contact where pursuit_id = $1`, [pursuit]);
    const g3 = await generation();
    await db.query(`update identity.affiliation set role = 'Invented partner', kind = 'principal', is_primary = true where person_entity = $1 and org_entity = $2`, [person, org]);
    const g4 = await generation();
    check('REVISIONS keep the contact signature through a status move and move it for a contact or affiliation',
      g0 === g1 && g2 !== g1 && g3 === g0 && g4 !== g3, `${g0} → move ${g1} → contact ${g2} → removed ${g3} → affiliation ${g4}`);

    if (db.kind === 'postgres' && process.env.DATABASE_URL) {
      // Two connections: a long writer to research notes and identities, and a status change meanwhile.
      const { openPostgres } = await import('../../lib/db/postgres');
      const other = await openPostgres(process.env.DATABASE_URL.replace(/\/[^/]+$/, '') + '/' + (await db.one<{ d: string }>('select current_database() d'))!.d, { max: 2 });
      try {
        let release!: () => void;
        const hold = new Promise<void>(resolve => { release = resolve; });
        let started!: () => void;
        const begun = new Promise<void>(resolve => { started = resolve; });
        const long = other.transaction(async tx => {
          await tx.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'context', 'Invented note', '{}')`, [org]);
          await tx.query(`update identity.entity set display_name = 'Invented Org 2' where entity_id = $1`, [org]);
          started();
          await hold;
        });
        await begun;
        const t = performance.now();
        await db.query(`update strategy.pursuit set status = 'connecting' where pursuit_id = $1`, [pursuit]);
        const waited = performance.now() - t;
        const during = await rev();
        release();
        await long;
        const end = await rev();
        const stamped = await db.one<{ revision: string }>(`select revision::text from network.route_changed_entity where entity_id = $1`, [org]);
        check('REVISIONS let a status change through while another transaction writes notes and identities',
          waited < 1000 && BigInt(end.read) > BigInt(during.read) && stamped?.revision === end.route && BigInt(end.route) > BigInt(during.route),
          `waited ${waited.toFixed(0)} ms; read ${during.read} → ${end.read}; org stamped ${stamped?.revision}, route ${end.route}`);

        // A committed stamp can equal a later transaction's id; that commit must not restamp it (network 018).
        const other2 = await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ('org', 'Invented Org 3') returning entity_id id`);
        let id!: string;
        await db.transaction(async tx => {
          id = (await tx.one<{ t: string }>('select txid_current()::text t'))!.t;
          await other.query(`update network.route_changed_entity set revision = $2 where entity_id = $1`, [other2!.id, id]);
          // Move the route revision past this id, as other commits do, so this commit's stamp differs from it.
          await other.query(`update network.route_revision set revision = revision + 1000 where singleton`);
          await tx.query(`update identity.entity set display_name = 'Invented Org 4' where entity_id = $1`, [org]);
        });
        const kept = await db.one<{ revision: string }>(`select revision::text from network.route_changed_entity where entity_id = $1`, [other2!.id]);
        check('REVISIONS restamp only the committing transaction\'s own changed entities',
          kept?.revision === id, `entity stamped ${id} before; after another commit ${kept?.revision}`);
      } finally { await other.close(); }
    }
  } finally { await db.close(); }
}
