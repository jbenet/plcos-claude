import type { Check } from './harness';

export async function issueProperties(check: Check) {
  {
    const { spawnSync } = await import('node:child_process');
    const run = (value: string | undefined, fallback: string[]) => spawnSync('bash',
      ['scripts/env-or-command.sh', 'FIXTURE_SECRET', ...fallback],
      { env: { NODE_ENV: 'test', PATH: process.env.PATH, FIXTURE_SECRET: value }, encoding: 'utf8' });
    const values = ['invented', 'spaces $() `literal` "quotes"', 'line\nbreak'];
    const preferred = values.map(value => run(value, ['false']));
    const absent = [undefined, ''].map(value => run(value, ['printf', '%s', 'invented-fallback']));
    check('Credentials: env values bypass the fallback; missing values preserve fallback output and failure',
      preferred.every((r, i) => r.status === 0 && r.stdout === values[i] && r.stderr === '')
        && absent.every(r => r.status === 0 && r.stdout === 'invented-fallback' && r.stderr === '')
        && run(undefined, ['false']).status === 1,
      'Invented credentials only; no Keychain or network access, no shell evaluation of values.');
  }
  {
    const { issueVelocity } = await import('../../lib/issues/velocity');
    const now = new Date('2026-09-26T13:00:00Z');
    const velocity = issueVelocity([
      { status: 'open', created: '2026-08-01T00:00:00Z' },
      { status: 'done', created: '2026-08-28T00:00:00Z', closedAt: '2026-09-02T12:00:00Z' },
      { status: 'done', created: '2026-09-01T00:00:00Z' },
      { status: 'in-progress', created: '2026-09-26T00:00:00Z' },
      { status: 'done', created: '2026-08-01T00:00:00Z', closedAt: '2026-08-27T23:59:59Z' },
      // Reopened: a stale closure must not count as done.
      { status: 'open', created: '2026-09-03T00:00:00Z', closedAt: '2026-09-04T00:00:00Z' },
    ], now);
    check('Issue velocity has 30 UTC days, counts boundaries and ignores stale closures on reopened issues',
      velocity.days.length === 30 && velocity.days[0]!.date === '2026-08-28'
        && velocity.days.at(-1)!.date === '2026-09-26' && velocity.filed === 4
        && velocity.closed === 1 && velocity.open === 3,
      `filed ${velocity.filed}, dated closures ${velocity.closed}, open ${velocity.open}`);
    const sept1 = velocity.days.find((d) => d.date === '2026-09-01')!;
    const sept2 = velocity.days.find((d) => d.date === '2026-09-02')!;
    check('Undated closures yield historical open bounds; a dated closure leaves the queue that day',
      velocity.undatedClosures === 1 && sept1.openMin === 2 && sept1.openMax === 3
        && sept2.openMin === 1 && sept2.openMax === 2
        && velocity.days.at(-1)!.openMin === 3 && velocity.days.at(-1)!.openMax === 3,
      'Fictional closed issue without a date stays unknown; today agrees with the current queue');
    const invalid = issueVelocity([
      { status: 'done', created: '2026-09-01', closedAt: '2026-08-01' },
      { status: 'done', created: '2026-09-01', closedAt: '2026-09-27' },
      { status: 'open', created: 'not a date' },
      { status: 'done', created: '2026-02-30', closedAt: '2026-09-20' },
    ], now);
    const offset = issueVelocity([{ status: 'done', created: '2026-08-27T23:30:00-02:00', closedAt: '2026-09-01T23:30:00-02:00' }], now);
    check('Issue timestamps with offsets are grouped by their UTC day',
      offset.days[0]!.filed === 1 && offset.days.find((d) => d.date === '2026-09-02')!.closed === 1,
      'Both local dates cross midnight in UTC');
    const empty = issueVelocity([], now);
    check('Missing, invalid, future and reversed issue dates never fabricate activity; empty days remain zero',
      invalid.closed === 1 && invalid.undatedClosures === 2 && invalid.undatedFiled === 2
        && empty.days.every((d) => d.filed === 0 && d.closed === 0 && d.openMax === 0),
      'Invalid dates are disclosed, and all 30 empty days are retained');
  }

  {
    const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, relative } = await import('node:path');
    const { fileIssueSink } = await import('../../lib/issues/file');
    const { parseIssue } = await import('../../lib/issues/format');
    const dir = await mkdtemp(join(tmpdir(), 'plcos-fictional-issues-'));
    try {
      const sink = fileIssueSink(relative(process.cwd(), dir));
      const created = await sink.create({ title: 'Invented velocity fixture', body: 'Fixture only.',
        kind: 'bug', priority: 'P2', reporter: 'fixture', page: '/today', labels: [], context: null });
      const done = await sink.update(created.id, { status: 'done' });
      const edited = await sink.update(created.id, { priority: 'P1', status: 'done' });
      const reopened = await sink.update(created.id, { status: 'open' });
      check('Issue status writes record closure once, preserve it on edits, and clear it on reopen',
        Boolean(done.closedAt) && edited.closedAt === done.closedAt && reopened.closedAt === null,
        'Invented issue in a temporary directory, removed after the check');
      const legacy = (await readFile(created.location, 'utf8')).replace(/^status:.*$/m, 'status: review');
      await writeFile(created.location, legacy);
      const read = await sink.get(created.id);
      const open = await sink.list({ status: ['open', 'triaged', 'agent-ready', 'in-progress'] });
      await sink.update(created.id, { priority: 'P3' });
      const rewritten = await readFile(created.location, 'utf8');
      check('Legacy review reads as done, is excluded from open counts, and rewrites as done without inventing a closure date',
        read?.status === 'done' && open.length === 0 && /^status: done\s/m.test(rewritten)
          && !rewritten.includes('| review') && parseIssue(rewritten, created.id).closedAt === null,
        'Compatibility is at the file reader, so list, detail and rail counts agree');

      const { config } = await import('../../config/deployment');
      const { GET } = await import('../../app/api/feedback/export/route');
      const savedDir = config.issues.dir, savedToken = process.env.FEEDBACK_EXPORT_TOKEN;
      try {
        Object.assign(config.issues, { dir: relative(process.cwd(), dir) });
        const get = (since: string, authorization = '') => GET(new Request(
          `http://localhost/api/feedback/export?since=${encodeURIComponent(since)}`, { headers: { authorization } }));
        delete process.env.FEEDBACK_EXPORT_TOKEN;
        const disabled = await get('bad');
        process.env.FEEDBACK_EXPORT_TOKEN = 'invented-export-token';
        const denied = await Promise.all(['', 'Bearer wrong', 'Bearer invented-export-tokem'].map(auth => get('bad', auth)));
        const auth = 'Bearer invented-export-token';
        const invalid = await Promise.all(['', 'bad', '2026-09-28', '123'].map(since => get(since, auth)));
        const included = await get(new Date(Date.parse(created.created) - 1).toISOString(), auth);
        const excluded = await get(created.created, auth);
        const future = await get('9999-01-01T00:00:00Z', auth);
        check('Feedback export: disabled without token, bearer-only, validates since and reads only newer issues without writes',
          disabled.status === 404 && denied.every(r => r.status === 401) && invalid.every(r => r.status === 400)
            && included.status === 200 && included.headers.get('cache-control') === 'no-store'
            && JSON.stringify((await included.json()).items) === JSON.stringify(await sink.list())
            && (await excluded.json()).items.length === 0 && (await future.json()).items.length === 0
            && await readFile(created.location, 'utf8') === rewritten,
          'One temporary invented issue; strict created > since, including the exact boundary; file unchanged.');
      } finally {
        Object.assign(config.issues, { dir: savedDir });
        if (savedToken === undefined) delete process.env.FEEDBACK_EXPORT_TOKEN;
        else process.env.FEEDBACK_EXPORT_TOKEN = savedToken;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Triage writes `assignee:` and `branch:` into an issue's frontmatter (docs/COLLAB.md), and the
  // issues page rewrites the whole file when a status changes. The rewrite keeps what it does not
  // manage, and turns the old singular `screenshot:` into `screenshots:` without keeping both.
  {
    const { parseIssue, serializeIssue } = await import('../../lib/issues/format');
    const filed = [
      '---', 'id: "0999"', 'title: A made-up issue', 'status: open          # open | triaged',
      'kind: bug', 'priority: P2', 'reporter: juan', 'page: /today', 'created: 2026-09-25T00:00:00Z',
      'labels: []', 'screenshot: attachments/0999-screenshot.png',
      'assignee: chatgpt', 'branch: codex/0999-made-up', 'fixed_in: N99', '---', '', 'Something broke.', '',
    ].join('\n');
    const once = serializeIssue({ ...parseIssue(filed, '0999'), status: 'agent-ready' });
    const twice = serializeIssue(parseIssue(once, '0999'));
    const keys = once.split('\n').map((l) => /^([a-z_]+):/.exec(l)?.[1]).filter(Boolean);
    const count = (k: string) => keys.filter((x) => x === k).length;
    check(
      'Changing an issue’s status keeps its assignee, branch and other unmanaged fields, once each, and a second rewrite changes nothing',
      count('assignee') === 1 && count('branch') === 1 && count('fixed_in') === 1 && count('screenshot') === 0 &&
        count('screenshots') === 1 && /^status: agent-ready /m.test(once) && twice === once,
      `fields after the rewrite: ${keys.join(', ')}; stable on a second rewrite: ${twice === once}`,
    );

    // Issue 0113: a title with quotes or a backslash reads back as itself, and a line-end
    // backslash (a typed newline, as in a terminal) is not a title.
    const { titleFrom } = await import('../../lib/issues/title');
    const { checkReport } = await import('../../lib/feedback-inbox');
    const titles = ['\\', '"rail" is "odd"', "'quoted'", 'C:\\path\\to', 'Fix: the "rail"', '[not a list]', 'ends with a backslash \\',
      'a # hash', ' leading space', 'trailing space ', '#1 first', "it's fine", '{braces}', '"'];
    const base = parseIssue(filed, '0999');
    const lost = titles.filter((t) => parseIssue(serializeIssue({ ...base, title: t }), '0999').title !== t);
    const typed = checkReport({ body: '\\\nFirms and individuals in one list, please\\\nwith toggles' });
    check('0113 an issue title with quotes, a backslash, a bracket or a hash reads back exactly as written',
      lost.length === 0, lost.length ? `lost: ${lost.map((t) => JSON.stringify(t)).join(', ')}` : `${titles.length} awkward titles round-trip.`);
    check('0113 a backslash typed as a newline never becomes the title, and is dropped from the line ends it sat on',
      titleFrom('\\\nThe real first line') === 'The real first line' && titleFrom('\\') === '' && titleFrom('\\\n  \\\n') === ''
        && typed.ok && typed.value.title === 'Firms and individuals in one list, please'
        && typed.value.body === '\nFirms and individuals in one list, please\nwith toggles'
        && checkReport({ title: 'A title with a path C:\\temp inside', body: '' }).ok
        && (checkReport({ title: 'A title with a path C:\\temp inside', body: '' }) as { value: { title: string } }).value.title === 'A title with a path C:\\temp inside',
      'Only a backslash at the end of a line is read as a newline; one inside the text is kept.');
  }
}
