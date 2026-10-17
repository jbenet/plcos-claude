// The desktop app's local copy (docs/31 §3): the live server's own build, running on this Mac against a Postgres
// replica that is synced down from the server. The core sends reads here when this copy can answer them and every
// write to the live server.
//
//   1. Download the server's build (GET /api/desktop/build) when the server runs a commit we don't have, and
//      install its runtime dependencies once per lockfile.
//   2. Make the database's schema with that build's own migrations (scripts/desktop-migrate.ts).
//   3. Sync rows down (GET /api/desktop/sync): only tables whose change counters moved, only rows changed since the
//      last horizon, deletions found by count then by key.
//   4. Run the build (`next start`) on loopback with the preview rules and PLCOS_DESKTOP_COPY=1.
//
// Every step can fail without breaking the app: the core then sends everything to the live server.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const env = process.env;
const NEXT_PORT = Number(env.PLCOS_DESKTOP_LOCAL_PORT || 47101);
const PG_PORT = Number(env.PLCOS_DESKTOP_PG_PORT || 57435);
const DB_NAME = 'plcos_desktop';
/** Rows per request (the server caps it at 20,000), and tables copied at once. */
const PAGE = Number(env.PLCOS_DESKTOP_PAGE || 10_000);
/** Rows per run when checking a table that is already here against the server's digest. */
const DIGEST_RUN = 5000;
/**
 * A sync page's fields parsed, its rows left as JSON text (remoteRows), or null when the text is not in the server's
 * shape: {"ok":true,…fields…,"n":N,…,"rows":[…]} with the rows last. A literal ,"rows":[ cannot occur inside a JSON
 * string (its quotes are escaped), so the first one is the field.
 */
/** A build's folder name under builds/: a plain name (a commit), or null, so `../..` cannot leave the folder. */
export function buildName(s) {
  return typeof s === 'string' && /^[0-9A-Za-z][0-9A-Za-z_-]{0,63}$/.test(s) ? s : null;
}

export function splitRowsPage(text) {
  if (!text.startsWith('{"ok":true,') || !text.endsWith(']}')) return null;
  const cut = text.indexOf(',"rows":[');
  if (cut < 0) return null;
  try {
    const fields = JSON.parse(`${text.slice(0, cut)}}`);
    return Number.isInteger(fields.n) ? { ...fields, rows: text.slice(cut + 8, -1) } : null;
  } catch { return null; }
}

/** Rows in a page from remoteRows: an array, or the rows' JSON text with the server's count beside it. */
const rowCount = (page) => (typeof page.rows === 'string' ? page.n : page.rows.length);
const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
const quoteTable = (t) => t.split('.').map(quoteIdent).join('.');
/** Never seeded from this Mac: what the server's sync never sends either (people's secrets, migration bookkeeping). */
const SEED_SKIP = new Set(['platform.migration', 'platform.person_secret']);
/** The server's stand-ins (lib/desktop/sync.ts), so a seeded row hashes like the server's. */
const SEED_STAND_IN = {
  'platform.setting': { value: `case when "secret" then 'withheld' else "value" end` },
  'platform.mcp_token': { token_hash: `encode(sha256(convert_to('withheld:' || "token_id"::text, 'UTF8')), 'hex')` },
};
/** Tables that sync in the background once the copy is whole; any table whose sync takes longer joins them. */
const SLOW_TABLES = ['network.route_cache'];
const SLOW_TABLE_MS = 20_000;
const TABLES_AT_ONCE = Number(env.PLCOS_DESKTOP_TABLES_AT_ONCE || 4);
/**
 * Reads go to the live server for this long after a write (docs/31). Postgres's change counters lagged up to 10 s until
 * every write asked its backend to flush them at once (lib/db/postgres.ts, 15 Oct 2026): now the sync that starts right
 * after the write sees it.
 */
const WRITE_SETTLE_MS = Number(env.PLCOS_DESKTOP_SETTLE_MS || 1_000);
// GUESS — the pages rebuilt after a sync that changed something, and the most time that may take before reads resume.
const RECENT_PAGES = 8;
const WARM_RECENT_MS = 15_000;
const IDLE_SYNC_MS = 15_000;
const BUSY_SYNC_MS = 2_000;
/** Paths the live server always answers: sign-in, the app's own pages, server state (jobs, Astra, imports). */
// Server actions that only read, by file#export (16 Oct 2026). A POST, so it still goes to the live server, but it is
// not a write the copy must catch up with: counted as one, it sent every page after it to the live server until the
// next sync. Selection's score detail was the one; it is now a GET the copy answers itself (app/selection/detail).
const READ_ACTIONS = new Set([]);
const REMOTE_ONLY = [/^\/settings(\/|$)/, /^\/preferences(\/|$)/, /^\/api\//, /^\/auth\//, /^\/signin/, /^\/setup/, /^\/desktop\//, /^\/dev(\/|$)/, /^\/developer(\/|$)/, /^\/issues(\/|$)/, /^\/agents(\/|$)/];

const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 15 * 60_000, ...opts }, (err, stdout, stderr) => {
    if (err) { err.message = `${cmd} ${args[0] ?? ''}: ${String(stderr || err.message).slice(-800)}`; reject(err); } else resolve(String(stdout));
  });
});

export async function startLocal(ctx) {
  const copy = new LocalCopy(ctx);
  copy.loop();
  return copy.api();
}

class LocalCopy {
  constructor({ state, log, refreshInfo, remoteFetch, DATA_DIR, settings = {} }) {
    Object.assign(this, { state, log, refreshInfo, remoteFetch, dir: DATA_DIR, settings });
    this.phase = 'waiting';           // waiting | preparing | syncing | ready | off | error
    this.detail = 'Waiting for sign-in';
    this.build = null;                // { commit, dir }
    this.next = null;                 // the next start child
    this.pg = null;                   // pg.Pool on the local database
    this.pgManaged = !env.PLCOS_DESKTOP_DATABASE_URL;
    // The copy's Postgres trusts whoever connects, so it listens on no port, only on a socket in its own folder, which
    // only this Mac's user can open. On 127.0.0.1 any process or account on the Mac could read and change the whole
    // copy as superuser, with no password (red-team pass, 17 Oct 2026). A folder whose socket path would pass the
    // system's 103-character limit puts the socket in this user's own temporary folder instead.
    const pgDir = path.join(DATA_DIR, 'pg');
    this.pgSocket = `${pgDir}/.s.PGSQL.${PG_PORT}`.length <= 100 ? pgDir : path.join(os.tmpdir(), 'plcos-pg');
    // localhost with `?host=<socket folder>`: node-pg and psql both take the folder from it, and the build's own checks
    // (config/deployment.ts, scripts/desktop-migrate.ts) accept a loopback name with only that parameter.
    this.dbUrl = env.PLCOS_DESKTOP_DATABASE_URL || `postgres://plcos@localhost:${PG_PORT}/${DB_NAME}?host=${encodeURIComponent(this.pgSocket)}`;
    this.secret = randomBytes(24).toString('hex');
    this.cookiePrefix = `capitalos_real_${NEXT_PORT}_`;
    this.origin = `http://127.0.0.1:${NEXT_PORT}`;
    this.lastWriteAt = 0;
    this.hadCopy = false;               // a whole copy was made here once (then slow tables never block)
    this.slow = new Set(SLOW_TABLES);   // tables that sync in the background once the copy is whole
    this.background = new Set();         // those syncing in the background now
    this.lastSyncStartedAt = 0;
    this.lastSyncFinishedAt = 0;
    this.settledFor = 0;              // the write (lastWriteAt) the copy has caught up with
    this.serverForeground = null;     // the server's foreground revision while this copy holds an older one
    // The last pages this person opened, newest first, to rebuild after a change; kept on disk, so a relaunch (or the
    // server's new build) rebuilds them before the first click rather than after it (15 Oct 2026: 1.9 s cold LP page).
    this.recentFile = path.join(this.dir, 'recent-pages.json');
    try { this.recent = JSON.parse(readFileSync(this.recentFile, 'utf8')).filter((x) => typeof x === 'string').slice(0, RECENT_PAGES); } catch { this.recent = []; }
    this.lastSync = null;             // { at, ms, tables, rows, deleted }
    this.serverCommit = null;
    this.wake = null;
    this.stopped = false;
    this.failures = 0;
    this.meta = new Map();            // table → { counter, since }
  }

  api() {
    return {
      origin: this.origin,
      cookiePrefix: this.cookiePrefix,
      secret: this.secret,
      ready: () => this.phase === 'ready',
      canServe: (url, req) => this.canServe(url, req),
      readsOnly: (actionId) => this.readActionIds().has(actionId),
      onWrite: () => { this.lastWriteAt = Date.now(); this.poke(); },
      onSignedIn: () => this.poke(),
      onSignedOut: () => { this.phase = 'waiting'; this.detail = 'Waiting for sign-in'; },
      syncNow: () => this.poke(),
      status: () => ({
        phase: this.phase, detail: this.detail, build: this.build?.commit ?? null, serverCommit: this.serverCommit,
        lastSync: this.lastSync, settling: this.settling(), tables: this.meta.size,
      }),
      stop: () => this.stop(),
    };
  }

  /**
   * A slow table catching up in the background (route_cache: 7,000 rows of 60 KB, all rewritten whenever identity
   * changes, 16 Oct 2026) waits between pages while the person is clicking, so its download and writes do not compete
   * with the page they asked for. GUESS: two seconds since the last page; a minute at most, so it still finishes.
   */
  async yieldToPerson() {
    const until = Date.now() + 60_000;
    while (Date.now() - (this.lastPageAt ?? 0) < 2_000 && Date.now() < until && !this.stopped) await new Promise((r) => setTimeout(r, 250));
  }

  /** The ids of READ_ACTIONS in this build (Next names server actions by a hash per build), read once per build. */
  readActionIds() {
    const dir = this.build?.dir;
    if (this.readIds?.dir === dir) return this.readIds.ids;
    let ids = new Set();
    try {
      const m = JSON.parse(readFileSync(path.join(dir, '.next/server/server-reference-manifest.json'), 'utf8'));
      ids = new Set(Object.entries(m.node ?? {}).filter(([, v]) => READ_ACTIONS.has(`${v.filename}#${v.exportedName}`)).map(([id]) => id));
    } catch { /* no build yet: every POST counts as a write */ }
    this.readIds = { dir, ids };
    return ids;
  }

  /** After a write, until a sync that started once the write had settled has finished (the pages are rebuilt after). */
  settling() { return this.lastWriteAt > 0 && this.settledFor !== this.lastWriteAt; }

  canServe(url, req) {
    // A page opened, not one fetched ahead of a hover (Next marks those next-router-prefetch).
    // A JSON read a page makes (a row's basis, Selection's score detail) is the person at work, not a page to rebuild.
    if (req?.method === 'GET' && !req.headers?.['next-router-prefetch']) {
      if (!String(req.headers?.accept ?? '').startsWith('application/json')) this.remember(url);
      // Not the window's own polling (/api/import-jobs every 2 s while it is open): that would hold a slow table's
      // catch-up at its longest wait for as long as the window is open.
      if (!url.pathname.startsWith('/_next/') && !url.pathname.startsWith('/api/')) this.lastPageAt = Date.now();
    }
    if (this.phase !== 'ready') return false;
    // A new build on the server: this one keeps answering, with the data it was built for, while the new one downloads
    // (about 8 s), and stops only to be replaced (16 Oct 2026). Sending pages to the server meanwhile reached a build that
    // had just started and had built nothing yet, and mixed two builds in one window. Its own changes still go there.
    if (this.serverCommit && this.build?.commit !== this.serverCommit && !this.next) return false;
    if (this.settling()) return false;
    return !REMOTE_ONLY.some((r) => r.test(url.pathname));
  }

  /** A page (or its in-app navigation, `_rsc`) the person opened; files, Next's own assets and the API are not pages. */
  remember(url) {
    const p = url.pathname;
    if (p.startsWith('/_next/') || p.startsWith('/api/') || p.startsWith('/__desktop') || /\.[a-z0-9]+$/i.test(p)) return;
    const q = new URLSearchParams(url.search);
    q.delete('_rsc');
    const page = q.size ? `${p}?${q}` : p;
    const next = [page, ...this.recent.filter((x) => x !== page)].slice(0, RECENT_PAGES);
    if (next.join('\n') !== this.recent.join('\n')) { this.recent = next; try { writeFileSync(this.recentFile, JSON.stringify(next)); } catch { /* best effort */ } }
  }

  /**
   * Rebuild the pages this person opened last, right after a sync brought changes. A change empties the copy's page
   * caches, and the next click paid for the rebuild (1 s on a strategy page, 15 Oct 2026); now this does, one page at
   * a time, and a click meanwhile joins the same work. The server's own warm-up (lib/page-warm.ts) still covers the
   * main pages once the data has stopped changing.
   */
  async warmRecent() {
    const until = Date.now() + WARM_RECENT_MS;
    for (const page of this.recent) {
      const left = until - Date.now();
      if (left <= 0 || this.stopped) return;
      try {
        const res = await fetch(`${this.origin}${page}`, { headers: { 'x-plcos-desktop': this.secret }, redirect: 'manual', signal: AbortSignal.timeout(left) });
        await res.arrayBuffer();
      } catch { /* a click still builds it */ }
    }
  }

  async foreground() {
    return (await this.pg.query('select foreground::text f from network.read_revision where singleton')).rows[0]?.f ?? null;
  }

  async holdForeground(value) {
    await this.pg.query('update network.read_revision set foreground = $1::bigint where singleton and foreground <> $1::bigint', [value]);
  }

  poke() { const w = this.wake; this.wake = null; w?.(); }
  sleep(ms) { return new Promise((r) => { const t = setTimeout(() => { this.wake = null; r(); }, ms); this.wake = () => { clearTimeout(t); r(); }; }); }

  async loop() {
    while (!this.stopped) {
      const syncedBefore = this.lastSyncStartedAt;
      try {
        await this.tick();
        this.failures = 0;
      } catch (e) {
        this.failures++;
        this.log('local copy:', String(e?.stack ?? e).slice(0, 1500));
        this.detail = String(e?.message ?? e).slice(0, 300);
        if (this.phase !== 'ready') this.phase = 'error';
        // Back off, doubling, from 30 s to 30 min (JuanMail: give up on tight retries).
        await this.sleep(Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, this.failures - 1)));
        continue;
      }
      // A write made while that sync ran is caught up by the next one, at once: the poke at the write found the loop busy,
      // and waiting the usual two seconds kept reads on the live server that long (15 Oct 2026).
      const behind = this.settling() && this.phase === 'ready' && this.lastSyncStartedAt !== syncedBefore && this.lastWriteAt >= this.lastSyncStartedAt;
      await this.sleep(behind ? 0 : this.settling() || this.phase !== 'ready' ? BUSY_SYNC_MS : IDLE_SYNC_MS);
    }
  }

  async tick() {
    const { state } = this;
    if (!state.session || !state.user) { this.phase = 'waiting'; this.detail = 'Waiting for sign-in'; return; }
    if (state.user.access !== 'admin') { this.phase = 'off'; this.detail = 'The local copy holds the whole database, so it is for Admins; this app uses the live server.'; return; }
    if (env.PLCOS_DESKTOP_NO_COPY) { this.phase = 'off'; this.detail = 'Turned off (PLCOS_DESKTOP_NO_COPY).'; return; }

    const syncStarted = Date.now();
    const st = await this.remoteJson('/api/desktop/sync?op=state');
    this.serverCommit = st.commit ?? state.remote?.commit ?? null;
    if (!this.build || (this.serverCommit && this.build.commit !== this.serverCommit)) {
      if (this.phase === 'ready') this.log('the server runs', this.serverCommit, '— updating the local copy from', this.build?.commit);
      await this.prepare(this.serverCommit);
      // A new build may bring new tables: read state again after its migrations.
      return;
    }
    this.lastSyncStartedAt = syncStarted;
    // The write this sync catches up with: one made at least a settle (less a second) before it started.
    const write = this.lastWriteAt;
    const catchesUp = write > 0 && syncStarted >= write + WRITE_SETTLE_MS - 1000;
    const t0 = Date.now();
    // Someone else's change (a colleague, an agent, an import on the server) arrives here as a new read revision and,
    // through the server's own foreground revision, would rebuild the page caches before this person's next click
    // (0.3–0.6 s on a vehicle's pages, 15 Oct 2026). Unless a write of this person's own is being caught up, the
    // foreground stays where it was: the copy answers from its last build at once and rebuilds behind it, as the
    // server does for its import workers (lib/build-cache.ts), and the change shows a rebuild later.
    const own = write > 0 && this.settledFor < write;
    const heldForeground = this.phase === 'ready' && !own ? await this.foreground().catch(() => null) : null;
    const r = await this.sync(st);
    const holdFailed = (e) => this.log('foreground hold:', String(e?.message ?? e).slice(0, 200));
    // Held only if no write of this person's was made while the sync ran: that write may be in what it brought.
    if (heldForeground !== null && this.lastWriteAt === write && (r.rows || r.deleted)) {
      // The server's value is kept, since the row is fetched again only when it changes there again.
      const synced = await this.foreground().catch(() => null);
      if (synced !== null && synced !== heldForeground) { this.serverForeground = synced; await this.holdForeground(heldForeground).catch(holdFailed); }
    } else if (this.serverForeground && (own || this.lastWriteAt !== write)) {
      // This person wrote: the server's foreground comes back, so their next page is rebuilt first even when the write
      // itself arrived in a sync that held it.
      await this.pg.query('update network.read_revision set foreground = $1::bigint where singleton and foreground < $1::bigint', [this.serverForeground]).catch(holdFailed);
      this.serverForeground = null;
    }
    // Caught up before the pages are rebuilt, so a click during the rebuild joins it here (~0.3 s) rather than going to
    // the live server, cold after the same write (15 Oct 2026).
    if (catchesUp && this.settledFor < write) this.settledFor = write;
    if ((r.rows || r.deleted) && this.phase === 'ready') await this.warmRecent();
    this.lastSyncFinishedAt = Date.now();
    if (r.rows || r.deleted) this.log(`synced ${r.tables} table(s), ${r.rows} row(s), ${r.deleted} deleted in ${Date.now() - t0} ms`);
    this.lastSync = { at: new Date().toISOString(), ms: Date.now() - t0, ...r };
    // The local server starts once the copy is whole, so it never renders (or warms) pages from a half-filled database.
    if (!this.next) await this.startNext();
    if (this.phase !== 'ready' && this.next && await this.nextHealthy()) {
      this.phase = 'ready'; this.hadCopy = true; this.detail = 'Reading from this Mac'; this.log('local copy ready');
      // A server that has just started (the app's launch, or the server's new build) has loaded no page's code and built
      // no page's data: the pages this person opened last are built now, behind their next click (15 Oct 2026).
      void this.warmRecent();
    }
  }

  // ---- the live server ----------------------------------------------------------------------------------------

  async remoteJson(pathname) {
    return this.remoteAnswer(pathname, false);
  }

  /**
   * A page of rows, left as text (16 Oct 2026). The server writes its few fields first and the rows last
   * (app/api/desktop/sync/route.ts), so only the fields are parsed here and the rows go to Postgres as they came:
   * parsing a 16 MB page of route_cache and encoding it again for the insert held this process, which also answers
   * every click in the window, for 100-200 ms a page, page after page while a big table caught up.
   * `rows` is then a string; anything not in that shape is parsed whole, as before.
   */
  async remoteRows(pathname) {
    return this.remoteAnswer(pathname, true);
  }

  async remoteAnswer(pathname, rowsAsText) {
    const res = await this.remoteFetch(pathname);
    const text = await res.text();
    let json = rowsAsText ? splitRowsPage(text) : null;
    if (!json) try { json = JSON.parse(text); } catch { /* not json */ }
    if (res.status === 403 || res.status === 401 || (res.status >= 300 && res.status < 400)) {
      await this.refreshInfo();
      throw new Error(`the server refused ${pathname.split('?')[0]} (${res.status})`);
    }
    if (!res.ok || !json?.ok) throw new Error(`${pathname.split('?')[0]} answered ${res.status}: ${(json?.error ?? text).slice(0, 200)}`);
    return json;
  }

  // ---- 1–2: the build, its dependencies, the database ----------------------------------------------------------

  async prepare(commit) {
    this.phase = this.phase === 'ready' ? 'ready' : 'preparing';
    const builds = path.join(this.dir, 'builds');
    mkdirSync(builds, { recursive: true });
    // A build's name is a folder under builds/, from the server's answer: only a plain name (a commit), so a name like
    // `../..` cannot point the delete and rename below outside it (red-team pass, 17 Oct 2026).
    const plain = (name) => buildName(name) !== null;
    let dir = plain(commit) ? path.join(builds, commit) : null;
    if (!dir || !existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
      this.detail = 'Downloading the server’s build';
      const tmp = path.join(builds, `.incoming-${Date.now()}`);
      mkdirSync(tmp, { recursive: true });
      const archive = `${tmp}.tar.gz`;
      const res = await this.remoteFetch('/api/desktop/build');
      if (!res.ok) { const t = await res.text().catch(() => ''); rmSync(tmp, { recursive: true, force: true }); throw new Error(`the build download answered ${res.status}: ${t.slice(0, 200)}`); }
      const got = res.headers.get('x-build-commit') || (plain(commit) ? commit : 'unknown');
      if (!plain(got)) { await res.body?.cancel().catch(() => undefined); rmSync(tmp, { recursive: true, force: true }); throw new Error('the build download named no plain build'); }
      await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
      await sh('tar', ['-xzf', archive, '-C', tmp]);
      const packed = statSync(archive).size;
      rmSync(archive, { force: true });
      dir = path.join(builds, got);
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      this.log('downloaded build', got, `(${Math.round(packed / 1e6)} MB packed)`);
    }
    const commitHere = path.basename(dir);
    await this.installDeps(dir);
    // Stop the old server only once the new build is ready to replace it.
    await this.stopNext();
    await this.ensurePostgres();
    await this.openPool(dir);
    // The build's migrations run once per build: on a launch with the build already migrated here, the schema is as it
    // left it, and starting tsx for nothing to do cost about a second of every launch (15 Oct 2026).
    await this.pg.query('create table if not exists _desktop.migrated (singleton boolean primary key default true check (singleton), commit text not null)');
    const done = (await this.pg.query('select commit from _desktop.migrated')).rows[0]?.commit;
    if (done !== commitHere) {
      this.detail = 'Making the database’s schema';
      await sh(process.execPath, ['--import', 'tsx', 'scripts/desktop-migrate.ts'], { cwd: dir, env: this.childEnv(dir), timeout: 10 * 60_000 });
      await this.pg.query('insert into _desktop.migrated (commit) values ($1) on conflict (singleton) do update set commit = excluded.commit', [commitHere]);
    }
    this.build = { commit: commitHere, dir };
    this.pruneBuilds(builds, commitHere);
    // Counters are kept across builds: a migration that changes rows moves the server's counters, and a new table has
    // no entry yet, so only those are read again. (Re-reading every table on each deploy scanned the big ones for
    // minutes, several times a day.)
    this.meta = await this.loadMeta(false);
    // Tables not copied yet (all of them, on a fresh copy) start from this Mac's own copy of the server's database
    // when there is one (docs/31 §3): the sync then checks each against the server's digest and downloads only what
    // differs.
    if ([...(await this.localTables()).keys()].some((t) => !this.meta.has(t) && !SEED_SKIP.has(t))) await this.seed().catch((e) => this.log('seeding from this Mac skipped:', String(e?.message ?? e).slice(0, 300)));
    // A copy made before the sync analyzed what it wrote: every table never analyzed gets its statistics once.
    const { rows: blind } = await this.pg.query(`select schemaname || '.' || relname as t from pg_stat_user_tables
      where schemaname <> '_desktop' and last_analyze is null and last_autoanalyze is null`);
    for (const { t } of blind) this.analyzeLater(t);
    this.phase = this.phase === 'ready' ? 'ready' : 'syncing';
    this.detail = 'Copying the data down';
  }

  /** Where to seed from: settings.json "seed", PLCOS_DESKTOP_SEED_URL, else the cloud copy scripts/cloud-pull.sh keeps. */
  async seedSource() {
    if (env.PLCOS_DESKTOP_NO_SEED) return null;
    const url = env.PLCOS_DESKTOP_SEED_URL || this.settings.seed || 'postgres://plcos@127.0.0.1:57434/plcos_copy';
    const u = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('the seed must be a database on this Mac');
    // The cloud copy's password is the one cloud-pull.sh keeps in the Keychain (plcos-railway / copy); never logged.
    let password = env.PLCOS_DESKTOP_SEED_PASSWORD ?? decodeURIComponent(u.password || '');
    if (!password && process.platform === 'darwin') password = (await sh('/usr/bin/security', ['find-generic-password', '-s', 'plcos-railway', '-a', 'copy', '-w'], { timeout: 10_000 }).catch(() => '')).trim();
    u.password = '';
    return { url: u.toString(), password };
  }

  /**
   * Fill an empty copy from a Postgres on this Mac that holds (an older copy of) the same database: every table both
   * have, the columns both have, by COPY between two psql processes. People's secrets are never taken (the same
   * tables and stand-ins as the server's sync); anything that does not fit is left empty for the server to fill.
   */
  async seed() {
    const src = await this.seedSource();
    if (!src) return;
    const bin = this.pgBin();
    const srcEnv = { ...env, PGPASSWORD: src.password, PGCONNECT_TIMEOUT: '5' };
    const ping = await sh(path.join(bin, 'psql'), [src.url, '-Atc', 'select 1'], { env: srcEnv, timeout: 15_000 }).catch((e) => { throw new Error(`cannot reach ${new URL(src.url).port}: ${String(e.message).split('\n').pop()}`); });
    if (ping.trim() !== '1') return;
    const listSql = `select n.nspname || '.' || c.relname as t, array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum) as cols
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname not in ('information_schema', '_desktop') and n.nspname !~ '^pg_'`;
    const theirs = new Map((await sh(path.join(bin, 'psql'), [src.url, '-AtF', '\t', '-c', listSql], { env: srcEnv, timeout: 60_000 }))
      .trim().split('\n').filter(Boolean).map((line) => { const [t, cols] = line.split('\t'); return [t, new Set(cols.replace(/^\{|\}$/g, '').split(',').map((c) => c.replace(/^"|"$/g, '')))]; }));
    const local = await this.localTables();
    const todo = [...local.values()].filter((m) => theirs.has(m.t) && !SEED_SKIP.has(m.t) && !this.meta.has(m.t));
    if (!todo.length) return;
    this.log(`seeding ${todo.length} table(s) from this Mac's copy of the database`);
    const t0 = Date.now();
    let done = 0, failed = 0;
    const localUrl = this.dbUrl;
    const one = async (m) => {
      const cols = m.cols.filter((c) => theirs.get(m.t).has(c));
      if (!cols.length) return;
      const q = cols.map(quoteIdent);
      const sel = q.map((c) => SEED_STAND_IN[m.t]?.[c.slice(1, -1)] ?? c).join(', ');
      const table = quoteTable(m.t);
      this.detail = `Seeding from this Mac: ${done} of ${todo.length} tables`;
      try {
        await new Promise((resolve, reject) => {
          const out = spawn(path.join(bin, 'psql'), [src.url, '-v', 'ON_ERROR_STOP=1', '-c', `\\copy (select ${sel} from ${table}) to stdout`], { env: srcEnv, stdio: ['ignore', 'pipe', 'pipe'] });
          const into = spawn(path.join(bin, 'psql'), [localUrl, '-v', 'ON_ERROR_STOP=1', '-c', "set session_replication_role = 'replica'", '-c', `delete from ${table}`, '-c', `\\copy ${table} (${q.join(', ')}) from stdin`], { env: { ...env, PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'ignore', 'pipe'] });
          // If either side stops early the other is stopped too; a broken pipe is that failure, not a crash.
          into.stdin.on('error', () => undefined);
          out.stdout.on('error', () => undefined);
          into.on('close', (code) => { if (code) out.kill(); });
          out.stdout.pipe(into.stdin);
          let err = '';
          out.stderr.on('data', (d) => { err += d; });
          into.stderr.on('data', (d) => { err += d; });
          let codes = 0, bad = false;
          const end = (code) => { if (code) bad = true; if (++codes === 2) (bad ? reject(new Error(err.slice(0, 300))) : resolve()); };
          out.on('close', end);
          into.on('close', end);
        });
        done++;
      } catch (e) {
        failed++;
        // Left empty (rows the migrations made included): the server's copy replaces it whole.
        const c = await this.pg.connect();
        try { await c.query("set session_replication_role = 'replica'"); await c.query(`delete from ${table}`); } catch { /* the sync replaces it */ } finally { await c.query('reset session_replication_role').catch(() => undefined); c.release(); }
        if (failed <= 5) this.log(`seed: ${m.t} left for the server (${String(e.message).split('\n')[0]})`);
      }
    };
    const queue = [...todo];
    await Promise.all(Array.from({ length: TABLES_AT_ONCE }, async () => { for (let m = queue.shift(); m; m = queue.shift()) await one(m); }));
    this.log(`seeded ${done} table(s) in ${Date.now() - t0} ms${failed ? `, ${failed} left for the server` : ''}`);
    for (const m of todo) this.analyzeLater(m.t);
  }

  async installDeps(dir) {
    const lock = readFileSync(path.join(dir, 'package-lock.json'));
    const hash = createHash('sha256').update(lock).digest('hex').slice(0, 16);
    const deps = path.join(this.dir, 'deps', hash);
    if (!existsSync(path.join(deps, 'node_modules', 'next', 'package.json'))) {
      this.detail = 'Installing the build’s dependencies (once per lockfile)';
      mkdirSync(deps, { recursive: true });
      writeFileSync(path.join(deps, 'package.json'), readFileSync(path.join(dir, 'package.json')));
      writeFileSync(path.join(deps, 'package-lock.json'), lock);
      const npm = path.join(path.dirname(process.execPath), 'npm');
      await sh(existsSync(npm) ? npm : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: deps, timeout: 20 * 60_000,
        // The packages' install scripts run with this: not the app's own keys (PLCOS_DESKTOP_KEY and the like).
        env: { ...Object.fromEntries(Object.entries(env).filter(([k]) => !/^PLCOS_|KEY|SECRET|TOKEN|PASSWORD|COOKIE/i.test(k))), NODE_ENV: 'production' } });
      this.log('installed dependencies', hash);
    }
    const link = path.join(dir, 'node_modules');
    rmSync(link, { recursive: true, force: true });
    symlinkSync(path.join(deps, 'node_modules'), link, 'dir');
  }

  pruneBuilds(builds, keep) {
    for (const name of readdirSync(builds)) {
      if (name === keep || name.startsWith('.incoming-') && Date.now() - Number(name.slice(10)) < 3600_000) continue;
      if (name.startsWith('.incoming-') || name !== keep) {
        // Removed off this process's thread: thousands of files took 0.4 s here, which every click waited out (16 Oct 2026).
        if (this.build?.commit !== name) rm(path.join(builds, name), { recursive: true, force: true }).catch((e) => this.log('removing an old build:', String(e?.message ?? e).slice(0, 200)));
      }
    }
  }

  pgBin() {
    const tries = [env.PLCOS_PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].filter(Boolean);
    const bin = tries.find((d) => existsSync(path.join(d, 'pg_ctl')));
    if (!bin) throw new Error('Postgres is not installed. Install it with Homebrew (brew install postgresql@17); until then the app reads from the live server.');
    return bin;
  }

  async ensurePostgres() {
    if (!this.pgManaged) return;
    const bin = this.pgBin();
    const data = path.join(this.dir, 'pg');
    const pgEnv = { ...env, LC_ALL: env.PLCOS_PG_LOCALE || 'en_US.UTF-8', LANG: env.PLCOS_PG_LOCALE || 'en_US.UTF-8' };
    if (!existsSync(path.join(data, 'PG_VERSION'))) {
      this.detail = 'Making the local database';
      // ICU collation, so names sort as on the server (macOS's own en_US.UTF-8 sorts by byte); plain if ICU is missing.
      const base = ['-D', data, '-U', 'plcos', '-A', 'trust', '-E', 'UTF8'];
      await sh(path.join(bin, 'initdb'), [...base, '--locale-provider=icu', '--icu-locale=en-US'], { env: pgEnv })
        .catch(() => { rmSync(data, { recursive: true, force: true }); return sh(path.join(bin, 'initdb'), base, { env: pgEnv }); });
      // Sized for one person on a laptop; where it listens is set below, on every start.
      writeFileSync(path.join(data, 'postgresql.auto.conf'), [
        `port = ${PG_PORT}`,
        'shared_buffers = 256MB', 'work_mem = 32MB', 'max_connections = 40', 'fsync = off', 'synchronous_commit = off', 'full_page_writes = off',
      ].join('\n') + '\n');
    }
    try { writeFileSync(path.join(data, '.metadata_never_index'), ''); } catch { /* best effort: no Spotlight on the database files */ }
    // No port, only the socket (constructor, pgSocket). Set on every start, so a copy made by an earlier version, which
    // listened on 127.0.0.1, stops doing so; one already running that way is restarted.
    mkdirSync(this.pgSocket, { recursive: true, mode: 0o700 });
    const conf = path.join(data, 'postgresql.auto.conf');
    const was = readFileSync(conf, 'utf8');
    const now = [...was.split('\n').filter((l) => l.trim() && !/^\s*(listen_addresses|unix_socket_directories)\s*=/.test(l)),
      "listen_addresses = ''", `unix_socket_directories = '${this.pgSocket.replace(/'/g, "''")}'`].join('\n') + '\n';
    if (now !== was) writeFileSync(conf, now);
    const running = await sh(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: pgEnv }).then(() => true, () => false);
    const ctl = (op) => sh(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(data, 'server.log'), '-w', '-t', '60', '-m', 'fast', op], { env: pgEnv });
    if (!running) await ctl('start');
    else if (now !== was) await ctl('restart');
    const psql = path.join(bin, 'psql');
    const has = await sh(psql, ['-h', this.pgSocket, '-p', String(PG_PORT), '-U', 'plcos', '-d', 'postgres', '-Atc', `select 1 from pg_database where datname = '${DB_NAME}'`], { env: pgEnv });
    if (!has.trim()) await sh(psql, ['-h', this.pgSocket, '-p', String(PG_PORT), '-U', 'plcos', '-d', 'postgres', '-c', `create database ${DB_NAME}`], { env: pgEnv });
    // The server's clock, not the Mac's: dates the database works out (current_date, a day's boundary) must agree with
    // Railway's. In Chicago from 7 pm to midnight they did not, and every route cached by the server was keyed to
    // tomorrow, so the copy recomputed all 7,000 of them every evening while pages waited on live searches (16 Oct 2026).
    await sh(psql, ['-h', this.pgSocket, '-p', String(PG_PORT), '-U', 'plcos', '-d', 'postgres', '-c', `alter database ${DB_NAME} set timezone to 'UTC'`], { env: pgEnv });
    this.pgStop = () => sh(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', 'stop'], { env: pgEnv }).catch(() => undefined);
  }

  async openPool(dir) {
    await this.pg?.end().catch(() => undefined);
    const require = createRequire(path.join(dir, 'package.json'));
    const { Pool } = require('pg');
    this.pg = new Pool({ connectionString: this.dbUrl, max: TABLES_AT_ONCE + 2 });
    await this.pg.query('create schema if not exists _desktop');
    await this.pg.query('create table if not exists _desktop.sync_meta (t text primary key, counter text, since text)');
  }

  async loadMeta(reset) {
    if (reset) await this.pg.query('update _desktop.sync_meta set counter = null');
    const { rows } = await this.pg.query('select t, counter, since from _desktop.sync_meta');
    // A table synced before (its horizon kept through a reset) means this Mac has had a whole copy.
    if (rows.some((r) => r.since)) this.hadCopy = true;
    return new Map(rows.map((r) => [r.t, { counter: r.counter, since: r.since }]));
  }

  childEnv(dir) {
    return {
      PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: env.LANG,
      NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next',
      DATA_PROFILE: 'real', PREVIEW_COPY_AT: new Date().toISOString(), PLCOS_DESKTOP_COPY: '1', PLCOS_DESKTOP_SECRET: this.secret,
      DATABASE_URL: this.dbUrl, PORT: String(NEXT_PORT), GIT_COMMIT: path.basename(dir),
      // As on the server (above, ensurePostgres): pages draw dates the way the web app does.
      TZ: 'UTC',
    };
  }

  // ---- 3: rows ------------------------------------------------------------------------------------------------

  async localTables() {
    const { rows } = await this.pg.query(`
      select n.nspname || '.' || c.relname as t,
             array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum) as cols,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and a.attidentity = 'a') as ident_always,
             (select array_agg(a.attname::text order by k.ord) from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where i.indrelid = c.oid and i.indisprimary) as pk,
             (select array_agg(format_type(a.atttypid, a.atttypmod) order by k.ord) from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where i.indrelid = c.oid and i.indisprimary) as pktypes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname not in ('information_schema', '_desktop') and n.nspname !~ '^pg_'`);
    return new Map(rows.map((r) => [r.t, r]));
  }

  async sync(st) {
    const local = await this.localTables();
    let tables = 0, rows = 0, deleted = 0;
    // Biggest first, so the long tables start early and the short ones fill the gaps.
    // Only a copy never made whole waits on every table. A new server build (which stops the local server, so the
    // phase leaves 'ready') or a restart of the app keeps the slow tables in the background: on 15 Oct 2026 a deploy
    // re-read route_cache in the foreground and sent every page to Railway for its 13 minutes.
    const first = this.phase !== 'ready' && !this.hadCopy;
    const changed = st.tables
      .filter((info) => local.has(info.t) && this.meta.get(info.t)?.counter !== info.counter && !this.background.has(info.t))
      .sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
    // Once the copy is whole, slow tables (a big derived cache rewritten daily, say) catch up in the background, so a
    // write's settle never waits minutes on them: what a person writes lands in the ordinary tables.
    const slow = first ? [] : changed.filter((info) => this.slow.has(info.t));
    const todo = changed.filter((info) => !slow.includes(info));
    const total = todo.length;
    this.progress = new Map();
    const showProgress = () => {
      if (!first) return;
      const now = [...this.progress].map(([t, n]) => `${t.split('.')[1]} ${n.toLocaleString('en-US')}`).join(', ');
      this.detail = `Copying the database to this Mac: ${tables} of ${total} tables done${now ? ` (now ${now} rows)` : ''}`;
    };
    if (first && total) this.log(`copying ${total} table(s) to this Mac, ${TABLES_AT_ONCE} at a time`);
    const one = async (info) => {
      const mine = local.get(info.t);
      const prev = this.meta.get(info.t);
      const t0 = Date.now();
      this.progress.set(info.t, 0);
      showProgress();
      const onRows = (n) => { this.progress.set(info.t, n); showProgress(); };
      // A table read for the first time that already holds rows (seeded from this Mac's own database, or a copy cut
      // short) is checked run by run against the server's digest, and only the runs that differ are downloaded.
      let r = !prev?.since && info.pk?.length && mine.pk?.length && await this.hasRows(info.t)
        ? await this.verifyTable(info, mine, onRows)
        : await this.pullTable(info, mine, prev?.since ?? null, onRows);
      if (r.redo) r = await this.pullTable(info, mine, null, onRows);
      this.progress.delete(info.t);
      tables++; rows += r.rows; deleted += r.deleted;
      const m = { counter: info.counter, since: r.since };
      this.meta.set(info.t, m);
      await this.pg.query('insert into _desktop.sync_meta (t, counter, since) values ($1, $2, $3) on conflict (t) do update set counter = excluded.counter, since = excluded.since', [info.t, m.counter, m.since]);
      if (Date.now() - t0 > SLOW_TABLE_MS) this.slow.add(info.t);
      if (first || r.rows + r.deleted > 1_000) this.analyzeLater(info.t);
      if (first && (r.rows > 10_000 || Date.now() - t0 > 2_000)) this.log(`copied ${info.t}: ${r.rows} row(s) in ${Date.now() - t0} ms (${tables}/${total})`);
      showProgress();
    };
    for (const info of slow) {
      this.background.add(info.t);
      const t0 = Date.now();
      one(info)
        .then(() => this.log(`caught up ${info.t} in the background in ${Date.now() - t0} ms`))
        .catch((e) => this.log(`background sync of ${info.t}:`, String(e?.message ?? e).slice(0, 300)))
        .finally(() => this.background.delete(info.t));
    }
    const queue = [...todo];
    let failed = null;
    // On a failure the others finish the table they are on (each is its own transaction) and take no more.
    await Promise.all(Array.from({ length: Math.min(TABLES_AT_ONCE, queue.length) }, async () => {
      for (let info = queue.shift(); info && !failed; info = queue.shift()) {
        try { await one(info); } catch (e) { if (e instanceof Error) e.message = `${info.t}: ${e.message}`; failed ??= e; }
      }
    }));
    this.progress = new Map();
    if (failed) throw failed;
    return { tables, rows, deleted };
  }

  /**
   * Planner statistics for a table that just changed a lot. Rows written under the replica role in bulk left most tables
   * with none at all (96 of 148 after the first copy, 15 Oct 2026), so pages planned their queries blind. One table at a
   * time, behind the sync: a page read never waits on it.
   */
  analyzeLater(t) {
    (this.toAnalyze ??= new Set()).add(t);
    if (this.analyzing) return;
    this.analyzing = (async () => {
      for (let next = this.toAnalyze.values().next(); !next.done; next = this.toAnalyze.values().next()) {
        this.toAnalyze.delete(next.value);
        await this.pg.query(`analyze ${quoteTable(next.value)}`).catch((e) => this.log(`analyze ${next.value}:`, String(e?.message ?? e).slice(0, 200)));
      }
    })().finally(() => { this.analyzing = null; });
  }

  async pullTable(info, mine, since, onRows = () => {}) {
    const keyed = Boolean(info.pk?.length && mine.pk?.length);
    // The first read of a table, or of one without a key, replaces it whole, in one transaction: rows the build's
    // migrations made here never collide with the server's, and a reader sees the old table until the new one is in.
    const whole = !keyed || !since;
    const q = (s) => s.split('.').map((p) => `"${p.replace(/"/g, '""')}"`).join('.');
    const table = q(info.t);
    let after = null, horizon = null, n = 0, count = null;
    const client = await this.pg.connect();
    try {
      // Rows arrive in key order, not dependency order: foreign keys and triggers are the live server's business.
      await client.query("set session_replication_role = 'replica'");
      await client.query('begin');
      if (whole) await client.query(`delete from ${table}`);
      // Pages shrink when the server is slow to answer them (wide rows, a busy server) and grow back when it is quick.
      let limit = PAGE;
      const fetchPage = (from) => {
        const qs = new URLSearchParams({ op: 'rows', t: info.t, limit: String(limit) });
        const asked = Date.now();
        if (!whole) qs.set('since', since);
        if (from) qs.set('after', JSON.stringify(from));
        const p = this.remoteRows(`/api/desktop/sync?${qs}`).then((page) => {
          const ms = Date.now() - asked;
          if (ms > 8_000) limit = Math.max(500, Math.floor(limit / 2));
          else if (ms < 2_000) limit = Math.min(PAGE, limit * 2);
          return page;
        });
        p.catch(() => undefined); // awaited below; never an unhandled rejection if applying fails first
        return p;
      };
      // The next page downloads while this one is written.
      let pending = fetchPage(after);
      for (;;) {
        const page = await pending;
        horizon ??= page.horizon;
        if (page.next && this.background.has(info.t)) await this.yieldToPerson();
        pending = page.next ? fetchPage(page.next) : null;
        const got = rowCount(page);
        if (got) { await this.apply(client, table, mine, page.rows, keyed); n += got; onRows(n); }
        if (!page.next) { count = page.count; break; }
        after = page.next;
      }
      let deleted = 0;
      if (!whole && count !== null) {
        const { rows: [{ c }] } = await client.query(`select count(*)::int as c from ${table}`);
        if (c > count) deleted = await this.dropDeleted(client, info, mine, table);
        // Fewer here than there: something was missed. Read the whole table again.
        else if (c < count) { await client.query('rollback'); return { redo: true }; }
      }
      await client.query('commit');
      return { rows: n, deleted, since: horizon };
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      // Two rows that swapped a unique value, say: read the whole table instead.
      if (!whole && e?.code === '23505') return { redo: true };
      throw e;
    } finally {
      await client.query('reset session_replication_role').catch(() => undefined);
      client.release();
    }
  }

  async hasRows(t) {
    const { rows } = await this.pg.query(`select exists (select 1 from ${quoteTable(t)}) as has`);
    return rows[0].has;
  }

  /**
   * Check a table that already holds rows against the server's digest (GET /api/desktop/sync?op=digest): runs of
   * rows in key order, each with its last key, count and md5. A run whose hash matches here is kept; one that differs
   * is replaced by the server's rows for that key range. Everything happens in one transaction.
   */
  async verifyTable(info, mine, onRows = () => {}) {
    const table = quoteTable(info.t);
    const d = await this.remoteJson(`/api/desktop/sync?${new URLSearchParams({ op: 'digest', t: info.t, chunk: String(DIGEST_RUN) })}`);
    const pk = mine.pk.map(quoteIdent);
    const order = pk.map((c) => `t.${c}`).join(', ');
    const cond = (params, bound, op) => {
      const casts = mine.pktypes.map((ty, i) => { params.push(bound[i]); return `$${params.length}::text::${ty}`; });
      return `(${order}) ${op} (${casts.join(', ')})`;
    };
    const range = (prevHi, hi) => {
      const params = [];
      const where = [prevHi && cond(params, prevHi, '>'), hi && cond(params, hi, '<=')].filter(Boolean);
      return { params, where: where.length ? `where ${where.join(' and ')}` : '' };
    };
    let n = 0, kept = 0, total = 0;
    const client = await this.pg.connect();
    try {
      await client.query("set session_replication_role = 'replica'");
      await client.query("set timezone = 'UTC'");
      await client.query('begin');
      if (!d.runs.length) {
        const { rowCount } = await client.query(`delete from ${table}`);
        await client.query('commit');
        return { rows: 0, deleted: rowCount ?? 0, since: d.horizon };
      }
      let prevHi = null;
      for (const run of d.runs) {
        total += run.n;
        const { params, where } = range(prevHi, run.hi);
        const { rows: [mineRun] } = await client.query(
          `select count(*)::int as n, md5(string_agg(md5(to_jsonb(t)::text), '' order by ${order})) as md5 from ${table} t ${where}`, params);
        if (mineRun.n === run.n && mineRun.md5 === run.md5) { kept += run.n; prevHi = run.hi; continue; }
        await client.query(`delete from ${table} t ${where}`, params);
        let after = prevHi;
        for (;;) {
          if (this.background.has(info.t)) await this.yieldToPerson();
          const qs = new URLSearchParams({ op: 'rows', t: info.t, limit: String(PAGE) });
          if (after) qs.set('after', JSON.stringify(after));
          if (run.hi) qs.set('upto', JSON.stringify(run.hi));
          const page = await this.remoteRows(`/api/desktop/sync?${qs}`);
          const got = rowCount(page);
          if (got) { await this.apply(client, table, mine, page.rows, true); n += got; onRows(n); }
          if (!page.next) break;
          after = page.next;
        }
        prevHi = run.hi;
      }
      // Fewer rows here than the server counted: a run's range was read differently (text keys sort by collation).
      const { rows: [{ c }] } = await client.query(`select count(*)::int as c from ${table}`);
      if (c < total) { await client.query('rollback'); return { redo: true }; }
      await client.query('commit');
      if (kept) this.log(`checked ${info.t}: kept ${kept} row(s) already here, downloaded ${n}`);
      return { rows: n, deleted: 0, since: d.horizon };
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      await client.query('reset session_replication_role').catch(() => undefined);
      await client.query('reset timezone').catch(() => undefined);
      client.release();
    }
  }

  async apply(client, table, mine, rows, keyed) {
    const cols = mine.cols.map((c) => `"${c.replace(/"/g, '""')}"`);
    const pk = (mine.pk ?? []).map((c) => `"${c.replace(/"/g, '""')}"`);
    const rest = cols.filter((c) => !pk.includes(c));
    const conflict = keyed ? (rest.length ? ` on conflict (${pk.join(', ')}) do update set ${rest.map((c) => `${c} = excluded.${c}`).join(', ')}` : ` on conflict (${pk.join(', ')}) do nothing`) : '';
    await client.query(
      `insert into ${table} (${cols.join(', ')})${mine.ident_always ? ' overriding system value' : ''}
       select ${cols.join(', ')} from jsonb_populate_recordset(null::${table}, $1::jsonb)${conflict}`,
      [typeof rows === 'string' ? rows : JSON.stringify(rows)],
    );
  }

  async dropDeleted(client, info, mine, table) {
    const there = new Set();
    let after = null;
    for (;;) {
      const qs = new URLSearchParams({ op: 'keys', t: info.t });
      if (after) qs.set('after', JSON.stringify(after));
      const page = await this.remoteJson(`/api/desktop/sync?${qs}`);
      for (const k of page.keys) there.add(JSON.stringify(k));
      if (!page.next) break;
      after = page.next;
    }
    const pk = mine.pk.map((c) => `"${c.replace(/"/g, '""')}"`);
    const { rows } = await client.query(`select array[${pk.map((c) => `${c}::text`).join(', ')}] as k from ${table}`);
    const gone = rows.map((r) => r.k).filter((k) => !there.has(JSON.stringify(k)));
    for (let i = 0; i < gone.length; i += 500) {
      const chunk = gone.slice(i, i + 500);
      await client.query(`delete from ${table} where (${pk.map((c) => `${c}::text`).join(', ')}) in (select ${pk.map((_, j) => `x->>${j}`).join(', ')} from jsonb_array_elements($1::jsonb) x)`, [JSON.stringify(chunk)]);
    }
    return gone.length;
  }

  // ---- 4: the server ------------------------------------------------------------------------------------------

  async startNext() {
    const dir = this.build.dir;
    // A server left behind by a core that was killed outright still holds the port, with an old build and secret.
    const pidFile = path.join(this.dir, 'local-server.pid');
    try {
      const old = Number(readFileSync(pidFile, 'utf8'));
      const what = old > 1 ? await sh('ps', ['-p', String(old), '-o', 'command=']).catch(() => '') : '';
      if (/next/.test(what)) { process.kill(old, 'SIGTERM'); await new Promise((r) => setTimeout(r, 1500)); }
    } catch { /* none */ }
    const log = createWriteStream(path.join(this.dir, 'local-server.log'), { flags: 'a' });
    this.detail = 'Starting the local server';
    const child = spawn(process.execPath, [path.join(dir, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(NEXT_PORT)], {
      cwd: dir, env: this.childEnv(dir), stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log); child.stderr.pipe(log);
    child.on('exit', (code, sig) => {
      this.log('local server exited', code ?? sig);
      if (this.next === child) { this.next = null; if (this.phase === 'ready') { this.phase = 'syncing'; this.detail = 'Restarting the local server'; } this.poke(); }
    });
    this.next = child;
    writeFileSync(pidFile, String(child.pid));
    // Looked for every 100 ms (it is up about a second after starting), so the copy answers as soon as it can.
    for (let i = 0; i < 600 && !(await this.nextHealthy()); i++) await new Promise((r) => setTimeout(r, 100));
  }

  async nextHealthy() {
    try { const r = await fetch(`${this.origin}/api/health`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
  }

  async stopNext() {
    const child = this.next;
    this.next = null;
    if (!child) return;
    if (this.phase === 'ready') { this.phase = 'syncing'; this.detail = 'Updating to the server’s new build'; }
    child.kill('SIGTERM');
    await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r(); }, 8000); child.once('exit', () => { clearTimeout(t); r(); }); });
  }

  async stop() {
    this.stopped = true;
    this.poke();
    await this.stopNext();
    await this.pg?.end().catch(() => undefined);
    await this.pgStop?.();
  }
}

