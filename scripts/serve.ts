/**
 * The one launcher behind the servers (docs/COLLAB.md).
 *
 *   npm run dev          the demo, on this folder's demo port
 *   npm run dev:real     the real data, on a live row's real port, with the Affinity and Linear keys
 *   npm run preview      on a dev row: a fresh copy of the real data, on its preview port, no key
 *   npm run start        the demo, from a production build (npm run build)
 *   npm run start:real   the real data, from its production build (npm run build:real)
 *
 * Ports come from this folder's row in .ports.json (config/ports.ts); PORT overrides the port,
 * never what the folder may serve. Every server binds 0.0.0.0, so the local network and Juan's
 * iPad reach it (next.config.ts), and a dev server polls for file changes. The npm scripts raise
 * the open-file limit for the real data and the preview, as they always have.
 */
import { spawn, spawnSync } from 'node:child_process';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { constants } from 'node:os';
import { join, resolve } from 'node:path';
import { portFor, readLayout, type Layout, type Serve } from '../config/ports';
import { withoutKey } from '../lib/connectors/affinity/key';
import { withoutLinearKey } from '../lib/connectors/linear/key';
import { lockHolder } from '../lib/db/lock';
import { checkOpens, previewRefusal, takeCopy } from './preview-copy';

const say = (line: string) => console.log(`[serve] ${line}`);
const refuse = (why: string): never => {
  console.error(`[serve] ${why}`);
  process.exit(1);
};
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether anything answers on the port, or holds it: a connection, then a bind like Next's. */

/** The local Postgres cluster the live server uses (docs/21-postgres.md): Homebrew's postgresql@17. */
const PG_BIN = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const pgEnv = { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };

function startPostgres(dir: string, port: number): string {
  if (!existsSync(join(dir, 'PG_VERSION'))) refuse(`No Postgres cluster at ${dir}; see docs/21-postgres.md.`);
  const running = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', dir, 'status'], { env: pgEnv }).status === 0;
  if (running) { say(`postgres already running on :${port}`); return dir; }
  const r = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', dir, '-l', join(dir, 'server.log'), '-w', '-t', '60', 'start'], { env: pgEnv, stdio: 'ignore' });
  if (r.status !== 0) refuse(`Postgres did not start (see ${join(dir, 'server.log')}).`);
  say(`postgres started on :${port}`);
  return dir;
}


async function busy(port: number): Promise<boolean> {
  const answers = await new Promise<boolean>((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('timeout', () => { socket.destroy(); done(false); });
    socket.once('error', () => done(false));
  });
  if (answers) return true;
  return new Promise<boolean>((done) => {
    const server = createServer();
    server.once('error', () => done(true));
    server.once('listening', () => server.close(() => done(false)));
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Take a fresh copy of the real data for a preview, and check that it opens. Refuses rather than
 * replace anything that is not its own copy, or a copy a running server has open.
 */
async function prepareCopy(layout: Layout): Promise<string> {
  const source = resolve(layout.root, layout.row!.previewSource!);
  let isDir = false;
  try { isDir = statSync(source).isDirectory(); } catch { /* missing */ }
  if (!isDir) refuse(`The preview copies ${layout.row!.previewSource} (${source}), which is not a folder. It is this folder's previewSource in .ports.json.`);
  const why = previewRefusal(layout.root);
  if (why) refuse(why);
  const holder = await lockHolder(join(layout.root, 'data', 'real', 'database'));
  if (holder) refuse(`data/real/database is open in another process (pid ${holder}), most likely a preview already running. Stop it first.`);

  say(`copying ${layout.row!.previewSource} into data/real …`);
  let taken: { takenAt: string; how: 'clone' | 'copy' };
  try {
    taken = takeCopy(source, layout.root);
  } catch (err) {
    return refuse(`The copy failed, and the last one is left as it was: ${message(err)}`);
  }
  try {
    const opened = await checkOpens(layout.root);
    say(`${taken.how === 'clone' ? 'cloned' : 'copied'} at ${taken.takenAt}; its database opens (${opened})`);
  } catch (err) {
    refuse(`The copy's database does not open: ${message(err)}. The live server may have been writing while it was copied: run npm run preview again.`);
  }
  return taken.takenAt;
}

async function main() {
  const [what, ...rest] = process.argv.slice(2);
  if (what !== 'demo' && what !== 'real' && what !== 'preview') refuse('Usage: tsx scripts/serve.ts demo|real|preview [--start] [next options]');
  const serve = what as Serve;
  const production = rest.includes('--start');
  const extra = rest.filter((a) => a !== '--start');
  if (production && serve === 'preview') refuse('A preview is a development server only.');

  let layout: Layout;
  let port: number;
  try {
    layout = readLayout();
    port = portFor(serve, layout);
  } catch (err) {
    return refuse(message(err));
  }
  // Before the Keychain is asked for the key, and before a copy replaces the last one.
  if (await busy(port)) refuse(`Port ${port} is in use. Stop what is serving it, or start with PORT=<another port>.`);

  let env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_PROFILE: serve === 'demo' ? 'demo' : 'real' };
  delete env.PREVIEW_COPY_AT;
  if (!production) env.WATCHPACK_POLLING = 'true';
  if (production && serve === 'real') env.NEXT_DIST_DIR = '.next-real-prod';
  // The live database (docs/21-postgres.md, switched 27 Sep 2026): the launcher is started from Juan's own
  // shell loop, so the choice lives in a file beside the real data rather than in his environment.
  // data/real/postgres.url holds a local loopback URL; deleting the file returns to PGlite (the rollback).
  if (serve === 'real' && !env.DATABASE_URL) {
    try {
      const url = readFileSync(join(layout.root, 'data', 'real', 'postgres.url'), 'utf8').trim();
      if (/^postgres(ql)?:\/\/[^@\s]+@(127\.0\.0\.1|localhost|\[::1\]):\d+\/[a-z0-9_]+$/.test(url)) {
        env.DATABASE_URL = url;
        // The role's password lives in the Keychain (plcos-postgres / app), never in the URL file (Juan,
        // 27 Sep: lock it down so spurious writes don't get through). pg reads PGPASSWORD.
        const pw = spawnSync('security', ['find-generic-password', '-s', 'plcos-postgres', '-a', 'app', '-w'], { encoding: 'utf8' });
        if (pw.status === 0 && pw.stdout.trim()) env.PGPASSWORD = pw.stdout.trim();
        else refuse('No Postgres app password in the Keychain (plcos-postgres / app); see docs/21-postgres.md.');
        say('database: local Postgres (data/real/postgres.url)');
        // Juan, 27 Sep: Postgres is part of our dev setup, never a login item, and a server restart must
        // not take it down. So this only starts the cluster (data/real/postgres) if it isn't running;
        // stopping is explicit: npm run dev:stop (scripts/dev.sh).
        startPostgres(join(layout.root, 'data', 'real', 'postgres'), Number(new URL(url).port));
      } else if (url) refuse('data/real/postgres.url must be a loopback postgres:// URL with a database name.');
    } catch { /* No file: PGlite. */ }
  }

  if (serve === 'preview') {
    env = { ...withoutLinearKey(withoutKey(env)), PREVIEW_COPY_AT: await prepareCopy(layout) };
    say(`serving the copy on :${port}, with no Affinity or Linear key. Anything changed there stays in the copy and is thrown away.`);
  } else {
    say(`${layout.folder}: ${serve === 'demo' ? 'the demo' : 'the real data'} on :${port}${production ? ', production build' : ''}`);
  }

  const next = ['next', production ? 'start' : 'dev', '--hostname', '0.0.0.0', '--port', String(port), ...extra];
  // The live server reads both keys, each from its own Keychain item (docs/15, docs/24-linear.md).
  const command = serve === 'real' ? [join(layout.root, 'scripts', 'with-affinity-key.sh'), join(layout.root, 'scripts', 'with-linear-key.sh'), ...next] : next;
  const child = spawn(command[0]!, command.slice(1), { stdio: 'inherit', env });
  child.on('error', (err) => refuse(`Could not start ${command[0]}: ${err.message}`));
  // The terminal sends Ctrl-C to both; a signal sent to this process alone is passed on, so the
  // server never outlives its launcher with a database open.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0)));
}

main().catch((err: unknown) => refuse(message(err)));
