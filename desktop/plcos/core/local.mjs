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
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const env = process.env;
const NEXT_PORT = Number(env.PLCOS_DESKTOP_LOCAL_PORT || 47101);
const PG_PORT = Number(env.PLCOS_DESKTOP_PG_PORT || 57435);
const DB_NAME = 'plcos_desktop';
const PAGE = 5000;
/** Reads go to the live server for this long after a write: Postgres's change counters usually lag about a second (docs/31). */
const WRITE_SETTLE_MS = Number(env.PLCOS_DESKTOP_SETTLE_MS || 5_000);
const IDLE_SYNC_MS = 15_000;
const BUSY_SYNC_MS = 2_000;
/** Paths the live server always answers: sign-in, the app's own pages, server state (jobs, Astra, imports). */
const REMOTE_ONLY = [/^\/api\//, /^\/auth\//, /^\/signin/, /^\/setup/, /^\/desktop\//, /^\/dev(\/|$)/, /^\/developer(\/|$)/, /^\/issues(\/|$)/, /^\/agents(\/|$)/];

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
  constructor({ state, log, refreshInfo, remoteFetch, DATA_DIR }) {
    Object.assign(this, { state, log, refreshInfo, remoteFetch, dir: DATA_DIR });
    this.phase = 'waiting';           // waiting | preparing | syncing | ready | off | error
    this.detail = 'Waiting for sign-in';
    this.build = null;                // { commit, dir }
    this.next = null;                 // the next start child
    this.pg = null;                   // pg.Pool on the local database
    this.pgManaged = !env.PLCOS_DESKTOP_DATABASE_URL;
    this.dbUrl = env.PLCOS_DESKTOP_DATABASE_URL || `postgres://plcos@127.0.0.1:${PG_PORT}/${DB_NAME}`;
    this.secret = randomBytes(24).toString('hex');
    this.cookiePrefix = `capitalos_real_${NEXT_PORT}_`;
    this.origin = `http://127.0.0.1:${NEXT_PORT}`;
    this.lastWriteAt = 0;
    this.lastSyncStartedAt = 0;
    this.lastSyncFinishedAt = 0;
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
      canServe: (url) => this.canServe(url),
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

  settling() { return this.lastWriteAt > 0 && (Date.now() - this.lastWriteAt < WRITE_SETTLE_MS || this.lastSyncStartedAt < this.lastWriteAt + WRITE_SETTLE_MS - 1000 || this.lastSyncFinishedAt < this.lastSyncStartedAt); }

  canServe(url) {
    if (this.phase !== 'ready') return false;
    if (this.serverCommit && this.build?.commit !== this.serverCommit) return false;
    if (this.settling()) return false;
    return !REMOTE_ONLY.some((r) => r.test(url.pathname));
  }

  poke() { const w = this.wake; this.wake = null; w?.(); }
  sleep(ms) { return new Promise((r) => { const t = setTimeout(() => { this.wake = null; r(); }, ms); this.wake = () => { clearTimeout(t); r(); }; }); }

  async loop() {
    while (!this.stopped) {
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
      await this.sleep(this.settling() || this.phase !== 'ready' ? BUSY_SYNC_MS : IDLE_SYNC_MS);
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
    if (!this.next) await this.startNext();
    this.lastSyncStartedAt = syncStarted;
    const t0 = Date.now();
    const r = await this.sync(st);
    this.lastSyncFinishedAt = Date.now();
    if (r.rows || r.deleted) this.log(`synced ${r.tables} table(s), ${r.rows} row(s), ${r.deleted} deleted in ${Date.now() - t0} ms`);
    this.lastSync = { at: new Date().toISOString(), ms: Date.now() - t0, ...r };
    if (this.phase !== 'ready' && this.next && await this.nextHealthy()) { this.phase = 'ready'; this.detail = 'Reading from this Mac'; this.log('local copy ready'); }
  }

  // ---- the live server ----------------------------------------------------------------------------------------

  async remoteJson(pathname) {
    const res = await this.remoteFetch(pathname);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
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
    let dir = commit ? path.join(builds, commit) : null;
    if (!dir || !existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
      this.detail = 'Downloading the server’s build';
      const tmp = path.join(builds, `.incoming-${Date.now()}`);
      mkdirSync(tmp, { recursive: true });
      const archive = `${tmp}.tar.gz`;
      const res = await this.remoteFetch('/api/desktop/build');
      if (!res.ok) { const t = await res.text().catch(() => ''); rmSync(tmp, { recursive: true, force: true }); throw new Error(`the build download answered ${res.status}: ${t.slice(0, 200)}`); }
      const got = res.headers.get('x-build-commit') || commit || 'unknown';
      await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
      await sh('tar', ['-xzf', archive, '-C', tmp]);
      rmSync(archive, { force: true });
      dir = path.join(builds, got);
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      this.log('downloaded build', got, `(${Math.round(statSize(dir) / 1e6)} MB)`);
    }
    const commitHere = path.basename(dir);
    await this.installDeps(dir);
    // Stop the old server only once the new build is ready to replace it.
    await this.stopNext();
    await this.ensurePostgres();
    this.detail = 'Making the database’s schema';
    await sh(process.execPath, ['--import', 'tsx', 'scripts/desktop-migrate.ts'], { cwd: dir, env: this.childEnv(dir), timeout: 10 * 60_000 });
    await this.openPool(dir);
    this.build = { commit: commitHere, dir };
    this.pruneBuilds(builds, commitHere);
    // A schema change can add tables or columns: read every table once more.
    this.meta = await this.loadMeta(true);
    this.phase = this.phase === 'ready' ? 'ready' : 'syncing';
    this.detail = 'Copying the data down';
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
      await sh(existsSync(npm) ? npm : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: deps, timeout: 20 * 60_000, env: { ...env, NODE_ENV: 'production' } });
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
        if (this.build?.commit !== name) rmSync(path.join(builds, name), { recursive: true, force: true });
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
      await sh(path.join(bin, 'initdb'), ['-D', data, '-U', 'plcos', '-A', 'trust', '-E', 'UTF8'], { env: pgEnv });
      // Loopback only, its socket in its own folder, and sized for one person on a laptop.
      writeFileSync(path.join(data, 'postgresql.auto.conf'), [
        `port = ${PG_PORT}`, "listen_addresses = '127.0.0.1'", `unix_socket_directories = '${data.replace(/'/g, "''")}'`,
        'shared_buffers = 256MB', 'work_mem = 32MB', 'max_connections = 40', 'fsync = off', 'synchronous_commit = off', 'full_page_writes = off',
      ].join('\n') + '\n');
    }
    const running = await sh(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: pgEnv }).then(() => true, () => false);
    if (!running) await sh(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(data, 'server.log'), '-w', '-t', '60', 'start'], { env: pgEnv });
    const psql = path.join(bin, 'psql');
    const has = await sh(psql, ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'plcos', '-d', 'postgres', '-Atc', `select 1 from pg_database where datname = '${DB_NAME}'`], { env: pgEnv });
    if (!has.trim()) await sh(psql, ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'plcos', '-d', 'postgres', '-c', `create database ${DB_NAME}`], { env: pgEnv });
    this.pgStop = () => sh(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', 'stop'], { env: pgEnv }).catch(() => undefined);
  }

  async openPool(dir) {
    await this.pg?.end().catch(() => undefined);
    const require = createRequire(path.join(dir, 'package.json'));
    const { Pool } = require('pg');
    this.pg = new Pool({ connectionString: this.dbUrl, max: 2 });
    await this.pg.query('create schema if not exists _desktop');
    await this.pg.query('create table if not exists _desktop.sync_meta (t text primary key, counter text, since text)');
  }

  async loadMeta(reset) {
    if (reset) await this.pg.query('update _desktop.sync_meta set counter = null');
    const { rows } = await this.pg.query('select t, counter, since from _desktop.sync_meta');
    return new Map(rows.map((r) => [r.t, { counter: r.counter, since: r.since }]));
  }

  childEnv(dir) {
    return {
      PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: env.LANG,
      NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next',
      DATA_PROFILE: 'real', PREVIEW_COPY_AT: new Date().toISOString(), PLCOS_DESKTOP_COPY: '1', PLCOS_DESKTOP_SECRET: this.secret,
      DATABASE_URL: this.dbUrl, PORT: String(NEXT_PORT), GIT_COMMIT: path.basename(dir),
    };
  }

  // ---- 3: rows ------------------------------------------------------------------------------------------------

  async localTables() {
    const { rows } = await this.pg.query(`
      select n.nspname || '.' || c.relname as t,
             array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum) as cols,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and a.attidentity = 'a') as ident_always,
             (select array_agg(a.attname::text order by k.ord) from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where i.indrelid = c.oid and i.indisprimary) as pk
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname not in ('information_schema', '_desktop') and n.nspname !~ '^pg_'`);
    return new Map(rows.map((r) => [r.t, r]));
  }

  async sync(st) {
    const local = await this.localTables();
    let tables = 0, rows = 0, deleted = 0;
    for (const info of st.tables) {
      const mine = local.get(info.t);
      if (!mine) continue;
      const prev = this.meta.get(info.t);
      if (prev && prev.counter === info.counter) continue;
      let r = await this.pullTable(info, mine, prev?.since ?? null);
      if (r.redo) r = await this.pullTable(info, mine, null);
      tables++; rows += r.rows; deleted += r.deleted;
      const m = { counter: info.counter, since: r.since };
      this.meta.set(info.t, m);
      await this.pg.query('insert into _desktop.sync_meta (t, counter, since) values ($1, $2, $3) on conflict (t) do update set counter = excluded.counter, since = excluded.since', [info.t, m.counter, m.since]);
    }
    return { tables, rows, deleted };
  }

  async pullTable(info, mine, since) {
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
      for (;;) {
        const qs = new URLSearchParams({ op: 'rows', t: info.t, limit: String(PAGE) });
        if (!whole) qs.set('since', since);
        if (after) qs.set('after', JSON.stringify(after));
        const page = await this.remoteJson(`/api/desktop/sync?${qs}`);
        horizon ??= page.horizon;
        if (page.rows.length) { await this.apply(client, table, mine, page.rows, keyed); n += page.rows.length; }
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

  async apply(client, table, mine, rows, keyed) {
    const cols = mine.cols.map((c) => `"${c.replace(/"/g, '""')}"`);
    const pk = (mine.pk ?? []).map((c) => `"${c.replace(/"/g, '""')}"`);
    const rest = cols.filter((c) => !pk.includes(c));
    const conflict = keyed ? (rest.length ? ` on conflict (${pk.join(', ')}) do update set ${rest.map((c) => `${c} = excluded.${c}`).join(', ')}` : ` on conflict (${pk.join(', ')}) do nothing`) : '';
    await client.query(
      `insert into ${table} (${cols.join(', ')})${mine.ident_always ? ' overriding system value' : ''}
       select ${cols.join(', ')} from jsonb_populate_recordset(null::${table}, $1::jsonb)${conflict}`,
      [JSON.stringify(rows)],
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
    for (let i = 0; i < 120 && !(await this.nextHealthy()); i++) await new Promise((r) => setTimeout(r, 500));
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

function statSize(dir) {
  let n = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) n += statSync(p).size; } };
  try { walk(dir); } catch { /* best effort */ }
  return n;
}
