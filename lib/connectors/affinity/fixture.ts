import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Transport } from './client';

/**
 * A fake Affinity, for the demo profile. It answers from fixtures/affinity/, with invented
 * people and lists, and the same rate-limit headers the real one sends — so every screen
 * that reads Affinity can be built, tested and screenshotted without real data existing.
 *
 * `/v2/lists?cursor=p2` reads `lists@p2.json`: the path with its slashes as dots, and the
 * cursor after an @. A path with no file answers 404, as Affinity would.
 *
 * A collection answers `filter` (`updatedAt>=…`, terms joined by `|` meaning or), `limit=0`
 * and `totalCount` the way Affinity does, so an incremental read can be shown finding nothing
 * new instead of re-reading the file.
 */

type Item = Record<string, unknown>;

function matches(item: Item, filter: string): boolean {
  return filter.split('|').some((term) => {
    const m = /^([a-zA-Z.]+)(>=|<=|>|<|=)(.+)$/.exec(term.trim());
    if (!m) return true;
    const [, field, op, want] = m as unknown as [string, string, string, string];
    const have = field!.split('.').reduce<unknown>((o, k) => (o as Item | null)?.[k], item);
    if (have === null || have === undefined) return false;
    if (op === '=') return String(have) === want;
    const a = new Date(String(have)).getTime();
    const b = new Date(want).getTime();
    return op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : a < b;
  });
}

function narrow(body: string, url: URL): string {
  const page = JSON.parse(body) as { data?: Item[]; pagination?: Record<string, unknown> };
  if (!Array.isArray(page.data)) return body;
  const filter = url.searchParams.get('filter');
  const data = filter ? page.data.filter((d) => matches(d, filter)) : page.data;
  const pagination: Record<string, unknown> = { ...(page.pagination ?? {}) };
  if (url.searchParams.get('totalCount') === 'true') pagination.totalCount = data.length;
  else delete pagination.totalCount;
  return JSON.stringify({ ...page, data: url.searchParams.get('limit') === '0' ? [] : data, pagination });
}

export function fixtureTransport(): Transport {
  let calls = 0;
  return {
    kind: 'fixture',
    async get(url) {
      calls++;
      const cursor = url.searchParams.get('cursor');
      const file = `${url.pathname.replace(/^\/v2\//, '').replace(/\//g, '.')}${cursor ? `@${cursor}` : ''}.json`;
      const now = new Date();
      const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      const headers = new Headers({
        'content-type': 'application/json',
        'x-ratelimit-limit-user': '900',
        'x-ratelimit-limit-user-remaining': String(Math.max(0, 900 - (calls % 900))),
        'x-ratelimit-limit-user-reset': '60',
        'x-ratelimit-limit-org': '100000',
        'x-ratelimit-limit-org-remaining': String(71_406 - calls),
        'x-ratelimit-limit-org-reset': String(Math.round((monthEnd - now.getTime()) / 1000)),
      });
      let body: string;
      let status = 200;
      try {
        body = await readFile(join(process.cwd(), 'fixtures', 'affinity', file), 'utf8');
      } catch {
        // Somebody with no notes, or no relationships, answers an empty page in Affinity too.
        if (/\/(notes|relationships)$/.test(url.pathname)) {
          body = JSON.stringify({ data: [], pagination: { prevUrl: null, nextUrl: null } });
        } else {
          status = 404;
          body = JSON.stringify({ errors: [{ code: 'not-found', message: `No fixture for ${url.pathname}` }] });
        }
      }
      if (status === 200) body = narrow(body, url);
      return { status, headers, text: async () => body };
    },
  };
}
