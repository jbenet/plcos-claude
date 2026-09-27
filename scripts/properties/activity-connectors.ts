import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './harness';
import { affinityClient, type ClientOptions } from '../../lib/connectors/affinity/client';
import { DakotaClient } from '../../lib/connectors/dakota/client';
import { runKey } from '../../lib/activity/log';

interface Logged {
  source: string; segment: string | null; requests: number; bytesIn: number | null;
  bytesOut: number | null; records: number | null; estimated: boolean; run?: string;
}

/** Invented transports and isolated temporary files only. Never reads a real root or sends a request. */
export async function activityConnectorProperties(check: Check) {
  const root = await mkdtemp(join(tmpdir(), 'activity-connectors-invented-'));
  const rejected = async (operation: () => Promise<unknown>) => {
    try { await operation(); return false; } catch { return true; }
  };
  try {
    const body = JSON.stringify({ data: [{ name: 'Invented private name', extra: 'ø' }] });
    const singleton = JSON.stringify({ data: { id: 123, name: 'Invented private list' } });
    const base: Omit<ClientOptions, 'transport'> = {
      key: 'invented-secret', limits: { maxPerMinute: 20, monthlyShare: 1, monthlyFloor: 0 },
      log: async () => {}, usedThisMonth: async () => 0, sleep: async () => {}, activityRoot: root,
    };
    let calls = 0;
    const client = affinityClient({ ...base, runId: 'invented-affinity-run', transport: {
      kind: 'scripted', async get(url) {
        calls++;
        const text = calls === 1 ? 'rate-limited' : url.pathname === '/v2/lists/123' ? singleton : body;
        return { status: calls === 1 ? 429 : 200, headers: new Headers(), text: async () => text };
      },
    } });
    await client.get('/v2/notes', { filter: 'Invented secret query' });
    const refused = await rejected(() => client.get('/v2/not-allowed'));
    await client.get('/v2/lists/123');
    const failing = affinityClient({ ...base, transport: {
      kind: 'scripted', async get() { throw new Error('Invented disconnected fixture'); },
    } });
    const disconnected = await rejected(() => failing.get('/v2/notes'));
    const authBody = JSON.stringify({ access_token: 'invented-token', expires_in: 10000 });
    const dakotaBody = JSON.stringify({ records: [{ name: 'Invented private Dakota name' }], next_offset: -1 });
    const outbound: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      outbound.push(String(init?.body));
      return new Response(String(url).endsWith('/oauth2') ? authBody : dakotaBody, { status: 200 });
    };
    const dakota = new DakotaClient('invented-username', 'invented-password', fetcher, { root, runId: 'invented-dakota-run' });
    const page = await dakota.page({ module: 'account' });
    const files = (await readdir(join(root, 'activity'))).filter(f => f.endsWith('.jsonl'));
    const raw = (await Promise.all(files.map(f => readFile(join(root, 'activity', f), 'utf8')))).join('');
    const rows: Logged[] = raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const affinity = rows.filter(row => row.source === 'affinity');
    const pulled = affinity.find(row => row.segment === 'notes' && row.records === 1);
    const authentication = rows.find(row => row.source === 'dakota' && row.segment === 'authentication');
    const account = rows.find(row => row.source === 'dakota' && row.segment === 'account');

    check('ACTIVITY connector bytes measure UTF-8 response bodies', pulled?.bytesIn === Buffer.byteLength(body),
      'The invented multibyte character distinguishes byte length from character count.');
    check('ACTIVITY retries each contribute an outbound request', affinity.length === 6 && affinity.every(row => row.requests === 1)
      && affinity.some(row => row.records === 0 && row.bytesIn === Buffer.byteLength('rate-limited')),
      'One 429, one successful page, one singleton and three failed network attempts.');
    check('ACTIVITY network failures preserve unknown response bytes', disconnected
      && affinity.filter(row => row.bytesIn === null && row.records === null).length === 3,
      'A failed connection is a request attempt, not a known zero-byte response.');
    check('ACTIVITY refused paths do not create requests', refused && calls === 3,
      'The unallowlisted path never reaches the scripted transport or activity log.');
    check('ACTIVITY Affinity GET body bytes are zero', affinity.every(row => row.bytesOut === 0),
      'Application body bytes exclude headers and query strings.');
    check('ACTIVITY Dakota measures request and response body bytes', account?.bytesIn === Buffer.byteLength(dakotaBody)
      && account.bytesOut === Buffer.byteLength(outbound[1]!) && authentication?.bytesIn === Buffer.byteLength(authBody)
      && authentication.bytesOut === Buffer.byteLength(outbound[0]!), 'Both authentication and read payloads are measured without retaining their contents.');
    check('ACTIVITY connector records count pages and singleton entities', page.records.length === 1 && account?.records === 1
      && authentication?.records === 0 && affinity.find(row => row.segment === 'lists')?.records === 1,
      'A singleton list is one record; authentication is not a pulled record.');
    check('ACTIVITY connector observations remain actual', rows.length === 8 && rows.every(row => row.estimated === false),
      'Unobserved quantities stay null rather than invented.');
    check('ACTIVITY connector logs retain no personal data or credentials', !/Invented|invented-|private|password|username|filter|token|query/i.test(raw),
      'Invented secret values, record names, filter contents and raw run IDs do not survive the log boundary.');
    check('ACTIVITY connector runs remain correlatable without raw identifiers', pulled?.run === runKey('invented-affinity-run')
      && account?.run === runKey('invented-dakota-run'), 'Run hashes can deduplicate manifests and sync histories.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
