/** Full production Next SSR benchmark over in-memory HTTP objects (no listening socket).
 * Build first with DATA_PROFILE=demo next build --webpack. Run from the built checkout:
 * DATA_PROFILE=demo node scripts/perf4-render.mjs /private/tmp/marked-perf4-fixture
 * Uses only a marked, invented fixture and reports complete HTML response times.
 */
import { createRequire } from 'node:module';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';

if (process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') throw new Error('SSR benchmark requires demo.');
if (process.env.DATABASE_URL || process.env.PGLITE_DIR) throw new Error('Pass a marked fixture directory, never database environment overrides.');
if (!process.argv[2]) throw new Error('Usage: node scripts/perf4-render.mjs <marked-fixture-directory>');
const fixture = resolve(process.argv[2]);
for (let part = fixture; ; part = dirname(part)) {
  if (part.split(sep).some(x => /^(real|plcos-data)$/i.test(x))) throw new Error('Real-data paths refused.');
  if ((await lstat(part)).isSymbolicLink() && part !== '/tmp' && part !== '/var') throw new Error('Symbolic-link paths refused.');
  if (part === dirname(part)) break;
}
const canonical = await realpath(fixture);
if (canonical.split(sep).some(x => /^(real|plcos-data)$/i.test(x))) throw new Error('Real-data paths refused.');
if ((await lstat(join(fixture, 'db'))).isSymbolicLink()) throw new Error('Symbolic-link databases refused.');
if ((await readFile(join(fixture, '.perf4-invented'), 'utf8')).trim() !== 'perf4-invented-v1') throw new Error('Not an invented perf4 fixture.');
process.env.DATA_PROFILE = 'demo';
process.env.NODE_ENV = 'production';
process.env.PGLITE_DIR = join(fixture, 'db');
const require = createRequire(join(process.cwd(), 'package.json'));
const next = require('next');
const { MockedRequest, MockedResponse } = require('next/dist/server/lib/mock-request');
const app = next({ dev: false, dir: process.cwd(), hostname: 'localhost', port: 3219 });
await app.prepare();
const handle = app.getRequestHandler();

async function render(path) {
  let bytes = 0;
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { bytes += chunk.length; done(); } });
  socket.remoteAddress = '127.0.0.1';
  const req = new MockedRequest({ url: path, method: 'GET', headers: { host: 'localhost:3219', accept: 'text/html' }, socket });
  const res = new MockedResponse({ socket, resWriter(chunk) { bytes += Buffer.byteLength(chunk); return true; } });
  const start = performance.now();
  await handle(req, res);
  await res.hasStreamed;
  const ms = Math.round(performance.now() - start);
  socket.destroy();
  if (res.statusCode !== 200) throw new Error(`${path}: status ${res.statusCode}`);
  return { ms, bytes };
}

try {
  const pages = ['routes', 'visualizations', 'strategy', 'selection', 'pipeline'];
  for (const page of pages) {
    const path = `/neurotech/${page}`;
    console.error(JSON.stringify({ path, warmup: await render(path) }));
  }
  const results = [];
  for (const page of pages) {
    const path = `/neurotech/${page}`;
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await render(path));
    results.push({ path, runs, medianMs: runs.map(r => r.ms).sort((a, b) => a - b)[1] });
    console.log(JSON.stringify(results.at(-1)));
  }
  await app.close();
  process.exit(0);
} catch (error) { console.error(error); await app.close(); process.exit(1); }
