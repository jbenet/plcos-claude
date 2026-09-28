/**
 * npm run e2e: the basic actions, end to end, through the real pages and server actions (issue 0116).
 *
 * Juan, 28 Sep 2026, after moves on Selection failed for him on live: "This kind of stuff is basic
 * functionality and should be tested." This starts its own demo server on a free port (3150–3199, or
 * E2E_PORT) over a fresh demo database in data/demo/e2e, drives it with Playwright as the admin (juan)
 * and as a viewer, and checks every change in the database itself, not only on the page. PGlite is
 * single-process, so the database is read while the server is stopped: once at the restart the last
 * check needs anyway, and once at the end. The server's output goes to data/demo/e2e-server.log.
 *
 * Demo data only: it refuses DATA_PROFILE=real, never uses the live ports, and ignores DATABASE_URL.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { Db } from '../lib/db';

const ROOT = resolve(import.meta.dirname, '..');
process.chdir(ROOT);
if (process.env.DATA_PROFILE === 'real') {
  console.error('e2e: refusing DATA_PROFILE=real. It drives a demo server over invented data only.');
  process.exit(1);
}
const DIR = 'data/demo/e2e';
const LOG = 'data/demo/e2e-server.log';
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const VIEWER = 'e2e-viewer';
const MARK = `e2e ${Date.now().toString(36)}`;
// The launcher runs `next` by name, as npm run would find it.
const env: NodeJS.ProcessEnv = { ...process.env, DATA_PROFILE: 'demo', PGLITE_DIR: `./${DIR}`, PATH: `${join(ROOT, 'node_modules/.bin')}:${process.env.PATH ?? ''}` };
delete env.DATABASE_URL;
Object.assign(process.env, { DATA_PROFILE: 'demo', PGLITE_DIR: `./${DIR}` });
delete process.env.DATABASE_URL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e));

// ── The server ───────────────────────────────────────────────────────────────────────────────

/** Nothing answers on the port and it can be bound: the same test as scripts/serve.ts. */
async function free(port: number): Promise<boolean> {
  const answers = await new Promise<boolean>((done) => {
    const s = connect({ port, host: '127.0.0.1' });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); done(true); });
    s.once('timeout', () => { s.destroy(); done(false); });
    s.once('error', () => done(false));
  });
  if (answers) return false;
  return new Promise<boolean>((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.once('listening', () => srv.close(() => done(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function pickPort(): Promise<number> {
  const asked = Number(process.env.E2E_PORT || 0);
  if (asked) {
    if (asked < 3150 || asked > 3199) throw new Error('E2E_PORT must be in 3150–3199, away from the live and dev servers.');
    if (!(await free(asked))) throw new Error(`Port ${asked} is in use.`);
    return asked;
  }
  for (let p = 3150; p <= 3199; p++) if (await free(p)) return p;
  throw new Error('No free port in 3150–3199.');
}

let server: ChildProcess | null = null;
let port = 0;
let base = '';

async function startServer() {
  const out = createWriteStream(LOG, { flags: 'a' });
  // Its own process group, so stopping it stops Next and its workers with it.
  server = spawn(TSX, ['scripts/serve.ts', 'demo'], { cwd: ROOT, env: { ...env, PORT: String(port) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.pipe(out);
  server.stderr!.pipe(out);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The demo server exited (${server.exitCode}); see ${LOG}.`);
    try {
      const res = await fetch(`${base}/api/profile`);
      if (res.ok) {
        const { profile } = (await res.json()) as { profile?: string };
        if (profile !== 'demo') throw new Error(`${base} serves the ${profile} profile, not the demo.`);
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('not the demo')) throw e;
    }
    await sleep(300);
  }
  throw new Error(`The demo server did not answer within 2 minutes; see ${LOG}.`);
}

async function stopServer() {
  const s = server;
  server = null;
  if (!s?.pid || s.exitCode !== null || s.signalCode !== null) return;
  const gone = new Promise((r) => s.once('exit', r));
  try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ }
  await Promise.race([gone, sleep(10_000)]);
  if (s.exitCode === null && s.signalCode === null) {
    try { process.kill(-s.pid, 'SIGKILL'); } catch { /* already gone */ }
    await gone;
  }
  // Next's own workers belong to the group; wait for the port and the database lock to be let go.
  const { lockHolder } = await import('../lib/db/lock');
  for (let i = 0; i < 100; i++) {
    if ((await free(port)) && !(await lockHolder(DIR))) return;
    await sleep(100);
  }
  throw new Error(`The demo server on :${port} did not let go of the port or ${DIR}.`);
}

/** The demo database, opened while the server is stopped (PGlite is single-process). */
async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const { openPglite } = await import('../lib/db/pglite');
  const db = await openPglite(DIR);
  try { return await work(db); } finally { await db.close(); }
}

// ── Checks ───────────────────────────────────────────────────────────────────────────────────

type Verify = (db: Db) => Promise<void>;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const toVerify: Array<{ name: string; ui: string; verify: Verify }> = [];
const serverErrors: string[] = [];
const order: string[] = [];

/** One check: the UI part now, the database part at the next stop. A 5xx anywhere fails it. */
async function check(name: string, run: () => Promise<{ ui: string; verify: Verify }>) {
  order.push(name);
  const errorsBefore = serverErrors.length;
  const t = Date.now();
  try {
    const { ui, verify } = await run();
    const errs = serverErrors.slice(errorsBefore);
    if (errs.length) throw new Error(`the server answered ${errs.join('; ')}`);
    toVerify.push({ name, ui: `${ui} (${((Date.now() - t) / 1000).toFixed(1)} s)`, verify });
  } catch (e) {
    results.push({ name, ok: false, detail: `page: ${message(e)}` });
  }
}

async function verifyAll() {
  await withDb(async (db) => {
    for (const c of toVerify.splice(0)) {
      try {
        await c.verify(db);
        results.push({ name: c.name, ok: true, detail: `${c.ui}; the database agrees` });
      } catch (e) {
        results.push({ name: c.name, ok: false, detail: `${c.ui}; database: ${message(e)}` });
      }
    }
  });
}

function same(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

let since = '';
const statusOf = async (db: Db, id: string) =>
  (await db.one<{ s: string }>('select status::text s from strategy.pursuit where pursuit_id = $1', [id]))?.s;
/** The status changes written for a pursuit during this run, in order: "sourcing>selected,…", with who. */
const movesOf = async (db: Db, id: string) =>
  (await db.query<{ m: string }>(`select concat(applied->'status'->>'from', '>', applied->'status'->>'to', ' by ', a.handle) m
     from strategy.pursuit_update u join platform.app_user a on a.id = u.created_by
     where u.pursuit_id = $1 and u.created_at > $2::timestamptz and u.applied ? 'status' order by u.created_at, u.update_id`, [id, since])).map((r) => r.m);

interface Lp { id: string; name: string; status: string; entityId: string }

// ── Page helpers ─────────────────────────────────────────────────────────────────────────────

const row = (page: Page, id: string) => page.locator(`tr[data-lp="${id}"]`);
const selectionTray = (page: Page) => page.locator('section[aria-label="Actions on the LP in focus or the ticked LPs"]').first();
const pipelineTray = (page: Page) => page.locator('section[aria-label="Actions on the selected LPs"]').first();
const toast = (page: Page, text: string | RegExp) => page.locator('[role="status"]', { hasText: text }).first();

async function openSelection(page: Page, query = '') {
  await page.goto(`${base}/all/selection${query}`, { waitUntil: 'networkidle' });
}

/** Put an LP in focus on Selection: click its row, and wait for the panel to name it. */
async function focusRow(page: Page, lp: Lp) {
  await row(page, lp.id).locator('td').nth(1).click();
  await selectionTray(page).locator('h3', { hasText: lp.name }).waitFor();
}

async function visible(l: Locator, ms = 1500) {
  try { await l.waitFor({ timeout: ms }); return true; } catch { return false; }
}

/**
 * The dev server's socket (/_next/hmr) is passed through until the restart, then cut: a page that
 * reconnects to the new server is told it restarted and reloads itself, which would hide the
 * stale-page case (issue 0116). A page left open on a sleeping iPad does not get that message either.
 * Turbopack's pages need the socket to run, so it cannot simply be blocked from the start.
 */
let hmrLive = true;
async function watch(ctx: BrowserContext) {
  await ctx.routeWebSocket(/\/_next\/(webpack-)?hmr/, (ws) => { if (hmrLive) ws.connectToServer(); /* else accepted, silent */ });
  ctx.setDefaultTimeout(30_000);
  ctx.on('response', (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} for ${new URL(r.url()).pathname}`); });
}

// ── The run ──────────────────────────────────────────────────────────────────────────────────

async function main() {
  const started = Date.now();
  port = await pickPort();
  base = `http://localhost:${port}`;

  // A fresh demo database: the seed, plus a viewer and one individual moved back to New, since the
  // seed's New and Sourcing rows are all firms. Both are invented and live only in data/demo/e2e.
  await rm(DIR, { recursive: true, force: true });
  await rm(`${DIR}.lock`, { force: true });
  await rm(LOG, { force: true });
  const reset = spawnSync(TSX, ['scripts/reset.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (reset.status !== 0) throw new Error(`Seeding the demo database failed: ${(reset.stderr || reset.stdout).slice(-400)}`);
  const lp = await withDb(async (db) => {
    await db.query(`insert into platform.app_user (handle, name, initials, role, email, access)
      values ($1, 'Vera Viewer', 'VV', 'Viewer (e2e)', 'viewer@example.invalid', 'viewer')`, [VIEWER]);
    const all = await db.query<Lp & { type: string }>(`select p.pursuit_id::text id, e.display_name name, p.status::text status,
        p.entity_id::text "entityId", e.entity_type::text type
      from strategy.active_pursuit p join identity.entity e on e.entity_id = p.entity_id
      order by e.display_name, p.pursuit_id`);
    const orgs = all.filter((r) => r.type === 'org' && (r.status === 'new' || r.status === 'sourcing'));
    const selected = all.filter((r) => r.status === 'selected');
    const person = all.find((r) => r.type === 'person' && ['selected', 'connecting', 'discussing'].includes(r.status) && !selected.slice(0, 3).includes(r));
    const page = all.find((r) => r.status === 'discussing' && r !== person);
    if (orgs.length < 5 || selected.length < 3 || !person || !page) throw new Error('The demo seed no longer has the LPs these checks need (5 firms at New or Sourcing, 3 at Selected, an individual, one at Discussing).');
    await db.query(`update strategy.pursuit set status = 'new' where pursuit_id = $1`, [person.id]);
    person.status = 'new';
    since = (await db.one<{ t: string }>(`select coalesce(max(created_at), 'epoch')::text t from strategy.pursuit_update`))!.t;
    return { org: [orgs[0]!, orgs[1]!, orgs[2]!, orgs[3]!, orgs[4]!] as const, person, pipe: [selected[0]!, selected[1]!, selected[2]!] as const, page };
  });
  const [o1, o2, o3, o4, o5] = lp.org;
  const [p1, p2, p3] = lp.pipe;
  console.log(`e2e: demo server on :${port}, database ${DIR}, prepared in ${((Date.now() - started) / 1000).toFixed(0)} s`);

  let browser: Browser | null = null;
  try {
    await startServer();
    browser = await chromium.launch();
    const admin = await browser.newContext({ viewport: { width: 1440, height: 940 } });
    const viewer = await browser.newContext({ viewport: { width: 1440, height: 940 } });
    await admin.addCookies([{ name: `capitalos_${port}_user`, value: 'juan', url: base }]);
    await viewer.addCookies([{ name: `capitalos_${port}_user`, value: VIEWER, url: base }]);
    await watch(admin);
    await watch(viewer);
    const page = await admin.newPage();

    // Selection ────────────────────────────────────────────────────────────────────────────
    await check('Selection: move one firm to Selected', async () => {
      await openSelection(page);
      await focusRow(page, o1);
      await selectionTray(page).getByRole('button', { name: /^Move to Selected/ }).click();
      await toast(page, `Moved ${o1.name} to Selected`).waitFor();
      await row(page, o1.id).waitFor({ state: 'detached' });
      return { ui: 'the receipt showed and the row left New/Sourcing', verify: async (db) => {
        same(await statusOf(db, o1.id), 'selected', `${o1.name}'s status`);
        same(await movesOf(db, o1.id), [`${o1.status}>selected by juan`], `${o1.name}'s status changes`);
      } };
    });

    await check('Selection: move an individual and a firm together, then Undo', async () => {
      await openSelection(page);
      for (const x of [lp.person, o2]) await row(page, x.id).locator('input[type="checkbox"]').check();
      await selectionTray(page).getByRole('button', { name: /^Move 2 to Selected/ }).click();
      await toast(page, 'Moved 2 LPs to Selected').waitFor();
      await page.getByRole('button', { name: /^Undo/ }).click();
      await toast(page, /2 LPs back to/).waitFor();
      await row(page, lp.person.id).waitFor();
      return { ui: 'moved 2, then Undo put both back on the page', verify: async (db) => {
        for (const x of [lp.person, o2]) {
          same(await statusOf(db, x.id), x.status, `${x.name}'s status`);
          same(await movesOf(db, x.id), [`${x.status}>selected by juan`, `selected>${x.status} by juan`], `${x.name}'s status changes`);
        }
      } };
    });

    const trayNote = `${MARK}: set from the Selection tray`;
    await check('Selection: "Set status" from the tray, with a note', async () => {
      await openSelection(page);
      await focusRow(page, o3);
      const tray = selectionTray(page);
      await tray.getByRole('button', { name: 'Set status' }).click();
      await tray.locator('select').first().selectOption('connecting');
      await tray.locator('textarea[name="body"]').fill(trayNote);
      await tray.getByRole('button', { name: 'Apply to 1' }).click();
      await toast(page, `Moved ${o3.name} to Connecting`).waitFor();
      return { ui: 'the tray saved and offered Undo', verify: async (db) => {
        same(await statusOf(db, o3.id), 'connecting', `${o3.name}'s status`);
        same(await movesOf(db, o3.id), [`${o3.status}>connecting by juan`], `${o3.name}'s status changes`);
        same((await db.one<{ n: number }>('select count(*)::int n from strategy.pursuit_update where pursuit_id = $1 and body = $2', [o3.id, trayNote]))?.n, 1, 'updates carrying the note');
      } };
    });

    await check('Selection: the score reasons load for the LP in focus', async () => {
      await openSelection(page, '?status=all&sort=score&dir=desc');
      const first = page.locator('tr[data-lp]').first();
      const id = (await first.getAttribute('data-lp'))!;
      await first.locator('td').nth(1).click();
      const why = page.locator('aside').getByText('Reading what the score rests on…');
      await why.waitFor({ state: 'detached' });
      if (await visible(page.getByText('The reasons could not be read'), 300)) throw new Error('the panel says the reasons could not be read');
      const text = (await page.locator('aside').innerText()).replace(/\s+/g, ' ');
      if (!/Capacity|fit|No strategy or fit assessment/i.test(text)) throw new Error(`the panel shows no reasons: "${text.slice(0, 160)}"`);
      return { ui: 'the reasons panel loaded, with no failure message', verify: async (db) => {
        same(await movesOf(db, id), [], 'status changes from reading the reasons');
      } };
    });

    // Pipeline ─────────────────────────────────────────────────────────────────────────────
    const setStatusInPipeline = async (rows: Lp[], to: string) => {
      await page.goto(`${base}/all/pipeline?status=all`, { waitUntil: 'networkidle' });
      for (const x of rows) await row(page, x.id).locator('input[type="checkbox"]').check();
      const tray = pipelineTray(page);
      await tray.getByRole('button', { name: 'Set status' }).click();
      await tray.locator('select').first().selectOption(to);
      await tray.getByRole('button', { name: `Apply to ${rows.length}` }).click();
      await tray.locator('[role="status"]', { hasText: `${rows.length} saved` }).waitFor();
    };

    await check("Pipeline: change one LP's status", async () => {
      await setStatusInPipeline([p1], 'connecting');
      return { ui: 'the tray said 1 saved', verify: async (db) => {
        same(await statusOf(db, p1.id), 'connecting', `${p1.name}'s status`);
        same(await movesOf(db, p1.id), ['selected>connecting by juan'], `${p1.name}'s status changes`);
      } };
    });

    await check('Pipeline: bulk status on two LPs, then Undo', async () => {
      await setStatusInPipeline([p2, p3], 'connecting');
      await toast(page, 'Moved 2 LPs to Connecting').waitFor();
      await page.getByRole('button', { name: /^Undo/ }).click();
      await toast(page, /2 LPs back to Selected/).waitFor();
      return { ui: 'the tray said 2 saved, and Undo put both back', verify: async (db) => {
        for (const x of [p2, p3]) {
          same(await statusOf(db, x.id), 'selected', `${x.name}'s status`);
          same(await movesOf(db, x.id), ['selected>connecting by juan', 'connecting>selected by juan'], `${x.name}'s status changes`);
        }
      } };
    });

    // The LP page ──────────────────────────────────────────────────────────────────────────
    const target = lp.page;
    await check('LP page: opens', async () => {
      const res = await page.goto(`${base}/targets/${target.id}`, { waitUntil: 'networkidle' });
      if (!res || res.status() !== 200) throw new Error(`answered ${res?.status()}`);
      await page.locator('h1', { hasText: target.name }).first().waitFor();
      if (!page.url().includes(`/pipeline/${target.id}`)) throw new Error(`landed on ${new URL(page.url()).pathname}`);
      return { ui: `200 at ${new URL(page.url()).pathname.replace(target.id, '<id>')}, named in the heading`, verify: async (db) => {
        same(await statusOf(db, target.id), target.status, `${target.name}'s status`);
      } };
    });

    const updateText = `Noted for the record (${MARK})`;
    await check('LP page: add an update', async () => {
      const box = page.getByPlaceholder("Add an update: what happened, what changed, what's next");
      await box.fill(updateText);
      // The words carry no status, touchpoint or next step, so nothing else is ticked.
      await page.getByRole('button', { name: 'Save update' }).click();
      // Saved: the box empties, and the words show on the timeline (outside the box).
      await page.waitForFunction((b) => (b as HTMLTextAreaElement).value === '', await box.elementHandle());
      await page.locator('.tl-row:not(.updbox)', { hasText: updateText }).first().waitFor();
      return { ui: 'saved, cleared and shown on the timeline', verify: async (db) => {
        same((await db.one<{ n: number }>('select count(*)::int n from strategy.pursuit_update where pursuit_id = $1 and body = $2', [target.id, updateText]))?.n, 1, 'updates with that text');
        same(await statusOf(db, target.id), target.status, `${target.name}'s status`);
      } };
    });

    const touchText = `Call about reporting (${MARK})`;
    await check('LP page: log a touchpoint', async () => {
      await page.getByRole('radio', { name: /Log a touchpoint/ }).click();
      const box = page.locator('textarea[aria-label="What happened"]');
      const form = page.locator('form', { has: box });
      await box.fill(touchText);
      await form.getByRole('button', { name: 'Log it' }).click();
      await form.getByText('Logged', { exact: true }).waitFor();
      return { ui: 'the form said Logged', verify: async (db) => {
        same((await db.one<{ n: number }>('select count(*)::int n from meetings.meeting where pursuit_id = $1 and summary = $2', [target.id, touchText]))?.n, 1, 'touchpoints with that summary');
      } };
    });

    const contextText = `Context from the team (${MARK})`;
    await check('LP page: add context (a note)', async () => {
      await page.getByLabel('Context or a correction').fill(contextText);
      await page.getByRole('button', { name: 'Add it' }).click();
      await page.getByText('Added. The strategy below is due a re-think.').waitFor();
      return { ui: 'the card said Added', verify: async (db) => {
        same((await db.one<{ n: number }>(`select count(*)::int n from research.note where entity_id = $1 and kind = 'context' and body = $2`, [target.entityId, contextText]))?.n, 1, 'context notes with that text');
      } };
    });

    // A viewer ─────────────────────────────────────────────────────────────────────────────
    await check("A viewer's Selection offers no changes", async () => {
      const v = await viewer.newPage();
      await openSelection(v);
      await v.getByText('limited access', { exact: false }).first().waitFor();
      const controls = await v.getByRole('button', { name: /to Selected|Set status|Undo/ }).count() + await v.locator('tr input[type="checkbox"]').count();
      if (controls) throw new Error(`${controls} change controls are on a viewer's page`);
      await v.close();
      return { ui: 'the limited view, with no move, status or tick controls', verify: async () => { /* nothing to change */ } };
    });

    // A viewer can still reach an action: a page opened as someone else, then the switcher (another
    // tab) changes who this browser is. The server decides, and has to say so.
    await check("A viewer's move is refused with a clear message", async () => {
      await viewer.addCookies([{ name: `capitalos_${port}_user`, value: 'juan', url: base }]);
      const v = await viewer.newPage();
      await openSelection(v);
      await focusRow(v, o4);
      await viewer.addCookies([{ name: `capitalos_${port}_user`, value: VIEWER, url: base }]);
      await selectionTray(v).getByRole('button', { name: /^Move to Selected/ }).click();
      // Either the refusal page (lib/authz/server.ts redirects there) or a message in the panel.
      const denied = v.getByText('No change was made', { exact: false });
      const inline = selectionTray(v).locator('[role="alert"]').first();
      await Promise.race([denied.waitFor(), inline.waitFor()]);
      const said = (await visible(denied, 100))
        ? `${new URL(v.url()).pathname}: ${(await v.locator('main[role="alert"]').first().innerText()).replace(/\s+/g, ' ')}`
        : await inline.innerText();
      if (!/refused|not allowed|permission|access|No change/i.test(said)) throw new Error(`the message does not say it was refused: "${said.slice(0, 160)}"`);
      await v.close();
      return { ui: `said "${said.slice(0, 90)}"`, verify: async (db) => {
        same(await statusOf(db, o4.id), o4.status, `${o4.name}'s status`);
        same((await db.one<{ n: number }>(`select count(*)::int n from strategy.pursuit_update u join platform.app_user a on a.id = u.created_by where a.handle = $1`, [VIEWER]))?.n, 0, "the viewer's updates");
      } };
    });

    // A page loaded before a restart (issue 0116) ────────────────────────────────────────────
    // Every status is shown, so the LP stays on the page once it is Selected. The page settles first
    // (its dev socket connected, no request in flight), so the restart finds it idle, as on an iPad.
    const stale = await admin.newPage();
    const trace: string[] = [];
    let T = Date.now();
    const note = (what: string) => trace.push(`+${Date.now() - T} ms ${what}`);
    let inFlight = 0, quietSince = Date.now();
    const settled = () => { inFlight = Math.max(0, inFlight - 1); quietSince = Date.now(); };
    stale.on('request', (r) => { inFlight++; if (r.isNavigationRequest()) note(`load ${new URL(r.url()).pathname}`); });
    stale.on('requestfinished', settled);
    stale.on('requestfailed', (r) => { settled(); note(`failed ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`); });
    stale.on('response', (r) => { if (r.request().method() === 'POST' || r.status() >= 400) note(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
    stale.on('console', (m) => { if (m.type() === 'error') note(`console: ${m.text().slice(0, 120)}`); });
    const hmr = stale.waitForEvent('console', { predicate: (m) => m.text().includes('[HMR] connected'), timeout: 15_000 }).catch(() => undefined);
    await openSelection(stale, `?status=all&lp=${o5.id}`);
    await selectionTray(stale).locator('h3', { hasText: o5.name }).waitFor();
    await hmr;
    for (const until = Date.now() + 15_000; (inFlight > 0 || Date.now() - quietSince < 1000) && Date.now() < until;) await sleep(100);
    const loadedAt = await stale.evaluate(() => performance.timeOrigin);

    hmrLive = false;
    await stopServer();
    await verifyAll();
    await startServer();

    await check('A page loaded before a server restart: the move works, or the page reloads and the retry works', async () => {
      const button = selectionTray(stale).getByRole('button', { name: /^(Move to Selected|Already Selected)/ });
      const moved = toast(stale, `Moved ${o5.name} to Selected`);
      const reloaded = async () => (await stale.evaluate(() => performance.timeOrigin).catch(() => -1)) !== loadedAt;
      trace.length = 0;
      T = Date.now();
      await button.click();
      // Moved, or reloaded (a new document), within 30 s; a page stuck on "Moving…" is the 0116 failure.
      let how = '';
      for (const until = Date.now() + 30_000; !how && Date.now() < until; await sleep(200)) {
        if (await visible(moved, 50)) how = 'the first try moved it';
        else if (await reloaded()) how = 'reloaded';
      }
      if (!how) {
        const panel = (await selectionTray(stale).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        throw new Error(`after 30 s it had neither moved nor reloaded. Panel: "${panel}". Seen: ${trace.filter((t) => !t.includes('/api/')).slice(0, 8).join(' | ') || 'nothing'}`);
      }
      if (how === 'reloaded') {
        await stale.waitForLoadState('networkidle');
        await selectionTray(stale).locator('h3', { hasText: o5.name }).waitFor();
        // The first try may have been saved before the page gave up waiting: then it is Selected already.
        if (/Move to Selected/.test(await button.innerText())) {
          await button.click();
          await moved.waitFor();
          how = 'the page reloaded itself and the retry moved it';
        } else how = 'the page reloaded itself and showed the first try saved';
      }
      return { ui: `${how}, ${((Date.now() - T) / 1000).toFixed(0)} s after the click`, verify: async (db) => {
        same(await statusOf(db, o5.id), 'selected', `${o5.name}'s status`);
        same(await movesOf(db, o5.id), [`${o5.status}>selected by juan`], `${o5.name}'s status changes`);
      } };
    });

    await browser.close();
    browser = null;
    await stopServer();
    await verifyAll();
  } finally {
    await browser?.close().catch(() => undefined);
    await stopServer().catch(() => undefined);
  }

  results.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} checks pass, in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  if (failed.length) {
    console.log(`The server's output is in ${LOG}.`);
    process.exit(1);
  }
}

main().catch(async (e: unknown) => {
  console.error(`e2e: ${e instanceof Error ? e.stack : String(e)}`);
  await stopServer().catch(() => undefined);
  process.exit(1);
});
