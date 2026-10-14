import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { builtFrom } from '@/lib/authz/route';
import { config } from '@/config/deployment';

/**
 * GET /api/desktop/build (docs/31): stream `tar -cz` of the running app, minus what the Mac installs or must never
 * get. The excludes are anchored at the top: node_modules (the Mac installs its own, for its own platform), Next's
 * cache, the data root, .git and env files.
 */
const g = globalThis as typeof globalThis & { __desktopBuildBusy?: boolean };

export function buildExcludes(dataRoot: string = config.data.root): string[] {
  const top = dataRoot.split('/')[0] || 'data';
  return ['./node_modules', './.next/cache', `./${top}`, './.git', './.env', './.env.*', './issues/inbox', './.next-real', './.next-real-prod'];
}

export async function buildResponse(cwd: string = process.cwd()): Promise<Response> {
  if (!existsSync(`${cwd}/.next/BUILD_ID`)) return Response.json({ ok: false, error: 'This server has no production build to hand out.' }, { status: 501 });
  if (g.__desktopBuildBusy) return Response.json({ ok: false, error: 'A build is already streaming. Try again shortly.' }, { status: 409 });
  g.__desktopBuildBusy = true;
  const args = ['-C', cwd, ...buildExcludes().flatMap((e) => ['--exclude', e]), '-czf', '-', '.'];
  const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } as unknown as NodeJS.ProcessEnv });
  const done = () => { g.__desktopBuildBusy = false; };
  child.once('close', done);
  child.once('error', done);
  return new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/gzip', 'cache-control': 'no-store',
      'x-build-commit': builtFrom() ?? process.env.GIT_COMMIT?.slice(0, 12) ?? 'unknown',
    },
  });
}
