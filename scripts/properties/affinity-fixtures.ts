import type { Check } from './harness';
import { freshDb } from './harness';

export async function affinityFixtures(check: Check) {
  const adb = await freshDb();
  const aff = await import('../../lib/connectors/affinity');
  const { AFFINITY_ORIGIN } = await import('../../lib/connectors/affinity/fetch');
  const { httpsTransport } = await import('../../lib/connectors/affinity/client');
  const KEY = 'test-key-5f2a9c-never-leaves';
  type Reply = { status: number; headers?: Record<string, string>; body: unknown };
  const scripted = (respond: (url: URL, n: number) => Reply) => {
    const calls: URL[] = [];
    return {
      calls,
      transport: {
        kind: 'scripted' as const,
        async get(url: URL) {
          calls.push(url);
          const r = respond(url, calls.length);
          return { status: r.status, headers: new Headers(r.headers ?? {}), text: async () => JSON.stringify(r.body) };
        },
      },
    };
  };
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  const ok = (body: unknown = { data: [], pagination: { nextUrl: null } }): Reply => ({
    status: 200,
    headers: { 'x-ratelimit-limit-user': '900', 'x-ratelimit-limit-user-remaining': '899', 'x-ratelimit-limit-user-reset': '60' },
    body,
  });
  const attempt = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null; } catch (e) { return e as Error; }
  };
  return { check, adb, aff, AFFINITY_ORIGIN, httpsTransport, KEY, scripted, slept, sleep, ok, attempt };
}
export type AffinityContext = Awaited<ReturnType<typeof affinityFixtures>>;
