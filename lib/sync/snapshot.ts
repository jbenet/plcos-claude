import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { mutationProfileAllowed } from '@/lib/mutation-policy';
import { auditSync, syncError, type SyncCaller } from './auth';
import { filesToCarry } from './files';

/**
 * GET /api/sync/snapshot (docs/deploy/railway.md §6). The server runs `pg_dump -Fc` against its own
 * database and streams it; with `?files=1`, a gzipped tar of the data root instead, minus what cutover
 * leaves out (./files.ts). One at a time: a second request while one streams gets 409.
 *
 * The password reaches pg_dump only through its environment (PGPASSWORD), never its arguments, and the
 * child gets no other variable of this server's (no API keys). Nothing here logs a connection string.
 * Refused on a preview copy, and on a real-profile server that is not the live one; a demo server answers
 * only with SYNC_DEMO_SNAPSHOT=1, for the round-trip test.
 */

const g = globalThis as typeof globalThis & { __syncSnapshotBusy?: boolean };

/** Where the server may serve a snapshot from, or why not. */
export function snapshotRefusal(): string | null {
  if (config.data.copyTakenAt) return 'This server serves a copy of the data; take snapshots from the live server.';
  // A demo answers only when told to, for the round-trip test; read per request, so a test can switch it.
  if (config.data.profile === 'demo') return process.env.SYNC_DEMO_SNAPSHOT === '1' ? null : 'This is the demo; it serves snapshots only with SYNC_DEMO_SNAPSHOT=1, for tests.';
  if (!mutationProfileAllowed(config.data.profile, config.data.copyTakenAt, isLiveServer() ? 'live' : 'dev')) return 'Only the live server serves snapshots of real data.';
  return null;
}

/** pg_dump 17: the image's (PGDG), else Homebrew's on the Mac, else whatever is on PATH. */
export function pgDumpBinary(): string {
  for (const p of ['/usr/lib/postgresql/17/bin/pg_dump', '/opt/homebrew/opt/postgresql@17/bin/pg_dump']) if (existsSync(p)) return p;
  return 'pg_dump';
}

/** The search path a child needs, and nothing else of this server's environment. */
const childPath = (env: NodeJS.ProcessEnv = process.env) => env.PATH ?? '/usr/bin:/bin';

/** The child's whole environment: the connection as PG* variables, password included, and nothing else of ours. */
export function pgDumpEnv(url: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('DATABASE_URL is not a postgres URL.');
  const out: Record<string, string> = {
    PATH: childPath(env), PGHOST: u.hostname.replace(/^\[|\]$/g, ''), PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')), PGCONNECT_TIMEOUT: '15',
  };
  if (u.username) out.PGUSER = decodeURIComponent(u.username);
  const password = u.password ? decodeURIComponent(u.password) : env.PGPASSWORD;
  if (password) out.PGPASSWORD = password;
  const ssl = u.searchParams.get('sslmode') ?? env.PGSSLMODE;
  if (ssl) out.PGSSLMODE = ssl;
  if (env.PGSSLROOTCERT) out.PGSSLROOTCERT = env.PGSSLROOTCERT;
  if (env.HOME) out.HOME = env.HOME;
  return out;
}

/** Strip anything shaped like credentials from a child's error text before it reaches the server log. */
const redact = (s: string) => s.replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, '<url>').replace(/password\S*/gi, '<password>').slice(0, 300);

type Child = ChildProcessByStdio<Writable | null, Readable, Readable>;

/** `root` replaces the data root for the files archive; only tests pass it (the route never does). */
export async function snapshotResponse(caller: SyncCaller, wantFiles: boolean, o: { root?: string } = {}): Promise<Response> {
  const started = Date.now();
  const what = wantFiles ? 'files' : 'database';
  const refusal = snapshotRefusal();
  if (refusal) { await auditSync(caller, 'snapshot', 'refused', { what, reason: 'profile' }); return syncError(403, refusal); }
  if (!wantFiles && !config.db.url) { await auditSync(caller, 'snapshot', 'refused', { what, reason: 'pglite' }); return syncError(501, 'This server runs on PGlite; a database snapshot needs Postgres.'); }
  if (g.__syncSnapshotBusy) { await auditSync(caller, 'snapshot', 'refused', { what, reason: 'busy' }); return syncError(409, 'A snapshot is already streaming. Try again when it finishes.'); }
  g.__syncSnapshotBusy = true;
  const taken = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let child: Child;
  let count = 0;
  try {
    if (wantFiles) {
      const root = await realpath(o.root ?? resolve(process.cwd(), config.data.root));
      const list = await filesToCarry(root);
      count = list.length;
      child = spawn('tar', ['-C', root, '--null', '-T', '-', '-czf', '-'], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: childPath() } as unknown as NodeJS.ProcessEnv }) as Child;
      child.stdin!.on('error', () => undefined);
      child.stdin!.end(list.map((f) => `${f}\0`).join(''));
    } else {
      child = spawn(pgDumpBinary(), ['-Fc', '-w'], { stdio: ['ignore', 'pipe', 'pipe'], env: pgDumpEnv(config.db.url!) as unknown as NodeJS.ProcessEnv }) as Child;
    }
  } catch (e) {
    g.__syncSnapshotBusy = false;
    console.error(`[sync] snapshot (${what}) could not start: ${redact(e instanceof Error ? e.message : String(e))}`);
    await auditSync(caller, 'snapshot', 'error', { what, reason: 'start' });
    return syncError(500, 'The snapshot could not start on the server.');
  }
  return streamChild(child, {
    name: wantFiles ? `plcos-files-${taken}.tar.gz` : `plcos-${taken}.dump`,
    taken,
    files: wantFiles ? count : null,
    done: async (ok, bytes, reason) => {
      g.__syncSnapshotBusy = false;
      await auditSync(caller, 'snapshot', ok ? 'ok' : 'error', { what, bytes, ms: Date.now() - started, ...(wantFiles ? { files: count } : {}), ...(reason ? { reason } : {}) });
    },
  });
}

/**
 * Stream a child's stdout as the response body. The status waits for the first bytes, so a dump that
 * fails at once (wrong password, server down) is a 500 with a reason, not an empty 200. A failure after
 * that aborts the body mid-stream, which curl reports as an error (exit 18) and the pull refuses.
 */
function streamChild(child: Child, o: { name: string; taken: string; files: number | null; done: (ok: boolean, bytes: number, reason?: string) => Promise<void> }): Promise<Response> {
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { if (stderr.length < 4096) stderr += d.toString('utf8'); });
  const exited = new Promise<number | null>((res) => child.once('close', (code) => res(code)));
  child.once('error', () => undefined);
  let bytes = 0, finished = false;
  const finish = (ok: boolean, reason?: string) => {
    if (finished) return;
    finished = true;
    if (!ok && stderr) console.error(`[sync] snapshot child failed: ${redact(stderr)}`);
    void o.done(ok, bytes, reason);
  };
  return new Promise<Response>((answer) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let first: Buffer | null = null;
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (!controller) { first = first ? Buffer.concat([first, chunk]) : chunk; child.stdout.pause(); start(); return; }
      controller.enqueue(new Uint8Array(chunk));
      if ((controller.desiredSize ?? 1) <= 0) child.stdout.pause();
    };
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const body = new ReadableStream<Uint8Array>({
        start(c) { controller = c; if (first) c.enqueue(new Uint8Array(first)); first = null; },
        pull() { child.stdout.resume(); },
        cancel() { child.kill('SIGTERM'); finish(false, 'client closed'); },
      }, { highWaterMark: 4 });
      answer(new Response(body, { status: 200, headers: {
        'Content-Type': o.name.endsWith('.dump') ? 'application/octet-stream' : 'application/gzip',
        'Content-Disposition': `attachment; filename="${o.name}"`, 'Cache-Control': 'no-store',
        'X-Snapshot-Taken': o.taken, ...(o.files === null ? {} : { 'X-Snapshot-Files': String(o.files) }),
      } }));
    };
    child.stdout.on('data', onData);
    void exited.then((code) => {
      if (!started) {
        finish(false, `exit ${code}`);
        answer(syncError(500, 'The snapshot failed on the server before any data; see the server log.'));
        return;
      }
      if (code === 0) { finish(true); try { controller?.close(); } catch { /* already cancelled */ } }
      else { finish(false, `exit ${code}`); try { controller?.error(new Error('snapshot failed')); } catch { /* already cancelled */ } }
    });
  });
}
