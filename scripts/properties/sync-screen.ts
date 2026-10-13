import { syncGuard } from '../../lib/sync/auth';
import { SYNC_ADMIN } from '../../lib/sync/scopes';
import { screenVehicle } from '../../lib/sync/screen';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * Screening a vehicle's field by token (lib/sync/screen.ts) on invented people: a dry run answers counts and
 * never a name; with add, the match goes on the vehicle as New through Add prospects and the rest stay off; a
 * rerun adds nothing; unknown fields and an unknown vehicle are refused.
 */
export async function syncScreenProperties(check: Check) {
  const db = await freshDb();
  const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
  const juan = (await db.one<AppUser>(`select ${sel} from platform.app_user where handle = 'juan'`))!;
  const admin = await createMcpToken(juan, { label: 'props screen', tools: [SYNC_ADMIN], vehicles: null, callsPerDay: 100, days: 30 }, db);
  const vehicle = (await db.one<{ id: string }>(`insert into platform.vehicle (slug, name, kind, exemption, phase)
    values ('spv-invented-screen', 'SPV - Invented Screen', 'spv', '506(c)', 'active') returning id::text`))!;
  const person = async (name: string, summary: string) => {
    const e = (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text id`, [name]))!;
    await db.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'public_profile', 'profile', $2::jsonb)`,
      [e.id, JSON.stringify({ profile: { summary, interests: [] } })]);
    return e.id;
  };
  const fit = await person('Invented Screen Fit', 'Angel investor in gene therapy and drug discovery companies.');
  const other = await person('Invented Screen Other', 'Collects vintage bicycles; invests in restaurants.');
  const call = async (body: unknown) => {
    const req = () => new Request('http://localhost:3119/api/sync/screen', { method: 'POST', headers: { authorization: `Bearer ${admin.secret}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const guard = await syncGuard(req(), 'screen');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return screenVehicle(guard.caller, req(), { db }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const terms = ['gene therap*', 'drug discovery'];
  const extra = await call({ vehicle: 'spv-invented-screen', terms, sneaky: 1 });
  const unknown = await call({ vehicle: 'spv-nowhere', terms });
  const dry = await call({ vehicle: 'spv-invented-screen', terms, minScore: 1 });
  const pursuits = async () => db.query<{ entity: string; status: string }>(
    'select entity_id::text entity, status::text from strategy.pursuit where vehicle_id = $1', [vehicle.id]);
  const afterDry = await pursuits();
  const added = await call({ vehicle: 'spv-invented-screen', terms, minScore: 1, add: true });
  const afterAdd = await pursuits();
  const again = await call({ vehicle: 'spv-invented-screen', terms, minScore: 1, add: true });
  const note = await db.one<{ body: string }>(`select body from research.note where entity_id = $1 and kind = 'context'`, [fit]);
  check('Screen by token: unknown fields and an unknown vehicle are refused; a dry run counts the match, names nobody and writes nothing',
    extra.status === 422 && unknown.status === 404 && dry.status === 200 && dry.body.matched === 1 && dry.body.chosen === 1
    && !JSON.stringify(dry.body).includes('Invented Screen') && afterDry.length === 0,
    `${extra.status} ${unknown.status} ${dry.status} ${JSON.stringify(dry.body).slice(0, 200)}`);
  check('Screen by token: add puts only the match on the vehicle as New with a reason, and a rerun adds nothing',
    added.status === 200 && added.body.added === 1 && afterAdd.length === 1 && afterAdd[0]!.entity === fit && afterAdd[0]!.status === 'new'
    && !afterAdd.some((p) => p.entity === other) && !!note?.body.includes('gene therap') && again.status === 200 && again.body.chosen === 0,
    `${added.status} ${JSON.stringify(added.body).slice(0, 200)}; ${afterAdd.length}; ${again.body.chosen}`);
}
