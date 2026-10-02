import type { AffinityContext } from './affinity-fixtures';

export async function affinityRetryProperties(ctx: AffinityContext) {
  const { check, scripted, ok, KEY, aff, attempt } = ctx;
  const { readHistory } = await import('../../lib/connectors/affinity/history');
  const { readMeetings } = await import('../../lib/connectors/affinity/meetings');
  const { wholeSeconds } = await import('../../lib/connectors/affinity/history');
  // Affinity answers 400 "Invalid filter provided" to a timestamp with milliseconds (2 Oct 2026).
  check('Affinity history filters and resumed cursor URLs carry whole-second timestamps',
    wholeSeconds('createdAt>=2026-09-26T01:00:16.824Z') === 'createdAt>=2026-09-26T01:00:16Z'
      && wholeSeconds('/v2/meetings?filter=updatedAt%3E%3D2026-09-26T01%3A00%3A16.824Z&limit=100') === '/v2/meetings?filter=updatedAt%3E%3D2026-09-26T01%3A00%3A16Z&limit=100'
      && wholeSeconds('createdAt>=2026-09-26T01:00:16Z') === 'createdAt>=2026-09-26T01:00:16Z',
    'milliseconds removed from plain and URL-encoded filters; whole seconds unchanged');
  const timeout = () => { throw new DOMException('invented timeout', 'TimeoutError'); };
  for (const fault of ['timeout', 'body timeout', '500', '503', '429', 'mixed']) {
    const waits: number[] = [];
    const fake = scripted((_u, n) => {
      if (n > 3) return ok();
      if (fault === 'timeout' || (fault === 'mixed' && n === 1)) return timeout();
      return { status: fault === 'mixed' ? n === 2 ? 503 : 429 : fault === 'body timeout' ? 200 : Number(fault), body: {} };
    });
    const transport = fault === 'body timeout' ? { ...fake.transport, get: async (url: URL) => {
      const response = await fake.transport.get(url);
      return { ...response, text: fake.calls.length <= 3 ? async () => timeout() : response.text };
    } } : fake.transport;
    const run = await readHistory(null, { full: true, overrides: { transport, key: KEY, sleep: async ms => { waits.push(ms); } } });
    check(`History recovers from ${fault} on its third retry with bounded backoff`,
      run?.status === 'ok' && run.requests === 8 && waits.join(',') === '5000,20000,60000'
        && fake.calls.slice(0, 4).every(u => u.href === fake.calls[0]!.href),
      `${run?.status}; ${run?.requests} attempts; waits ${waits}`);
  }

  for (const reader of [readHistory, readMeetings]) {
    const label = reader === readHistory ? 'History' : 'Meetings';
    for (const fault of ['timeout', '503', '429']) {
      const fake = scripted((_u, n) => n === 1 ? ok({ data: [], pagination: { nextUrl: `${ctx.AFFINITY_ORIGIN}${reader === readHistory ? '/v2/persons' : '/v2/meetings'}?cursor=unread` } })
        : fault === 'timeout' ? timeout() : { status: Number(fault), body: {} });
      const run = await reader(null, { full: true, overrides: { transport: fake.transport, key: KEY, sleep: async () => {} } });
      const recovery = scripted(() => ok());
      const resumed = await reader(null, { overrides: { transport: recovery.transport, key: KEY, sleep: async () => {} } });
      check(`${label} pauses after exhausted ${fault} retries and resumes the exact unread page`,
        run?.status === 'held' && run.requests === 5 && !run.detail.through && resumed?.status === 'ok'
          && recovery.calls[0]?.href === fake.calls[1]?.href && resumed.detail.through === run.detail.began,
        `${run?.status} after ${run?.requests} attempts → ${resumed?.status}; original watermark preserved`);
    }
    const capped = scripted(() => timeout());
    const atCap = await reader(null, { full: true, cap: 2, overrides: { transport: capped.transport, key: KEY, sleep: async () => {} } });
    check(`${label} counts failed attempts against its cap`, atCap?.status === 'held' && atCap.requests === 2
      && capped.calls.length === 2 && atCap.detail.stoppedAtCap === true, `${atCap?.requests} actual attempts`);
    const forbidden = scripted(() => ({ status: 403, body: {} }));
    const failed = await reader(null, { full: true, cap: 1, overrides: { transport: forbidden.transport, key: KEY, sleep: async () => {} } });
    check(`${label} never retries or disguises a permission failure as a cap pause`,
      failed?.status === 'failed' && forbidden.calls.length === 1, `${failed?.status}; ${forbidden.calls.length} attempt`);
  }

  // A delta read must resume its updatedAt pass, not restart createdAt or move its watermark.
  const empty = scripted(() => ok());
  await readMeetings(null, { full: true, overrides: { transport: empty.transport, key: KEY } });
  const delta = scripted((_u, n) => n === 1 ? ok() : timeout());
  const stoppedDelta = await readMeetings(null, { overrides: { transport: delta.transport, key: KEY, sleep: async () => {} } });
  const deltaRecovery = scripted(() => ok());
  const finishedDelta = await readMeetings(null, { overrides: { transport: deltaRecovery.transport, key: KEY } });
  check('Meetings resume the interrupted updatedAt pass with the original change filter',
    stoppedDelta?.status === 'held' && deltaRecovery.calls.length === 1
      && deltaRecovery.calls[0]?.href === delta.calls[1]?.href
      && deltaRecovery.calls[0]?.searchParams.get('filter')?.startsWith('updatedAt>=') === true
      && finishedDelta?.detail.through === stoppedDelta.detail.began,
    'No repeated createdAt pass; no skipped updatedAt pass');

  const now = Date.parse('2026-09-28T12:00:00Z');
  for (const header of ['120', new Date(now + 120_000).toUTCString()]) {
    const waits: number[] = [];
    const limited = scripted((_u, n) => n === 1 ? { status: 429, headers: { 'retry-after': header }, body: {} } : ok());
    await aff.affinity({ transport: limited.transport, key: KEY, now: () => now, sleep: async ms => { waits.push(ms); } }).get('/v2/emails');
    check('Retry-After seconds and HTTP dates are honored beyond sixty seconds',
      waits[0] === 120_000 && limited.calls.length === 2, `${header}: ${waits[0]} ms`);
  }
  const refused = scripted(() => ok());
  const error = await attempt(() => aff.affinity({ transport: refused.transport, key: KEY }).get('https://example.invalid/v2/emails'));
  check('Retry support preserves the host refusal before any transport attempt', !!error && refused.calls.length === 0, 'No transport request');

  // Inspect timeout selection without sending a request or waiting for a timer.
  const original = AbortSignal.timeout;
  const delays: number[] = [];
  try {
    AbortSignal.timeout = ms => { delays.push(ms); return new AbortController().signal; };
    const transport = ctx.httpsTransport(async (_url, init) => {
      if (init.method !== 'GET' || init.redirect !== 'error' || init.body) throw new Error('read-only guard lost');
      return new Response('{}');
    });
    await transport.get(new URL('/v2/emails', ctx.AFFINITY_ORIGIN), {});
    await transport.get(new URL('/v2/meetings', ctx.AFFINITY_ORIGIN), {});
    check('Bulk email timeout is sixty seconds and guarded transport remains GET-only', delays.join(',') === '60000,30000', `${delays} ms; fake fetch only`);
  } finally { AbortSignal.timeout = original; }
}
