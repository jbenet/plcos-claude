import type { AffinityContext } from './affinity-fixtures';
import type { HistoryRunDetail } from '../../lib/connectors/affinity/history';

export async function affinityHistoryProperties(ctx: AffinityContext) {
  const { check, adb, KEY, scripted, sleep, ok } = ctx;
  const { readHistory } = await import('../../lib/connectors/affinity/history');
  const { latestRun, startRun, progressRun } = await import('../../modules/sources');
  await (await import('./affinity-retry')).affinityRetryProperties(ctx);
  try {
  const item = (id: number) => ({ id, createdAt: '2026-09-27T00:00:00Z', updatedAt: null, startTime: '2019-01-01T00:00:00Z' });
  const bulk = scripted(u => {
    if (u.pathname === '/v2/persons' && !u.searchParams.has('cursor')) return ok({ data: [item(94001)], pagination: { nextUrl: `${ctx.AFFINITY_ORIGIN}/v2/persons?cursor=second` } });
    return ok({ data: [item(u.pathname === '/v2/persons' ? 94002 : 94003)], pagination: { nextUrl: null } });
  });
  const options = { overrides: { transport: bulk.transport, key: KEY, sleep } };
  const first = await readHistory(null, { ...options, full: true, cap: 1 });
  const d1 = first?.detail as HistoryRunDetail;
  const second = await readHistory(null, options);
  const d2 = second?.detail as HistoryRunDetail;
  check('History resumes a capped bulk read at the unread cursor without advancing its watermark',
    first?.status === 'held' && !d1.through && d1.resume?.phase === 0 &&
    bulk.calls[1]?.searchParams.get('cursor') === 'second' && bulk.calls[1]?.searchParams.get('limit') === '100' &&
    bulk.calls[1]?.searchParams.get('fieldTypes') === 'global' &&
    second?.status === 'ok' && d2.through === d1.began,
    `${first?.status} → ${second?.status}; ${bulk.calls.length} requests, stable original start`);
  check('Full interaction history has no event-date window and reads all supported collection types',
    bulk.calls.every(u => !u.searchParams.has('filter')) &&
    ['/v2/persons', '/v2/meetings', '/v2/emails', '/v2/calls', '/v2/chat-messages'].every(p => bulk.calls.some(u => u.pathname === p)),
    `${new Set(bulk.calls.map(u => u.pathname)).size} bulk endpoints; no list/person filter`);

  const delta = scripted(u => ok({ data: u.pathname === '/v2/meetings' ? [item(94004)] : [], pagination: { nextUrl: null } }));
  const changed = await readHistory(null, { overrides: { transport: delta.transport, key: KEY, sleep } });
  const meetingQueries = delta.calls.filter(u => u.pathname === '/v2/meetings').map(u => u.searchParams.get('filter'));
  const old = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where source = 'affinity' and kind = 'meeting' and source_id = '94004'`);
  check('Changed history reads created and updated clocks, preserving recently recorded old meetings',
    changed?.status === 'ok' && meetingQueries.length === 2 && meetingQueries.some(f => f?.startsWith('createdAt>=')) &&
    meetingQueries.some(f => f?.startsWith('updatedAt>=')) && Number(old?.n) === 1,
    `${meetingQueries.length} change passes; old meeting landed once`);

  const quota = scripted(() => ({ status: 429, headers: { 'retry-after': '0' }, body: {} }));
  const stopped = await readHistory(null, { full: true, cap: 2, overrides: { transport: quota.transport, key: KEY, sleep } });
  const stoppedDetail = stopped?.detail as HistoryRunDetail;
  const good = await latestRun('affinity', 'history', 'ok');
  check('Rate-limit attempts share the cap; paused history never becomes a completed checkpoint',
    stopped?.status === 'held' && quota.calls.length === 2 && stopped.requests === 2 && !stoppedDetail.through &&
    stoppedDetail.resume?.next === '/v2/persons' && good?.id === changed?.id,
    `${quota.calls.length} attempts; prior successful watermark retained`);
  const recovery = scripted(() => ok());
  const recovered = await readHistory(null, { overrides: { transport: recovery.transport, key: KEY, sleep } });
  check('History retries a rate-limited page and completes remaining streams on a later run',
    recovered?.status === 'ok' && recovery.calls[0]?.pathname === '/v2/persons' &&
    (recovered.detail as HistoryRunDetail).through === stoppedDetail.began,
    `${recovery.calls.length} successful requests after failure`);

  const loop = scripted(() => ok({ data: [], pagination: { nextUrl: `${ctx.AFFINITY_ORIGIN}/v2/persons?cursor=repeated` } }));
  const looping = await readHistory(null, { full: true, overrides: { transport: loop.transport, key: KEY, sleep } });
  check('Repeated pagination cursors fail closed without reading until the budget is spent',
    looping?.status === 'failed' && loop.calls.length === 2 && /repeated a cursor/.test(looping.note ?? '') && !looping.detail.through,
    `${loop.calls.length} requests; no completed watermark`);

  const preview = scripted(u => ok({ data: u.pathname === '/v2/meetings' ? [{ ...item(94005), attendeesPreview: { totalCount: 101, data: [] } }] : [], pagination: { nextUrl: null } }));
  const truncated = await readHistory(null, { full: true, overrides: { transport: preview.transport, key: KEY, sleep } });
  check('Bulk API participant preview limits are explicitly disclosed instead of claimed as full coverage',
    truncated?.status === 'ok' && truncated.detail.truncated === 1 && /truncated participant previews/.test(truncated.note ?? ''),
    `Recorded ${String(truncated?.detail.truncated)} truncated preview`);

  // Invented durable checkpoint left by a server process that exited after landing page one.
  const crashedId = await startRun('affinity', 'history', null);
  const began = '2026-09-01T12:00:00.000Z';
  const next = `${ctx.AFFINITY_ORIGIN}/v2/persons?cursor=after-crash`;
  await progressRun(crashedId, { requests: 1, records: 0, newRecords: 0, note: 'invented interrupted run', detail: {
    mode: 'full', began, since: null, cap: 99, truncated: 0,
    resume: { phase: 0, next, query: { limit: 100, fieldTypes: ['global'] }, visited: [],
      steps: [{ path: '/v2/persons', kind: 'person', query: { limit: 100, fieldTypes: ['global'] } }] },
  } });
  // Ordinary callers that omit detail must retain the persisted checkpoint.
  await progressRun(crashedId, { requests: 1, records: 0, newRecords: 0, note: 'counts-only progress' });
  const afterCrash = scripted(() => ok());
  const resumed = await readHistory(null, { overrides: { transport: afterCrash.transport, key: KEY, sleep } });
  check('A restarted history reader resumes the persisted running cursor and original watermark',
    resumed?.status === 'ok' && afterCrash.calls.length === 1 && afterCrash.calls[0]?.searchParams.get('cursor') === 'after-crash' &&
    resumed.detail.through === began,
    `${afterCrash.calls.length} request; running checkpoint survived counts-only progress`);
  } finally {
    // These rows are deliberately schema-minimal; do not leak them into downstream UI and
    // translation properties, which consume every landed record in this shared scratch DB.
    await adb.query(`delete from sources.raw_record where source = 'affinity' and source_id = any($1::text[])
      and kind = any($2::text[])`, [['94001', '94002', '94003', '94004', '94005'], ['person', 'meeting', 'email', 'call', 'chat-message']]);
  }
}
