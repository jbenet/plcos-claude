import { getDb, type Queryable } from '@/lib/db';
import type { AppUser } from './types';
import { appendAudit } from './repo';
import { AddressClash, AddressInvalid, ownerOfAddress, setAddresses, type AddressSet } from './addresses';

/**
 * The roster, as Settings → People changes it (docs/deploy/railway.md §3): this is how Google sign-in's
 * roster grows. Admins only (the actions say so); every change is an audit row. Two rules hold here, in the
 * transaction, whatever the page sent:
 *   - an email belongs to at most one active person, ignoring case;
 *   - the last active admin can be neither deactivated nor demoted.
 * Deactivating raises the person's session epoch (the trigger in migration 018).
 */
export type Access = 'admin' | 'team' | 'viewer';
export interface Person extends AppUser { active: boolean }

export class PeopleRefused extends Error {
  constructor(message: string) { super(message); this.name = 'PeopleRefused'; }
}

const COLUMNS = 'id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves, active';
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listPeople(q?: Queryable): Promise<Person[]> {
  const db = q ?? await getDb();
  return db.query<Person>(`select ${COLUMNS} from platform.app_user where email <> '' order by active desc, name`);
}

/** A free handle from an address's local part: alex, alex-2, … */
export async function freeHandle(q: Queryable, email: string): Promise<string> {
  const local = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  const taken = new Set((await q.query<{ handle: string }>(`select handle from platform.app_user where handle = $1 or handle like $1 || '-%'`, [local])).map((r) => r.handle));
  let handle = local;
  for (let i = 2; taken.has(handle); i++) handle = `${local}-${i}`;
  return handle;
}

const initialsOf = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w.length > 1 ? w[0]![0]! + w[w.length - 1]![0]! : (w[0] ?? 'P').slice(0, 2))).toUpperCase();
};

/** Serialize roster changes, so two admins demoting each other at once cannot leave none. */
async function lockRoster(tx: Queryable) {
  await tx.query(`select pg_advisory_xact_lock(4202610)`);
}

async function adminsLeft(tx: Queryable): Promise<number> {
  return (await tx.one<{ n: number }>(`select count(*)::int n from platform.app_user where active and access = 'admin' and email <> ''`))!.n;
}

async function checkVehicles(tx: Queryable, access: Access, vehicles: string[] | null): Promise<string[] | null> {
  // Admins see every vehicle; null means all.
  if (access === 'admin' || vehicles === null) return null;
  if (vehicles.some((v) => !UUID.test(v))) throw new PeopleRefused('An unknown vehicle was chosen.');
  const known = new Set((await tx.query<{ id: string }>(`select id::text from platform.vehicle`)).map((r) => r.id));
  if (vehicles.some((v) => !known.has(v))) throw new PeopleRefused('An unknown vehicle was chosen.');
  return [...new Set(vehicles)];
}

export interface NewPerson { name: string; email: string; access: Access; vehicles: string[] | null; role?: string }

export async function addPerson(actorId: string, input: NewPerson): Promise<Person> {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  const email = input.email.trim().toLowerCase();
  if (!name) throw new PeopleRefused('Give the person a name.');
  if (!EMAIL.test(email) || email.length > 254) throw new PeopleRefused('Give a full email address, like alex@example.org.');
  if (!['admin', 'team', 'viewer'].includes(input.access)) throw new PeopleRefused('Choose admin, team or viewer.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockRoster(tx);
    // Any of anyone's addresses (login, default-to, alias), active or not: an address names one person.
    const holder = await ownerOfAddress(email, tx);
    if (holder?.active) throw new PeopleRefused('Someone active already has that address.');
    if (holder) throw new PeopleRefused('A deactivated person has that address: reactivate them instead.');
    const vehicles = await checkVehicles(tx, input.access, input.vehicles);
    const handle = await freeHandle(tx, email);
    const role = (input.role ?? '').trim().slice(0, 80) || ({ admin: 'Admin', team: 'PLC Team', viewer: 'Viewer' } as const)[input.access];
    const person = (await tx.one<Person>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
      values ($1, $2, $3, $4, $5, $6::platform.access_role, $7::uuid[]) returning ${COLUMNS}`, [handle, name, initialsOf(name), role, email, input.access, vehicles]))!;
    await appendAudit({ actorId, action: 'people.added', subjectType: 'app_user', subjectId: person.id, detail: { access: input.access, vehicles: vehicles?.length ?? 'all' } }, tx);
    return person;
  });
}

export async function updatePerson(actorId: string, id: string, change: { access: Access; vehicles: string[] | null }): Promise<Person> {
  if (!UUID.test(id)) throw new PeopleRefused('Unknown person.');
  if (!['admin', 'team', 'viewer'].includes(change.access)) throw new PeopleRefused('Choose admin, team or viewer.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockRoster(tx);
    const before = await tx.one<Person>(`select ${COLUMNS} from platform.app_user where id = $1 and email <> ''`, [id]);
    if (!before) throw new PeopleRefused('Unknown person.');
    const vehicles = await checkVehicles(tx, change.access, change.vehicles);
    const after = (await tx.one<Person>(`update platform.app_user set access = $2::platform.access_role, vehicles = $3::uuid[] where id = $1 returning ${COLUMNS}`, [id, change.access, vehicles]))!;
    if (await adminsLeft(tx) === 0) throw new PeopleRefused('That would leave no active admin. Make someone else an admin first.');
    await appendAudit({ actorId, action: 'people.updated', subjectType: 'app_user', subjectId: id,
      detail: { from: { access: before.access, vehicles: before.vehicles?.length ?? 'all' }, to: { access: after.access, vehicles: after.vehicles?.length ?? 'all' } } }, tx);
    return after;
  });
}

export async function setPersonActive(actorId: string, id: string, active: boolean): Promise<Person> {
  if (!UUID.test(id)) throw new PeopleRefused('Unknown person.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockRoster(tx);
    const before = await tx.one<Person>(`select ${COLUMNS} from platform.app_user where id = $1 and email <> ''`, [id]);
    if (!before) throw new PeopleRefused('Unknown person.');
    if (active && !before.active) {
      const clash = await tx.one(`select 1 from platform.app_user where active and lower(email) = lower($1) and id <> $2`, [before.email, id]);
      if (clash) throw new PeopleRefused('Someone active already has that address.');
    }
    const after = (await tx.one<Person>(`update platform.app_user set active = $2 where id = $1 returning ${COLUMNS}`, [id, active]))!;
    if (await adminsLeft(tx) === 0) throw new PeopleRefused('That would leave no active admin. Make someone else an admin first.');
    if (before.active !== active) await appendAudit({ actorId, action: active ? 'people.reactivated' : 'people.deactivated', subjectType: 'app_user', subjectId: id, detail: {} }, tx);
    return after;
  });
}

/**
 * A person's addresses, exactly as given: the login (their Google sign-in), the default-to (what we email them
 * at; app_user.email follows it) and aliases. An address that belongs to someone else is refused, never moved.
 */
export async function updateAddresses(actorId: string, id: string, set: AddressSet): Promise<Person> {
  if (!UUID.test(id)) throw new PeopleRefused('Unknown person.');
  if (!set.default?.trim()) throw new PeopleRefused('Give a default-to address: it is the one we email them at.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockRoster(tx);
    const before = await tx.one<Person>(`select ${COLUMNS} from platform.app_user where id = $1`, [id]);
    if (!before) throw new PeopleRefused('Unknown person.');
    let applied: AddressSet;
    try { applied = await setAddresses(tx, id, set); }
    catch (e) { if (e instanceof AddressClash || e instanceof AddressInvalid) throw new PeopleRefused(e.message); throw e; }
    const after = (await tx.one<Person>(`select ${COLUMNS} from platform.app_user where id = $1`, [id]))!;
    await appendAudit({ actorId, action: 'people.addresses_updated', subjectType: 'app_user', subjectId: id,
      detail: { login: !!applied.login, defaultChanged: before.email.toLowerCase() !== after.email.toLowerCase(), aliases: applied.aliases.length } }, tx);
    return after;
  });
}
