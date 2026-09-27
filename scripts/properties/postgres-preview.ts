import type { Check } from './harness';
import type { Layout } from '../../config/ports';
import { rehearsalOptions } from '../serve-pg';

/** Launcher-only checks: no server, private files, network, or database access. */
export async function postgresPreviewProperties(check: Check) {
  const layout: Layout = { root: process.cwd(), folder: 'fixture', row: null, role: 'dev', live: { role: 'live', real: 3000, demo: 3001 } };
  const url = 'postgres://plcos@127.0.0.1:5434/plcos_dev';
  const inherited: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: '/usr/bin', PRIVATE_KEY: 'invented', DATABASE_URL: 'wrong', PORT: '3218' };
  const refuses = (args: string[], row = layout, env = inherited) => {
    try { rehearsalOptions(args, row, env); return false; } catch { return true; }
  };
  const demo = rehearsalOptions([url, '--demo'], layout, inherited);
  check('Postgres rehearsal pins its database, profile and initialization guard and omits inherited credentials',
    demo.env.DATABASE_URL === url && demo.env.DATA_PROFILE === 'demo' && demo.env.POSTGRES_REHEARSAL === '1'
      && demo.env.PRIVATE_KEY === undefined && demo.env.NODE_ENV === 'development',
    'Explicit disposable target; no init/seed; allowlisted environment');
  const snapshot = rehearsalOptions([url, '--snapshot-at', '2026-09-27T00:00:00Z'], layout, inherited);
  check('Postgres snapshot rehearsal identifies the real copy and uses an isolated build directory',
    snapshot.env.DATA_PROFILE === 'real' && snapshot.env.PREVIEW_COPY_AT === '2026-09-27T00:00:00.000Z'
      && snapshot.env.NEXT_DIST_DIR === '.next-pg-3218', 'Copy timestamp is supplied by the operator, never invented');
  check('Postgres rehearsal refuses the live checkout and live or invalid ports',
    refuses([url, '--demo'], { ...layout, role: 'live' })
      && ['3000', '3001', '-1', '65536', 'abc'].every(PORT => refuses([url, '--demo'], layout, { NODE_ENV: 'test', PORT })),
    'Live checkout, live ports and invalid port numbers refused');
  check('Postgres rehearsal refuses remote URLs, host overrides and non-rehearsal database names',
    [url + '?host=elsewhere', 'postgres://plcos@example.invalid/plcos_dev', url.replace('plcos_dev', 'production')]
      .every(value => refuses([value, '--demo'])), 'Loopback URL and disposable database name required');
  check('Postgres rehearsal requires an explicit invented profile or valid snapshot timestamp',
    [[url], [url, '--snapshot-at', 'bad'], [url, '--demo', 'extra']].every(args => refuses(args)),
    'No ambiguous profile or false copy timestamp');
}
