/**
 * Page-cache warm-up after a data change (2 Oct 2026, Juan: "clicking a random LP can take a bit").
 *
 * Every write to the tables pages read (network.read_revision, network.route_revision) empties the
 * page caches: a vehicle's whole pipeline (pipelineData, ~1.2 s on live, which every LP page also
 * reads), the route signatures (~0.6 s) and the routes' identity topology. Before this, the first
 * person to open a page after any write paid for all of it. Now the server notices the change and,
 * once the data has stopped changing, opens its own main pages, so the rebuild happens before
 * anyone clicks. It also opens them once at start, which in `next dev` compiles those routes.
 *
 * It requests the pages over loopback rather than calling the loaders: Next loads this file
 * (through instrumentation.ts) as a separate module instance from the pages, so a loader called here
 * would fill a cache the pages never read (checked on a demo server, 2 Oct 2026). A request takes the
 * same path a click does, and a click during a warm-up joins the same in-flight work.
 *
 * Behind Google sign-in (5 Oct 2026) the requests carry a warm pass (lib/auth/warm.ts): minted here for the
 * oldest active admin just before a warm-up, good only for a loopback GET of the pages it lists, refused by
 * every write path, and revoked when the warm-up ends. Before setup, with no sign-in client, with no active
 * admin, or under LabOS, there is no one to warm as: it skips, says why once, and counts no failures. On the
 * Mac's user switcher nothing changes: no cookie, and the switcher's default person.
 *
 * Warming as an admin puts nothing admin-only where another person reads it:
 *   - the in-flight render sharing is keyed by the request's cookies and the principal's access and vehicles
 *     (lib/page-render.ts, shareRequestWork → renderKey), so a warm render is never handed to anyone else;
 *   - what a warm-up leaves behind are the buildCache memos (lib/build-cache.ts), keyed by their arguments (a
 *     vehicle id) and filled by loaders that never read the current user (pipelineData, strategyFor and
 *     assessmentsFor in lib/pipeline-data.ts; the network caches; routes-data's pickerInputs, whose listUsers()
 *     is the whole roster under Google sign-in). They hold unredacted rows, and every page reads them through
 *     the lib/authz/read facades, which redact per person after the cache without mutating it (for example
 *     lib/authz/read/pipeline.ts: "Redact after the shared cache"). A non-admin's scoped pages
 *     (lib/authz/read/scoped.tsx) read their own projections, which this does not warm.
 *
 * Reads only. Best effort and in-process: a failure is logged as a count and the pages still build on
 * demand. It waits while an import job is queued or running, since an import changes the data
 * continuously. PAGE_WARM=0 turns it off.
 */
import { getDb } from '@/lib/db';

// GUESS — how often to look (one small query) and the least time between two warm-ups, which bounds
// the extra rendering while someone edits records every few seconds. 15 Oct 2026: from 5 s and 30 s, so the pages a
// write emptied are rebuilt within about 2 s of it, usually before the person's next click, rather than 5–10 s later
// (and 30 s after a second write); a click during a warm-up shares its work.
export const WARM_POLL_MS = 1_000;
export const WARM_MIN_GAP_MS = 10_000;
// GUESS — a page that takes longer than this is abandoned; a person's click still builds it.
const PAGE_TIMEOUT_MS = 120_000;
// GUESS — how long the first warm-up waits for this server to start listening, and how often it tries.
const START_WAIT_MS = 30_000;
const START_RETRY_MS = 50;

export interface WarmState { seen: string | null; warmed: string | null; lastWarmAt: number; running: boolean; skipped?: string | null }
/** `foreground`: the part of the read revision only people's writes move (network 017), when known. */
export interface WarmObservation { revision: string; importActive: boolean; foreground?: string | null }

/**
 * What a warm-up answers to. With no import running, any change to the data. While one runs, the data changes all
 * the time, so only a person's own change (16 Oct 2026: imports ran for hours that night, and every page a person's
 * write emptied waited for their next click to rebuild it, 300-500 ms each). An import's own changes still wait: the
 * pages answer from their last build and rebuild behind them.
 */
export function warmKey(seen: WarmObservation): string | null {
  if (!seen.importActive) return seen.revision;
  return seen.foreground == null ? null : `person:${seen.foreground}`;
}

/**
 * Warm when the data has settled: the same revision on two looks in a row (at start, the first look), not yet warmed,
 * no import job active (or, while one is, a person's own change: warmKey), none in flight, and the last warm-up at
 * least WARM_MIN_GAP_MS ago.
 */
export function warmDecision(state: WarmState, seen: WarmObservation, now: number, minGapMs = WARM_MIN_GAP_MS): 'warm' | 'wait' {
  const key = warmKey(seen);
  if (state.running || key === null) return 'wait';
  // At start nothing is warm and nobody's change is in flight: the first look warms, rather than the second a second
  // later (17 Oct 2026: the start warm-up began about 1.7 s after the server was ready; it now begins as it answers).
  if (key !== state.seen && !(state.warmed === null && state.lastWarmAt === 0)) return 'wait';
  if (key === state.warmed) return 'wait';
  if (now - state.lastWarmAt < minGapMs) return 'wait';
  return 'warm';
}

/** The pages whose loads the others share: each active vehicle's pipeline and routes, and Today. Then each
 * vehicle's strategy and stats, which built their own caches on the first click after a write (1.0 s and 0.8 s cold on
 * the Mac's copy of the real data, 15 Oct 2026). */
export function warmPaths(slugs: string[], lpPath: string | null): string[] {
  return ['/today', ...slugs.flatMap((s) => [`/${s}/pipeline`, `/${s}/routes`]), ...slugs.flatMap((s) => [`/${s}/strategy`, `/${s}/stats`]),
    ...(lpPath ? [lpPath] : [])];
}

async function observe(): Promise<WarmObservation> {
  const db = await getDb();
  const row = (await db.one<{ revision: string; foreground: string; import_active: boolean }>(`select
      r.revision::text || ':' || rr.revision::text || ':' || rr.epoch::text || ':' || current_date::text as revision,
      r.foreground::text || ':' || current_date::text as foreground,
      exists (select 1 from platform.import_job where status in ('queued', 'running')) as import_active
    from network.read_revision r, network.route_revision rr where r.singleton and rr.singleton`))!;
  return { revision: row.revision, foreground: row.foreground, importActive: row.import_active };
}

async function targets(first: boolean): Promise<string[]> {
  const db = await getDb();
  // The vehicle with the most LPs first: its pages are the slowest to build and the most opened (17 Oct 2026: by slug,
  // the grants rail and the small SPVs were warmed before Neurotech's pipeline and routes, about 0.2 s of a 2.5 s pass).
  const slugs = (await db.query<{ slug: string }>(`select v.slug from platform.vehicle v where v.phase = 'active'
    order by (select count(*) from strategy.pursuit p where p.vehicle_id = v.id) desc, v.slug`)).map((r) => r.slug);
  // Once, at start: one LP page, so `next dev` compiles that route before the first click.
  let lp: string | null = null;
  if (first) {
    const row = await db.one<{ slug: string; id: string }>(`select v.slug, p.pursuit_id::text id from strategy.pursuit p
      join platform.vehicle v on v.id = p.vehicle_id where v.phase = 'active' order by p.opened_at desc limit 1`);
    if (row) lp = `/${row.slug}/pipeline/${row.id}`;
  }
  return warmPaths(slugs, lp);
}

/**
 * A page that redirects to sign-in or setup was not rendered, so it is not a failure and not a warm-up.
 * Where every page does (a deploy with sign-in, 5 Oct 2026: "14 failed" at each Railway boot), an
 * unsigned loopback request can warm nothing, and the warm-up stops instead of logging failures.
 */
export function needsSignIn(status: number, location: string | null): boolean {
  return status >= 300 && status < 400 && /^(https?:\/\/[^/]+)?\/(signin|setup)(\b|$)/.test(location ?? '');
}

/** Who the warm-up may request pages as: nobody needed (the switcher), a warm pass, or no one, and why. */
export type WarmAccess = { cookie: string | null } | { skip: string };

export async function warmAccess(paths: string[]): Promise<WarmAccess> {
  const { config } = await import('@/config/deployment');
  if (config.auth.provider === 'local') return { cookie: null };
  if (config.auth.provider === 'labos') return { skip: 'LabOS signs people in elsewhere, so a loopback request cannot be anyone' };
  const { settingsReady, googleConfigured } = await import('@/lib/settings/store');
  const { setupOpen } = await import('@/lib/settings/setup');
  await settingsReady();
  if (setupOpen()) return { skip: 'not set up yet (/setup is open)' };
  if (!googleConfigured()) return { skip: 'no Google sign-in client is configured' };
  const admin = await (await getDb()).one<{ id: string; epoch: number }>(`select u.id::text, u.session_epoch epoch from platform.app_user u
    where u.active and u.access = 'admin' and u.email <> '' order by u.created_at, u.id limit 1`);
  if (!admin) return { skip: 'no active admin to warm the pages as' };
  const { mintWarmPass, WARM_COOKIE } = await import('@/lib/auth/warm');
  return { cookie: `${WARM_COOKIE}=${encodeURIComponent(mintWarmPass({ id: admin.id, sessionEpoch: admin.epoch }, paths))}` };
}

export async function warm(port: string, paths: string[], cookie: string | null = null): Promise<{ ok: number; failed: number; signin: number }> {
  let ok = 0, failed = 0, signin = 0, answered = false;
  // One at a time: a warm-up must not crowd out a person's request.
  for (const path of paths) {
    // At start the first look can come before the server listens: until it first answers, a refused connection is
    // tried again shortly (up to START_WAIT_MS), not counted as a failure.
    for (let waited = 0; ; waited += START_RETRY_MS) {
      try {
        // The pass (when there is one) goes to this server's own loopback address and nowhere else.
        // The desktop app's copy answers only requests carrying its launch secret (proxy.ts, docs/31).
        const desktop = process.env.PLCOS_DESKTOP_SECRET;
        const headers: Record<string, string> = { ...(cookie ? { cookie } : {}), ...(desktop ? { 'x-plcos-desktop': desktop } : {}) };
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), redirect: 'manual', headers });
        answered = true;
        await res.arrayBuffer(); // the render finishes only when the stream is read
        if (res.ok) ok++; else if (needsSignIn(res.status, res.headers.get('location'))) signin++; else failed++;
      } catch (e) {
        const refused = (e as { cause?: { code?: string } })?.cause?.code === 'ECONNREFUSED';
        if (!answered && refused && waited < START_WAIT_MS) { await new Promise((r) => setTimeout(r, START_RETRY_MS)); continue; }
        failed++;
      }
      break;
    }
  }
  return { ok, failed, signin };
}

const g = globalThis as typeof globalThis & { __capitalOsPageWarm?: { timer: NodeJS.Timeout; state: WarmState } };

export function startPageWarm(): void {
  const port = process.env.PORT;
  if (!port || process.env.PAGE_WARM === '0' || g.__capitalOsPageWarm) return;
  const state: WarmState = { seen: null, warmed: null, lastWarmAt: 0, running: false };
  const tick = async () => {
    if (state.running) return;
    let seen: WarmObservation;
    try { seen = await observe(); } catch { return; } // database starting or busy: look again later
    const decision = warmDecision(state, seen, Date.now());
    state.seen = warmKey(seen);
    if (decision === 'wait') return;
    state.running = true;
    const first = state.warmed === null, started = performance.now();
    let skipped = false;
    try {
      const paths = await targets(first);
      const access = await warmAccess(paths);
      if ('skip' in access) {
        // Nobody to warm as yet: not a failure. Said once per reason; looked at again after the usual gap.
        skipped = true;
        if (state.skipped !== access.skip) console.log(`[warm] skipped: ${access.skip}`);
        state.skipped = access.skip;
        return;
      }
      state.skipped = null;
      const { ok, failed, signin } = await warm(port, paths, access.cookie);
      if (ok === 0 && signin > 0) {
        clearInterval(timer);
        console.log('[warm] off: pages here need a sign-in, so a loopback request cannot warm them');
        return;
      }
      console.log(`[warm] ${ok} page${ok === 1 ? '' : 's'} rebuilt in ${((performance.now() - started) / 1000).toFixed(1)} s ${first ? 'at start' : 'after a data change'}${failed ? `; ${failed} failed` : ''}`);
    } catch {
      console.log('[warm] skipped: the database could not be read');
    } finally {
      const { revokeWarmPass } = await import('@/lib/auth/warm');
      revokeWarmPass();
      if (!skipped) state.warmed = warmKey(seen);
      state.lastWarmAt = Date.now();
      state.running = false;
    }
  };
  const timer = setInterval(() => void tick(), WARM_POLL_MS);
  timer.unref();
  g.__capitalOsPageWarm = { timer, state };
  void tick(); // the first look now, not a poll later
}
