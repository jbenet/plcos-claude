import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { builtFrom } from '@/lib/authz/route';

/**
 * GET /api/desktop/build (docs/31): stream `tar -cz` of the running app. An allowlist, not a blocklist: only what the
 * copy needs to run (the compiled .next, the source the build's migrations and `next start` read, the lockfile), so
 * nothing else that lands in the working directory (data, a database cluster, logs, env files, other builds) can
 * ride along. Inside .next, Next's cache and trace and the source maps stay out; node_modules is installed on the Mac
 * for its own platform.
 */
const g = globalThis as typeof globalThis & { __desktopBuildBusy?: boolean };

/** What goes in, relative to the working directory; a path that does not exist is skipped. */
export const BUILD_INCLUDES = ['.next', '.image-commit', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts',
  'proxy.ts', 'instrumentation.ts', 'app', 'components', 'config', 'lib', 'modules', 'scripts', 'fixtures', 'public', 'docs'];

/** Left out of what goes in. */
export function buildExcludes(): string[] {
  return ['./.next/cache', './.next/trace', '*.map', '*.log', '.env', '.env.*'];
}

export async function buildResponse(cwd: string = process.cwd()): Promise<Response> {
  if (!existsSync(`${cwd}/.next/BUILD_ID`)) return Response.json({ ok: false, error: 'This server has no production build to hand out.' }, { status: 501 });
  if (g.__desktopBuildBusy) return Response.json({ ok: false, error: 'A build is already streaming. Try again shortly.' }, { status: 409 });
  g.__desktopBuildBusy = true;
  const include = BUILD_INCLUDES.filter((p) => existsSync(`${cwd}/${p}`)).map((p) => `./${p}`);
  const args = ['-C', cwd, ...buildExcludes().flatMap((e) => ['--exclude', e]), '-czf', '-', ...include];
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
