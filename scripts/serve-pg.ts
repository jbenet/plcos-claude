/** Isolated Postgres rehearsal. See docs/21-postgres.md; never snapshots or starts live. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { constants } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLayout, type Layout } from '../config/ports';

const USAGE = 'Usage: npm run serve:pg -- <local Postgres URL> (--snapshot-at <ISO timestamp> | --demo). PORT overrides the rehearsal port.';

export function rehearsalOptions(args: string[], layout: Layout, inherited: NodeJS.ProcessEnv) {
  const [urlText, ...flags] = args;
  if (!urlText || urlText.startsWith('-')) throw new Error(USAGE);
  if (layout.role === 'live') throw new Error('Run the Postgres rehearsal in a dev worktree, never in the live checkout.');
  let url: URL;
  try { url = new URL(urlText); } catch { throw new Error('Supply a valid local Postgres URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.search || url.hash) {
    throw new Error('Rehearsal requires a loopback Postgres URL without query parameters or fragments.');
  }
  // An explicit rehearsal name prevents accidentally serving a live Postgres database.
  if (!/^\/(?:plcos_dev|plcos_test_[a-z0-9_]+|plcos_rehearsal_[a-z0-9_]+)$/.test(url.pathname)) {
    throw new Error('Use plcos_dev, plcos_test_<name>, or plcos_rehearsal_<name> for the disposable rehearsal database.');
  }
  const demo = flags.length === 1 && flags[0] === '--demo';
  let snapshotAt: string | null = null;
  if (!demo) {
    if (flags.length !== 2 || flags[0] !== '--snapshot-at' || !flags[1] || Number.isNaN(Date.parse(flags[1]))) {
      throw new Error(USAGE);
    }
    snapshotAt = new Date(flags[1]).toISOString();
  }
  const port = Number(inherited.PORT?.trim() || layout.row?.preview || 3218);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  if (port === layout.live?.real || port === layout.live?.demo || port === 3000 || port === 3001) {
    throw new Error('The Postgres rehearsal cannot use a live port.');
  }
  // Allowlist process necessities. Connector/agent credentials are not inherited, and no
  // Keychain wrapper is invoked. The real-copy flag also closes Affinity's key gate.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM']) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  Object.assign(env, {
    DATABASE_URL: urlText,
    DATA_PROFILE: demo ? 'demo' : 'real',
    POSTGRES_REHEARSAL: '1',
    PORT: String(port),
    NEXT_DIST_DIR: `.next-pg-${port}`,
    WATCHPACK_POLLING: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    ANTHROPIC_API_KEY: '',
    DAKOTA_USERNAME: '',
    DAKOTA_PASSWORD: '',
  });
  if (snapshotAt) env.PREVIEW_COPY_AT = snapshotAt;
  return { port, env, demo };
}

async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((done, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is in use. Choose another non-live PORT.`)));
    server.once('listening', () => server.close((error) => error ? reject(error) : done()));
    server.listen(port, '127.0.0.1');
  });
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some(arg => arg === '--help')) { console.log(USAGE); return; }
  const layout = readLayout();
  const { port, env, demo } = rehearsalOptions(process.argv.slice(2), layout, process.env);
  await ensurePortFree(port);
  console.log(`[serve:pg] ${demo ? 'Invented-data' : 'Snapshot'} rehearsal at http://127.0.0.1:${port}. Changes stay in the disposable Postgres database.`);
  const child = spawn(process.execPath, [join(layout.root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: layout.root, stdio: 'inherit', env });
  child.once('error', () => { console.error('[serve:pg] Could not start the local Next server.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal));
  child.once('exit', (code, signal) => process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`[serve:pg] ${error instanceof Error ? error.message : 'Rehearsal could not start.'}`);
    process.exitCode = 1;
  });
}
