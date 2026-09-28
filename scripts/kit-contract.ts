/** Against a seeded local demo: node --import tsx scripts/kit-contract.ts http://localhost:3216
 * Repeat with --labos against a demo server started with LABOS_ME_URL set (no cookie).
 * Plain HTTP, no browser or client JavaScript: every page must arrive server-rendered.
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { canonicalPath } from '../lib/paths';

const base = new URL(process.argv[2]!);
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Local demo servers only');
assert.equal(process.env.DATA_PROFILE, 'demo', 'Set DATA_PROFILE=demo');
const labos = process.argv.includes('--labos');
const links = new Set<string>();
async function get(path: string, page = true) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('x-frame-options'), null, path);
  const ancestors = response.headers.get('content-security-policy')?.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/)?.[1];
  if (ancestors) assert(ancestors.split(/\s+/).includes('https://os.pl.xyz'), path);
  const html = await response.text();
  if (page) {
    assert.match(html, /<title>[^<]+<\/title>/, path);
    assert.match(html, /<main[\s>]/, path);
    if (!labos) assert.match(html, /<h1[\s>]/, `No server-rendered heading: ${path}`);
    assert.doesNotMatch(html, /id="__next_error__"|NEXT_HTTP_ERROR_FALLBACK|data-dgst="(?!NEXT_REDIRECT)|Application error:|Internal Server Error/, path);
    for (const m of html.matchAll(/href="(\/[^"?#]*)[^"\s]*"/g)) links.add(m[1]!);
  }
  console.log(`200 ${path}`);
  return html;
}

await get('/health', false);
if (labos) {
  const root = await fetch(new URL('/', base), { redirect: 'manual' });
  assert.equal(root.status, 200, 'Anonymous LabOS root must not redirect');
  assert.match(await get('/'), /Open Capital OS from LabOS/);
} else {
  const profile = await fetch(new URL('/api/profile', base));
  assert.deepEqual(await profile.json(), { profile: 'demo' }, 'Refusing non-demo server');
  const pages = (await readdir('app', { recursive: true })).filter(p => /(^|\/)page\.tsx$/.test(p))
    .map(p => '/' + p.replace(/(^|\/)page\.tsx$/, '')).sort();
  for (const page of pages.filter(p => !p.includes('['))) await get(canonicalPath(page, 'neurotech'));
  const linked = (pattern: RegExp) => [...links].find(link => pattern.test(link))?.split('/').pop();
  const entity = linked(/^\/orgs\/[0-9a-f-]{36}$/);
  const pursuit = linked(/^\/neurotech\/pipeline\/[0-9a-f-]{36}$/);
  for (const page of pages.filter(p => p.includes('['))) {
    // IDs come from server links; named files come from tracked, invented fixtures.
    const samples: Record<string, string | undefined> = {
      vehicle: 'neurotech', group: 'all', entityId: entity, target: entity,
      id: page.startsWith('/issues') ? linked(/^\/developer\/issues\/\d+$/) : page.startsWith('/targets') ? pursuit : entity,
      slug: page.startsWith('/m/') ? linked(/^\/m\/[^/]+$/) : page.includes('/docs/') ? 'docs-13-synthesis-r3' : 'l1',
      day: linked(/^\/standup\/\d{4}-\d{2}-\d{2}$/), date: '2026-09-18', file: '01-w1-profile-baseline.md',
    };
    const url = canonicalPath(page.replace(/\[(\w+)\]/g, (_, key: string) => {
      assert(samples[key], `No demo example for ${page}; add a fixture/link before shipping this route`);
      return samples[key]!;
    }), 'neurotech');
    await get(url);
    console.log(`  ${page} → ${url}`);
  }
  console.log(`${pages.length} page routes server-rendered (APIs/assets are not pages).`);
}
