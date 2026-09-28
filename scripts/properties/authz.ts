import { can, AuthorizationError, type Principal, type Action, type FieldClass } from '../../lib/authz';
import { withRoute } from '../../lib/authz/route';
import { withDb } from '../../lib/db';
import { authorizeAction } from '../../lib/authz/server';
import { routeRules } from '../../lib/authz/route-rules';
import { actionRules, type ActionId } from '../../lib/authz/rules';
import { authorizationCoverage, checkAuthorizationSource } from '../authz-coverage';
import { projectPipeline } from '../../lib/authz/read/projection';
import type { Check, Db } from './harness';
import { validate as validateInit, upsertTeamMember } from '../../lib/real/init';

export async function authzProperties(check: Check, db: Db) {
  const admin: Principal = { access: 'admin', vehicles: [] };
  const gp: Principal = { access: 'gp', vehicles: null };
  const scoped: Principal = { access: 'gp', vehicles: ['a'], approves: ['STAGE'] };
  const viewer: Principal = { access: 'viewer', vehicles: null };
  const fields: FieldClass[] = ['R1','R2','R3','R4'];
  const writes: Action[] = ['mutate','admin','approve'];
  check('Authz: Viewer cannot perform domain mutations, including ticket decisions',
    writes.every(action => !can(viewer, action, { vehicle: 'a', ticketKind: 'STAGE' })), 'all three mutation families refused');
  check('Authz: GP scope is explicit, null means all, empty means none, unknown scope fails closed',
    can(scoped, 'mutate', { vehicle: 'a' }) && !can(scoped, 'mutate', { vehicle: 'b' }) && !can(scoped, 'mutate')
    && !can(scoped, 'mutate', { vehicle: ['a','b'] }) && !can({ ...gp, vehicles: [] }, 'read', { vehicle: 'a' })
    && can(gp, 'mutate', { vehicle: 'b' }), 'single, multi-vehicle, omitted, empty and all-vehicle scopes checked');
  check('Authz: R1–R4 are absent for Viewer; R3 is Admin-only even for all-vehicle GPs',
    fields.every(fieldClass => !can(viewer, 'read', { vehicle: 'a', fieldClass }))
    && fields.every(fieldClass => can(admin, 'read', { fieldClass }))
    && (['read','mutate','admin','approve','feedback','session'] as Action[]).every(action => !can(gp, action, { fieldClass: 'R3' }))
    && ['R1','R2','R4'].every(fieldClass => can(scoped, 'read', { vehicle: 'a', fieldClass: fieldClass as FieldClass })), 'field matrix checked separately from action permissions');
  check('Authz: administrative controls and approvals fail closed; feedback remains available to every role',
    !can(gp, 'admin') && !can(gp, 'approve', { vehicle: 'a', ticketKind: 'STAGE' })
    && can(scoped, 'approve', { vehicle: 'a', ticketKind: 'STAGE' })
    && !can(scoped, 'approve', { vehicle: 'b', ticketKind: 'STAGE' })
    && [admin, gp, viewer].every(u => can(u, 'feedback'))
    && !can(null, 'mutate') && !can({ access: 'unknown', vehicles: null } as unknown as Principal, 'read'), 'no unknown or missing principal gains permission');

  let feedbackDbCalls = 0;
  const unavailable = new Proxy(db, { get(target, key, receiver) {
    if (key === 'query' || key === 'one' || key === 'transaction') return () => { feedbackDbCalls++; throw new Error('Database unavailable'); };
    return Reflect.get(target, key, receiver);
  } });
  const feedbackRoutes = Object.keys(routeRules).filter(name => routeRules[name as keyof typeof routeRules] === 'feedback') as Array<keyof typeof routeRules>;
  const feedbackResponses = await withDb(unavailable, () => Promise.all(feedbackRoutes.map(name => {
    const method = name.endsWith('#POST') ? 'POST' : 'GET';
    return withRoute(name, async () => Response.json({ journalReady: true }))(new Request('http://localhost:3211/api/feedback', {
      method, headers: { origin: 'http://localhost:3211', 'sec-fetch-site': 'same-origin' },
    }));
  })));
  check('Authz: both feedback route policies run while the database is unavailable, without a roster lookup',
    feedbackResponses.every(response => response.status === 200) && feedbackDbCalls === 0,
    'Both POST and GET policies passed with a database that throws on any call; reporter lookup remains at ingest.');

  const coverage = await authorizationCoverage();
  check('Authz: every server action and HTTP handler has its registered authorization wrapper',
    coverage.violations.length === 0 && coverage.actions === Object.keys(actionRules).length && coverage.routes === Object.keys(routeRules).length + 1,
    `${coverage.actions} actions, ${coverage.routes} handlers; ${coverage.violations.join('; ') || 'no gaps'}`);
  const path = 'app/targets/actions.ts', key = `${path}#setPursuitStatus`;
  const head = "'use server'; import { requireAction } from '@/lib/authz/server';";
  const invalid = [
    `${head} export async function setPursuitStatus(f: FormData) { /* await requireAction('${key}', f); */ }`,
    `${head} export async function setPursuitStatus(f: FormData) { mutate(); await requireAction('${key}', f); }`,
    `${head} export async function setPursuitStatus(f: FormData) { await requireAction('${key}', other); mutate(f); }`,
    `${head} export const setPursuitStatus = async () => {};`,
    `${head} export { setPursuitStatus } from './unguarded';`,
    `${head} export async function setPursuitStatus(f: FormData) { await requireAction('wrong', f); }`,
  ];
  check('Authz: boundary rejects comments, late checks, unwrapped arrows, re-exports and wrong policy IDs',
    invalid.every(src => checkAuthorizationSource(path, src).violations.length > 0)
    && checkAuthorizationSource(path, `${head} export async function setPursuitStatus(f: FormData) { await requireAction('${key}', f); mutate(); }`).violations.length === 0,
    'six bypass fixtures rejected; real first-statement guard accepted');
  check('Authz: boundary rejects unwrapped routes and inline server directives',
    checkAuthorizationSource('app/api/session/route.ts', 'export async function POST() { return Response.json({}); }').violations.length > 0
    && checkAuthorizationSource('app/api/fixture/route.js', 'export async function POST() { mutate(); }').violations.length > 0
    && checkAuthorizationSource('app/fixture/page.tsx', `export default function Page() { async function act() { 'use server'; mutate(); } }`).violations.length > 0,
    'alternate entry-point forms cannot silently bypass coverage');

  const roster = (extra: Record<string, unknown>) => validateInit({ team: [{ handle: 'invented', name: 'Invented', ...extra }], vehicles: [{ slug: 'invented', name: 'Invented', kind: 'fund', exemption: '506(c)' }] });
  check('Authz: roster grants validate role, explicit vehicle UUID scope and permitted approval kinds',
    roster({ access: 'viewer', vehicles: [], approves: [] }).init?.team[0]?.access === 'viewer'
    && roster({ access: 'gp', vehicles: null, approves: ['STAGE'] }).init?.team[0]?.vehicles === null
    && !roster({ access: 'root' }).init && !roster({ vehicles: ['not-a-uuid'] }).init && !roster({ approves: ['MONEY'] }).init,
    'omitted grants preserve compatibility; invalid grants fail before any roster write');
  const users = await db.query<{ id: string; handle: string; access: string; vehicles: string[] | null }>('select id::text, handle, access::text, vehicles from platform.app_user where active');
  check('Authz: migration and fictional roster seed Juan as Admin and the team as GP with all vehicles',
    users.find(u => u.handle === 'juan')?.access === 'admin'
    && users.filter(u => ['mara','sam','ines','tomas'].includes(u.handle)).every(u => u.access === 'gp' && u.vehicles === null),
    'existing free-text job titles remain separate from access roles');
  const actor = users.find(u => u.handle === 'juan')!.id;
  const member = { handle: 'invented-roster-grants', name: 'Invented roster grants', initials: 'IR', role: 'Invented title', email: 'fixture@example.test', affinityEmail: null, linearEmail: null };
  try {
    await upsertTeamMember(db, { ...member, access: 'viewer', vehicles: [], approves: [] });
    await upsertTeamMember(db, member);
    const retained = await db.one<{ access: string; vehicles: string[] }>('select access::text,vehicles from platform.app_user where handle=$1', [member.handle]);
    await upsertTeamMember(db, { ...member, access: 'gp', vehicles: null, approves: ['STAGE'] });
    const changed = await db.one<{ access: string; vehicles: string[] | null; approves: string[] }>('select access::text,vehicles,approves from platform.app_user where handle=$1', [member.handle]);
    check('Authz: roster reload preserves omitted grants and applies deliberate access changes',
      retained?.access === 'viewer' && retained.vehicles.length === 0 && changed?.access === 'gp' && changed.vehicles === null && changed.approves.join(',') === 'STAGE',
      'Viewer/no vehicles survives an old-format reload; explicit GP/all/approver update takes effect');
  } finally { await db.query('delete from platform.app_user where handle=$1', [member.handle]); }
  const principal = { ...gp, id: actor };
  const refuses = async (u: Principal, name: ActionId, ...args: unknown[]) => {
    try { await authorizeAction({ ...u, id: actor }, name, args, db); return false; }
    catch (e) { if (e instanceof AuthorizationError) return true; throw e; }
  };
  const ids = Object.keys(actionRules) as ActionId[];
  let refused = 0;
  for (const name of ids.filter(n => actionRules[n].action !== 'read')) if (await refuses(viewer, name)) refused++;
  check('Authz: Viewer is refused by every actual mutating action manifest before target lookup',
    refused === ids.filter(n => actionRules[n].action !== 'read').length, `${refused} mutating entry points refused`);

  const pursuits = await db.query<{ id: string; vehicle: string; entity: string }>('select pursuit_id::text id, entity_id::text entity, vehicle_id::text vehicle from strategy.active_pursuit order by vehicle_id, pursuit_id');
  const a = pursuits[0]!, b = pursuits.find(p => p.vehicle !== a.vehicle)!;
  const limited = { ...principal, vehicles: [a.vehicle] };
  const form = (data: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
  await authorizeAction(limited, 'app/targets/actions.ts#setPursuitStatus', [form({ pursuitId: a.id })], db);
  check('Authz: forged vehicle field cannot authorize a pursuit on another vehicle',
    await refuses(limited, 'app/targets/actions.ts#setPursuitStatus', form({ pursuitId: b.id, vehicleId: a.vehicle })), 'allowed pursuit succeeds; a foreign target with allowed metadata is refused');
  await authorizeAction(limited, 'app/targets/actions.ts#addContextAction', [form({ pursuitId: a.id, entityId: a.entity, vehicleId: a.vehicle })], db);
  await authorizeAction(limited, 'app/targets/actions.ts#logTouchpointAction', [form({ pursuitId: a.id, entityId: a.entity, vehicleId: a.vehicle, vehicle: 'this' })], db);
  check('Authz: scoped context/touch edits work only on persisted entity/vehicle pairs; global event edits need all vehicles',
    await refuses(limited, 'app/targets/actions.ts#addContextAction', form({ pursuitId: b.id, entityId: b.entity, vehicleId: a.vehicle }))
    && await refuses(limited, 'app/targets/actions.ts#addContextAction', form({ pursuitId: a.id, entityId: a.entity }))
    && await refuses(limited, 'app/targets/actions.ts#logTouchpointAction', form({ pursuitId: a.id, entityId: a.entity, vehicleId: a.vehicle, vehicle: 'all' })),
    'allowed context and touchpoint succeeded; forged, unlabelled and global changes refused');
  check('Authz: mixed bulk selection checks every persisted target before mutations',
    await refuses(limited, 'app/targets/bulk-actions.ts#bulkLpAction', { rows: [{ id: a.id, vehicleId: a.vehicle }, { id: b.id, vehicleId: a.vehicle }] }),
    'forged row metadata cannot narrow the second target');
  const exp = await db.one<{ id: string; vehicle: string }>('select exposure_id::text id, vehicle_id::text vehicle from pipeline.exposure limit 1');
  check('Authz: exposure permission comes from the exposure, not the supplied pursuit or vehicle',
    !!exp && await refuses({ ...principal, vehicles: [exp.vehicle === a.vehicle ? b.vehicle : a.vehicle] }, 'app/soft-hard/actions.ts#requestHarden', form({ exposureId: exp.id, pursuitId: a.id, vehicleId: a.vehicle })),
    'foreign exposure cannot be hardened by scoped GP');
  const conflict = await db.one<{ id: string; a: string; b: string }>(`select c.case_id::text id, a.vehicle_id::text a, b.vehicle_id::text b
    from coordination.conflict_case c join coordination.ask a on a.ask_id=c.claimant_a join coordination.ask b on b.ask_id=c.claimant_b where a.vehicle_id<>b.vehicle_id limit 1`);
  if (conflict) {
    check('Authz: collision adjudication requires both vehicles',
      await refuses({ ...principal, vehicles: [conflict.a] }, 'app/approvals/actions.ts#adjudicate', form({ caseId: conflict.id })), 'one-sided vehicle grant refused');
    await authorizeAction({ ...principal, vehicles: [conflict.a, conflict.b] }, 'app/approvals/actions.ts#adjudicate', [form({ caseId: conflict.id })], db);
  }
  const note = { id: 'note', entityId: 'entity', author: 'Invented author', at: '2026-09-28', body: 'R2 secret' };
  const record = { id: 'p1', entityId: 'entity', name: 'Invented LP', vehicleId: 'a', vehicle: 'A', owner: 'Invented owner', status: 'discussing', restricted: true, amount: 123456, reason: 'R4 secret', dakota: 'R3 secret' };
  const view = projectPipeline({ ...viewer, vehicles: ['a'] }, [record, { ...record, id: 'p2', vehicleId: 'b', vehicle: 'B' }], [note]);
  const serialized = JSON.stringify(view);
  check('Authz: Viewer projection is an allowlist preserving note metadata and cross-vehicle/restriction presence',
    !serialized.includes('secret') && !serialized.includes('123456') && view.rows.length === 1 && view.notes.length === 1
    && view.outsideScope === 1 && view.overlaps.length === 1 && view.rows[0]!.restricted,
    'extra source keys cannot leak; note author/date, restriction and overlap remain visible');
  check('Authz: display projection does not mutate cached raw records',
    record.amount === 123456 && note.body === 'R2 secret', 'shared input remains intact for the next authorized reader');
}
