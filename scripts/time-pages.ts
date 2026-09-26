/** HTTP-only sequential page benchmark. Real paths/results must stay under data/real.
 * node --import tsx scripts/time-pages.ts http://127.0.0.1:3210 --state data/real/timings.json
 * --resume continues after restarting a timed-out server; never stack work behind a timeout.
 * Cold = first measured visit; warm = immediate repeat. Restart server before a fresh pass.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
const args = process.argv.slice(2);
const option = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1]! : fallback;
const base = new URL(args[0] ?? 'http://127.0.0.1:3210');
if (['3000', '3001'].includes(base.port)) throw new Error('Refusing live ports; benchmark a copy.');
const coldBudget = Number(option('--cold', '10')), warmBudget = Number(option('--warm', '3'));
const timeout = Number(option('--timeout', '240'));
const statePath = option('--state', 'data/real/time-pages.json');
if (![coldBudget, warmBudget, timeout].every(n => Number.isFinite(n) && n > 0)) throw new Error('Budgets and timeout must be positive seconds.');
await mkdir(dirname(statePath), { recursive: true });
const decode = (s: string) => s.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const links = (html: string) => [...html.matchAll(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/g)]
  .map(m => ({ path: decode(m[2]!), attrs: m[1]! + m[3]! }));
const rail = (html: string) => links(html.match(/<nav class="rail"[\s\S]*?<\/nav>/)?.[0] ?? '').map(l => l.path);
const get = async (path: string) => {
  const r = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeout * 1000) });
  const html = await r.text();
  if (!r.ok || /NEXT_HTTP_ERROR_FALLBACK|The server is busy/.test(html)) throw new Error(`HTTP ${r.status} / page error`);
  return html;
};
type Result = { path: string; phase: 'cold' | 'warm'; status: number | string; seconds: number };
type State = { base: string; paths: string[]; results: Result[] };
let state: State;
if (args.includes('--resume')) {
  state = JSON.parse(await readFile(statePath, 'utf8')) as State;
  if (state.base !== base.origin) throw new Error('State belongs to another server.');
} else {
  const home = await get('/today');
  const probe = links(await get('/developer/performance'));
  const most = probe.filter(l => l.attrs.includes('data-probe="routes-most"'))
    .sort((a, b) => Number(b.attrs.match(/data-count="(\d+)"/)?.[1]) - Number(a.attrs.match(/data-count="(\d+)"/)?.[1]))[0];
  if (!most) throw new Error('No stored route-count probe: populate the copy route cache first.');
  const vehicle = most.path.split('/')[1]!;
  const empty = probe.find(l => l.path.startsWith(`/${vehicle}/`) && l.attrs.includes('data-probe="routes-empty"'));
  if (!empty) throw new Error('No stored empty route search for the selected vehicle; cannot claim zero.');
  const overview = await get(`/${vehicle}/overview`);
  const lp = probe.find(l => l.path.startsWith(`/${vehicle}/`) && l.attrs.includes('data-probe="lp"'));
  const org = probe.find(l => l.attrs.includes('data-probe="org"'));
  if (!lp || !org) throw new Error('Missing LP/entity link.');
  const paths = [...new Set([...rail(home), ...rail(overview), '/issues', lp.path, org.path,
    '/orgs/g/all', `/${vehicle}/routes`, most.path, empty.path])].filter(p => p.startsWith('/') && !p.startsWith('//'));
  // Expensive known cases last, so a timeout does not hide unrelated baseline pages.
  paths.sort((a, b) => Number(a.includes('/orgs/g/') || a.includes('/routes')) - Number(b.includes('/orgs/g/') || b.includes('/routes')));
  state = { base: base.origin, paths, results: [] };
}
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
await save();
console.log('phase\tpath\tstatus\tseconds');
for (const path of state.paths) for (const phase of ['cold', 'warm'] as const) {
  if (state.results.some(r => r.path === path && r.phase === phase)) continue;
  const start = performance.now();
  let status: Result['status'];
  let timedOut = false;
  try {
    const r = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeout * 1000) });
    const body = await r.text();
    status = /NEXT_HTTP_ERROR_FALLBACK|The server is busy/.test(body) ? 'page-error' : r.status;
  } catch (error) { status = error instanceof Error ? error.name : 'error'; timedOut = true; }
  const result = { path, phase, status, seconds: (performance.now() - start) / 1000 };
  state.results.push(result); await save();
  console.log(`${phase}\t${path}\t${status}\t${result.seconds.toFixed(3)}`);
  if (timedOut) {
    console.error('Stopped: the server may still be rendering. Restart the COPY server before --resume.');
    process.exit(2);
  }
}
process.exitCode = state.results.some(r => r.status !== 200 || r.seconds > (r.phase === 'cold' ? coldBudget : warmBudget)) ? 1 : 0;
