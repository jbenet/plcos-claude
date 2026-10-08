import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncGuard } from '../../lib/sync/auth';
import { SYNC_PUSH } from '../../lib/sync/scopes';
import { acceptPush } from '../../lib/sync/push';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * Retiring a strategy file by push (lib/sync/bundle.ts, isRetire), in a scratch enrich folder with invented files:
 * a W5 file `{ retire: true, reason }` removes the server's file at its path and keeps it under the push's replaced/;
 * a retire with no file there, without a reason or with other fields is refused with nothing removed.
 */
export async function syncRetireProperties(check: Check) {
  const db = await freshDb();
  const juan = (await db.one<AppUser>(`select id::text, handle, name, initials, role, email, access::text, vehicles, approves from platform.app_user where handle = 'juan'`))!;
  const token = await createMcpToken(juan, { label: 'props retire', tools: [SYNC_PUSH], vehicles: null, callsPerDay: 100, days: 30 }, db);
  const root = await mkdtemp(join(tmpdir(), 'plcos-retire-'));
  const enrich = join(root, 'enrich');
  await mkdir(join(enrich, 'strategy', 'rails'), { recursive: true });
  const kept = JSON.stringify({ invented: 'kept strategy' });
  await writeFile(join(enrich, 'strategy', 'rails', 'invented-retire-a.json'), kept);
  await writeFile(join(enrich, 'strategy', 'rails', 'invented-retire-b.json'), kept);
  let queued = 0;
  const push = async (body: unknown) => {
    const req = () => new Request('http://localhost:3119/api/sync/push', { method: 'POST', headers: { authorization: `Bearer ${token.secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const guard = await syncGuard(req(), 'push');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return acceptPush(guard.caller, req(), { root, db, queue: async () => { queued++; return { id: '00000000-0000-4000-8000-000000000000', status: 'queued' }; } }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const exists = (k: string) => readFile(join(enrich, 'strategy', 'rails', `${k}.json`), 'utf8').then(() => true, () => false);
  try {
    const missing = await push({ workflow: 'W5', files: [{ path: 'strategy/rails/invented-retire-none.json', content: { retire: true, reason: 'Invented duplicate' } }] });
    const noReason = await push({ workflow: 'W5', files: [{ path: 'strategy/rails/invented-retire-a.json', content: { retire: true } }] });
    const extra = await push({ workflow: 'W5', files: [{ path: 'strategy/rails/invented-retire-a.json', content: { retire: true, reason: 'Invented', next: {} } }] });
    const stillThere = await exists('invented-retire-a');
    const ok = await push({ workflow: 'W5', files: [{ path: 'strategy/rails/invented-retire-a.json', content: { retire: true, reason: 'Invented duplicate of b' } }] });
    const runs = await readdir(join(enrich, 'inbox')).catch(() => [] as string[]);
    const set = await Promise.all(runs.map((r) => readFile(join(enrich, 'inbox', r, 'replaced', 'strategy', 'rails', 'invented-retire-a.json'), 'utf8').catch(() => null)));
    check('SYNC retire: a retire with no server file, no reason or other fields is refused, nothing removed',
      missing.status === 422 && noReason.status === 422 && extra.status === 422 && stillThere,
      `${missing.status} ${noReason.status} ${extra.status}; still there ${stillThere}`);
    check('SYNC retire: a retire removes the strategy file, keeps it under replaced/, leaves its sibling, and queues the import',
      ok.status < 300 && !(await exists('invented-retire-a')) && await exists('invented-retire-b') && set.includes(kept) && queued === 1,
      `${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}; queued ${queued}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
