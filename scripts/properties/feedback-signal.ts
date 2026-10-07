/**
 * The feedback signal (lib/feedback-signal, docs/deploy/04-feedback-signal.md): new feedback wakes the
 * project's feedback thread once per burst, carries ids and a signed read link and no issue text, retries
 * a failed fire, and the link reads only the issues it names. Invented fixtures in a temporary folder; the
 * routine is a fake fetch, so nothing leaves the machine.
 */
import type { Check } from './harness';

export async function feedbackSignalProperties(check: Check) {
  const { mkdtemp, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, relative } = await import('node:path');
  const sig = await import('../../lib/feedback-signal');
  const { FEEDBACK_SIGNAL_URL_SETTING, FEEDBACK_SIGNAL_TOKEN_SETTING } = await import('../../lib/feedback-signal/setting');
  const { QUIET_MS, MIN_GAP_MS, queueSignal, tickSignal, readSignalState, signalText, readLink, verifyRead } = sig;

  const URL_ = 'https://api.anthropic.com/v1/claude_code/routines/trig_01InventedFixture00/fire';
  const TOKEN = 'invented-signal-token-for-props-only';
  const on = (root: string, origin = 'https://raise.example.org') =>
    ({ url: URL_, token: TOKEN, origin, issuesDir: relative(process.cwd(), root) });
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let answer: number | 'throw' = 200;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer === 'throw') throw new Error('invented network failure');
    return new Response('{}', { status: answer });
  }) as unknown as typeof fetch;
  const at = (ms: number) => new Date(Date.parse('2026-10-07T03:00:00Z') + ms);

  const root = await mkdtemp(join(tmpdir(), 'plcos-fictional-signal-'));
  try {
    // Off: nothing kept, nothing sent.
    await queueSignal(root, ['0001'], { ...on(root), url: undefined }, at(0));
    const offTick = await tickSignal(root, { ...on(root), token: undefined }, { now: at(QUIET_MS), fetch: fake });
    const noFile = await access(join(root, 'inbox', 'signal.json')).then(() => false, () => true);
    check('Feedback signal: off without both settings, keeps nothing and sends nothing',
      offTick === 'off' && noFile && calls.length === 0, 'Invented ids; fake routine');

    // A burst: three filings, one fire, after the box is quiet.
    await queueSignal(root, ['0002'], on(root), at(0));
    await queueSignal(root, ['0003'], on(root), at(20_000));
    await queueSignal(root, ['0004', '0003'], on(root), at(40_000));
    const early = await tickSignal(root, on(root), { now: at(40_000 + QUIET_MS - 1), fetch: fake });
    const fired = await tickSignal(root, on(root), { now: at(40_000 + QUIET_MS), fetch: fake });
    const sent = calls[0];
    const body = sent ? (JSON.parse(String(sent.init.body)) as { text: string }).text : '';
    const h = (sent?.init.headers ?? {}) as Record<string, string>;
    const link = /read: (\S+)/.exec(body)?.[1] ?? '';
    check('Feedback signal: a burst waits for quiet, then fires once with every id, the routine headers and a read link',
      early === 'waiting' && fired === 'fired' && calls.length === 1 && sent?.url === URL_
        && h.authorization === `Bearer ${TOKEN}` && h['anthropic-beta'] === 'experimental-cc-routine-2026-04-01' && h['anthropic-version'] === '2023-06-01'
        && body.includes('new issues: 0002, 0003, 0004') && link.startsWith('https://raise.example.org/api/feedback/signal?')
        && (await readSignalState(root)).pending.length === 0,
      'Ids deduplicated; the text carries ids and a link, no issue words');

    // The gap: a report right after a fire waits for MIN_GAP_MS.
    await queueSignal(root, ['0005'], on(root), at(40_000 + QUIET_MS + 1000));
    const gapped = await tickSignal(root, on(root), { now: at(40_000 + QUIET_MS + 1000 + QUIET_MS), fetch: fake });
    const later = await tickSignal(root, on(root), { now: at(40_000 + QUIET_MS + MIN_GAP_MS), fetch: fake });
    check('Feedback signal: at most one fire per gap; what came in between rides the next one',
      gapped === 'waiting' && later === 'fired' && calls.length === 2 && String(calls[1]!.init.body).includes('0005'),
      `MIN_GAP_MS ${MIN_GAP_MS}`);

    // Failure: kept, backed off, then sent.
    const t0 = 40_000 + QUIET_MS + 2 * MIN_GAP_MS;
    await queueSignal(root, ['0006'], on(root), at(t0));
    answer = 503;
    const failed = await tickSignal(root, on(root), { now: at(t0 + QUIET_MS), fetch: fake });
    const held = await tickSignal(root, on(root), { now: at(t0 + QUIET_MS + 1000), fetch: fake });
    answer = 'throw';
    const thrown = await tickSignal(root, on(root), { now: at(t0 + QUIET_MS + 61_000), fetch: fake });
    const afterThrow = await readSignalState(root);
    answer = 200;
    const recovered = await tickSignal(root, on(root), { now: at(t0 + QUIET_MS + 61_000 + 5 * 60_000), fetch: fake });
    const clean = await readSignalState(root);
    check('Feedback signal: a refused or failed fire keeps the ids, backs off, and sends them later',
      failed === 'failed' && held === 'waiting' && thrown === 'failed' && afterThrow.failures === 2 && afterThrow.pending.includes('0006')
        && recovered === 'fired' && clean.pending.length === 0 && clean.failures === 0 && clean.lastError === null && calls.length === 5,
      'Backoff 1 minute, then 5; a network error counts as a failure');

    // The link.
    const ids = ['0002', '0003'];
    const { url } = readLink('https://raise.example.org', TOKEN, ids, Date.parse('2026-10-07T03:00:00Z'));
    const q = new URL(url).searchParams;
    const exp = Number(q.get('exp')), s = q.get('sig')!;
    const now = Date.parse('2026-10-07T03:00:00Z');
    check('Feedback signal: the read link verifies only for its ids, its expiry and its token',
      verifyRead(TOKEN, ids, exp, s, now) && !verifyRead(TOKEN, ['0002', '0004'], exp, s, now) && !verifyRead(TOKEN, ids, exp + 1, s, now)
        && !verifyRead('another-invented-token-xxxxxxxx', ids, exp, s, now) && !verifyRead(TOKEN, ids, exp, s, exp * 1000)
        && !verifyRead(TOKEN, ids, exp, 'zz', now) && !verifyRead(TOKEN, ids, Number.NaN, s, now),
      'Tampered ids, expiry, token or signature all refuse');

    const mac = signalText(['0007'], { ...on(root), origin: undefined });
    check('Feedback signal: with no public address (the Mac app) the signal names the folder and carries no link',
      !mac.includes('http') && mac.includes('0007') && mac.includes(relative(process.cwd(), root)), mac.split('\n').slice(-1)[0]!);

    const okUrl = (() => { try { return FEEDBACK_SIGNAL_URL_SETTING.validate(` ${URL_} `) === URL_; } catch { return false; } })();
    const badUrls = ['https://example.org/fire', 'http://api.anthropic.com/v1/claude_code/routines/trig_01InventedFixture00/fire',
      'https://api.anthropic.com/v1/claude_code/routines/trig_01InventedFixture00/fire?x=1'].every((u) => { try { FEEDBACK_SIGNAL_URL_SETTING.validate(u); return false; } catch { return true; } });
    const badToken = (() => { try { FEEDBACK_SIGNAL_TOKEN_SETTING.validate('has space in it xxxxxxxxxxxx'); return false; } catch { return true; } })();
    check('Feedback signal: settings take only a routine fire URL on api.anthropic.com and a header-safe token',
      okUrl && badUrls && badToken, 'Invented values');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  // The read route, on an invented issue with an invented screenshot.
  {
    const { fileIssueSink } = await import('../../lib/issues/file');
    const { config } = await import('../../config/deployment');
    const { GET } = await import('../../app/api/feedback/signal/route');
    const dir = await mkdtemp(join(tmpdir(), 'plcos-fictional-signal-issues-'));
    const savedDir = config.issues.dir, savedToken = process.env.FEEDBACK_SIGNAL_TOKEN;
    try {
      const rel = relative(process.cwd(), dir);
      Object.assign(config.issues, { dir: rel });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const created = await fileIssueSink(rel).create({ title: 'Invented signal fixture', body: 'Fixture only.', kind: 'bug', priority: 'P2',
        reporter: 'fixture', page: '/today', labels: [], context: null,
        attachments: [{ kind: 'screenshot', contentType: 'image/png', base64: png.toString('base64') }] });
      const other = await fileIssueSink(rel).create({ title: 'Invented other fixture', body: 'Not in the link.', kind: 'bug', priority: 'P2',
        reporter: 'fixture', page: '/today', labels: [], context: null,
        attachments: [{ kind: 'screenshot', contentType: 'image/png', base64: png.toString('base64') }] });
      const get = (url: string) => GET(new Request(url));
      const link = (ids: string[]) => readLink('http://localhost', 'invented-route-token-xxxxxxxxxxxx', ids).url;

      delete process.env.FEEDBACK_SIGNAL_TOKEN;
      const off = await get(link([created.id]));
      process.env.FEEDBACK_SIGNAL_TOKEN = 'invented-route-token-xxxxxxxxxxxx';
      const ok = await get(link([created.id]));
      const json = (await ok.json()) as { items: Array<{ id: string; markdown: string | null }>; missing: string[] };
      const tampered = await get(link([created.id]).replace(`ids=${created.id}`, `ids=${other.id}`));
      const badIds = await get(link([created.id]).replace(`ids=${created.id}`, 'ids=..%2Fx'));
      const shot = created.attachments[0]!;
      const file = await get(`${link([created.id])}&file=${encodeURIComponent(shot)}`);
      const otherFile = await get(`${link([created.id])}&file=${encodeURIComponent(other.attachments[0]!)}`);
      const escape = await get(`${link([created.id])}&file=${encodeURIComponent('../../package.json')}`);
      const missing = await get(link([created.id, '9999']));
      check('Feedback signal route: 404 when off; reads only the linked issues and their own attachments; refuses tampering',
        off.status === 404 && ok.status === 200 && ok.headers.get('cache-control') === 'no-store'
          && json.items.length === 1 && json.items[0]!.id === created.id && !!json.items[0]!.markdown?.includes('Invented signal fixture')
          && tampered.status === 401 && badIds.status === 400
          && file.status === 200 && file.headers.get('content-type') === 'image/png' && Buffer.from(await file.arrayBuffer()).equals(png)
          && otherFile.status === 404 && escape.status === 404
          && ((await missing.json()) as { missing: string[] }).missing.join() === '9999',
        'Two invented issues in a temporary folder');
    } finally {
      Object.assign(config.issues, { dir: savedDir });
      if (savedToken === undefined) delete process.env.FEEDBACK_SIGNAL_TOKEN;
      else process.env.FEEDBACK_SIGNAL_TOKEN = savedToken;
      await rm(dir, { recursive: true, force: true });
    }
  }
}
