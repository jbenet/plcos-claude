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
 * Reads only. Best effort and in-process: a failure is logged as a count and the pages still build on
 * demand. It waits while an import job is queued or running, since an import changes the data
 * continuously. PAGE_WARM=0 turns it off.
 */
import { getDb } from '@/lib/db';

// GUESS — how often to look (one small query) and the least time between two warm-ups, which bounds
// the extra rendering while someone edits records every few seconds.
export const WARM_POLL_MS = 5_000;
export const WARM_MIN_GAP_MS = 30_000;
// GUESS — a page that takes longer than this is abandoned; a person's click still builds it.
const PAGE_TIMEOUT_MS = 120_000;

export interface WarmState { seen: string | null; warmed: string | null; lastWarmAt: number; running: boolean }
export interface WarmObservation { revision: string; importActive: boolean }

/**
 * Warm when the data has settled: the same revision on two looks in a row, not yet warmed, no import
 * job active, none in flight, and the last warm-up at least WARM_MIN_GAP_MS ago.
 */
export function warmDecision(state: WarmState, seen: WarmObservation, now: number, minGapMs = WARM_MIN_GAP_MS): 'warm' | 'wait' {
  if (state.running || seen.importActive) return 'wait';
  if (seen.revision !== state.seen) return 'wait';
  if (seen.revision === state.warmed) return 'wait';
  if (now - state.lastWarmAt < minGapMs) return 'wait';
  return 'warm';
}

/** The pages whose loads the others share: each active vehicle's pipeline and routes, and Today. */
export function warmPaths(slugs: string[], lpPath: string | null): string[] {
  return ['/today', ...slugs.flatMap((s) => [`/${s}/pipeline`, `/${s}/routes`]), ...(lpPath ? [lpPath] : [])];
}

async function observe(): Promise<WarmObservation> {
  const db = await getDb();
  const row = (await db.one<{ revision: string; import_active: boolean }>(`select
      r.revision::text || ':' || rr.revision::text || ':' || rr.epoch::text || ':' || current_date::text as revision,
      exists (select 1 from platform.import_job where status in ('queued', 'running')) as import_active
    from network.read_revision r, network.route_revision rr where r.singleton and rr.singleton`))!;
  return { revision: row.revision, importActive: row.import_active };
}

async function targets(first: boolean): Promise<string[]> {
  const db = await getDb();
  const slugs = (await db.query<{ slug: string }>(`select slug from platform.vehicle where phase = 'active' order by slug`)).map((r) => r.slug);
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

async function warm(port: string, paths: string[]): Promise<{ ok: number; failed: number; signin: number }> {
  let ok = 0, failed = 0, signin = 0;
  // One at a time: a warm-up must not crowd out a person's request.
  for (const path of paths) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), redirect: 'manual' });
      await res.arrayBuffer(); // the render finishes only when the stream is read
      if (res.ok) ok++; else if (needsSignIn(res.status, res.headers.get('location'))) signin++; else failed++;
    } catch { failed++; }
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
    state.seen = seen.revision;
    if (decision === 'wait') return;
    state.running = true;
    const first = state.warmed === null, started = performance.now();
    try {
      const { ok, failed, signin } = await warm(port, await targets(first));
      if (ok === 0 && signin > 0) {
        clearInterval(timer);
        console.log('[warm] off: pages here need a sign-in, so a loopback request cannot warm them');
        return;
      }
      console.log(`[warm] ${ok} page${ok === 1 ? '' : 's'} rebuilt in ${((performance.now() - started) / 1000).toFixed(1)} s ${first ? 'at start' : 'after a data change'}${failed ? `; ${failed} failed` : ''}`);
    } catch {
      console.log('[warm] skipped: the database could not be read');
    } finally {
      state.warmed = seen.revision;
      state.lastWarmAt = Date.now();
      state.running = false;
    }
  };
  const timer = setInterval(() => void tick(), WARM_POLL_MS);
  timer.unref();
  g.__capitalOsPageWarm = { timer, state };
}
