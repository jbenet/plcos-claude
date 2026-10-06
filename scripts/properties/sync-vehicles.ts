import { syncGuard } from '../../lib/sync/auth';
import { SYNC_PUSH, SYNC_VEHICLES } from '../../lib/sync/scopes';
import { addVehicle } from '../../lib/sync/vehicles';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * Adding a vehicle by token (lib/sync/vehicles.ts) on invented vehicles: an Admin's sync:vehicles token adds
 * one through createVehicle; a Team member cannot hold the scope; a push-only token is refused; a taken slug
 * and unknown fields are refused with nothing written; every call is audited.
 */
export async function syncVehiclesProperties(check: Check) {
  const db = await freshDb();
  const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
  const juan = (await db.one<AppUser>(`select ${sel} from platform.app_user where handle = 'juan'`))!;
  const gp = (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ('vehicles-gp', 'Invented vehicles-gp', 'IV', 'Invented (props)', 'vehicles-gp@example.invalid', 'team', null)
    on conflict (handle) do update set active = true returning ${sel}`))!;
  const mint = (owner: AppUser, tools: string[]) => createMcpToken(owner, { label: 'props vehicles', tools, vehicles: null, callsPerDay: 100, days: 30 }, db);
  const admin = await mint(juan, [SYNC_PUSH, SYNC_VEHICLES]), pushOnly = await mint(juan, [SYNC_PUSH]);
  let teamRefused = false;
  try { await mint(gp, [SYNC_PUSH, SYNC_VEHICLES]); } catch { teamRefused = true; }
  const call = async (secret: string, body: unknown) => {
    const req = () => new Request('http://localhost:3119/api/sync/vehicles', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const guard = await syncGuard(req(), 'vehicles');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return addVehicle(guard.caller, req(), { db }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const v = { name: 'SPV - Invented Props', slug: 'spv-invented-props', kind: 'spv', exemption: '506(c)', phase: 'active', aliases: ['Invented Props'] };
  const count = async () => (await db.one<{ n: number }>("select count(*)::int n from platform.vehicle where slug like 'spv-invented-props%'"))!.n;
  const byPush = await call(pushOnly.secret, v);
  const extra = await call(admin.secret, { ...v, sneaky: true });
  const notJson = await call(admin.secret, '{');
  const noExemption = await call(admin.secret, { ...v, exemption: undefined });
  const before = await count();
  const made = await call(admin.secret, v);
  const again = await call(admin.secret, v);
  const sameName = await call(admin.secret, { ...v, slug: 'spv-invented-props-2' });
  const row = await db.one<{ kind: string; exemption: string; phase: string }>("select kind::text, exemption, phase from platform.vehicle where slug = 'spv-invented-props'");
  const audit = await db.query<{ detail: Record<string, any> }>(`select detail from platform.audit_log where action = 'mcp.call' and subject_id = $1 order by id`, [admin.token.tokenId]);
  const created = await db.one<{ n: number }>("select count(*)::int n from platform.audit_log where action = 'vehicle.created' and detail->>'slug' = 'spv-invented-props'");
  check('Vehicles by token: a Team member cannot hold the scope; a push-only token, unknown fields, bad JSON and a missing exemption are refused, nothing written',
    teamRefused && byPush.status === 403 && extra.status === 422 && notJson.status === 400 && noExemption.status === 409 && before === 0,
    `${teamRefused} ${byPush.status} ${extra.status} ${notJson.status} ${noExemption.status}; ${before} written`);
  check('Vehicles by token: an Admin\'s token adds one through createVehicle, and a taken slug or name is refused, never updated',
    made.status === 201 && made.body.slug === 'spv-invented-props' && again.status === 409 && sameName.status === 409 && (await count()) === 1
    && row?.kind === 'spv' && row.exemption === '506(c)' && row.phase === 'active' && created?.n === 1,
    `${made.status} ${again.status} ${sameName.status}`);
  check('Vehicles by token: every call is audited as the token\'s',
    audit.length === 6 && audit.every((a) => a.detail.via === 'sync') && audit.some((a) => a.detail.outcome === 'ok'), `${audit.length} audit rows`);
}
