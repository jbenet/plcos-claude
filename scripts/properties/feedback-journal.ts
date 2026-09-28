/**
 * The feedback journal (Juan, 27 Sep: feedback lost while an import pegged the server). The browser
 * keeps each report and resends it; these hold the three rules that make that safe: the server
 * files one issue per client id however often it is sent, the resends follow the backoff, and an
 * entry leaves the journal only on a confirmed issue number. Invented fixtures only.
 */
import type { Check } from './harness';
import {
  BACKOFF_CAP_MS, BACKOFF_MS, classify, due, isClientId, retryDelay, settle, type JournalEntry,
} from '../../lib/feedback-journal';
import { newRequestKey } from '../../lib/request-key';

const entry = (clientId: string, over: Partial<JournalEntry> = {}): JournalEntry => ({
  clientId,
  createdAt: '2026-09-27T12:00:00.000Z',
  request: {
    title: 'Invented report', body: 'Fixture only.', kind: 'bug', priority: 'P2', page: '/today',
    context: {}, screenshots: [], images: [], imageOffset: 0,
  },
  attempts: 0, nextAt: 0, lastError: null, refused: false,
  ...over,
} as JournalEntry);

export async function feedbackJournalProperties(check: Check) {
  // ---------------------------------------------------------------- backoff
  {
    const first = [1, 2, 3, 4, 5, 6, 50, 1000].map(retryDelay);
    const monotone = Array.from({ length: 200 }, (_, i) => retryDelay(i + 1)).every((d, i, all) => i === 0 || d >= all[i - 1]!);
    const odd = [0, -3, Number.NaN, Number.POSITIVE_INFINITY].map(retryDelay);
    check('Feedback journal: resends back off 5 s, 15 s, 60 s, then every 2 minutes, never faster and never slower',
      first.join(',') === '5000,15000,60000,120000,120000,120000,120000,120000'
        && BACKOFF_MS.join(',') === '5000,15000,60000' && BACKOFF_CAP_MS === 120_000
        && monotone && odd.every((d) => d === 5_000),
      `delays after 1–6, 50 and 1,000 failures: ${first.map((d) => d / 1000).join(', ')} s; nonsense counts wait 5 s`);

    // Through settle: each unconfirmed send reschedules at now + the delay for its new count.
    let list = [entry('a1b2c3d4-0000-4000-8000-000000000001')];
    const waits: number[] = [];
    let now = 1_000_000;
    for (let i = 0; i < 7; i++) {
      list = settle(list, list[0]!.clientId, { kind: 'retry', error: 'No answer within 8 s' }, now);
      waits.push(list[0]!.nextAt - now);
      now = list[0]!.nextAt;
    }
    check('Feedback journal: each unconfirmed send counts once and waits the schedule’s delay for that count',
      waits.join(',') === '5000,15000,60000,120000,120000,120000,120000' && list[0]!.attempts === 7
        && !due(list[0]!, now - 1, false) && due(list[0]!, now, false) && due(list[0]!, now - 1, true),
      `waits ${waits.map((w) => w / 1000).join(', ')} s; due on its clock, or at once on a kick`);
  }

  // ---------------------------------------------------------------- removal only on a confirmed id
  {
    let seed = 20260927;
    const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const statuses = [null, 200, 201, 204, 302, 400, 403, 404, 408, 413, 429, 500, 502, 503] as const;
    let removedWrongly = 0, keptWrongly = 0, touchedOthers = 0, refusedWrongly = 0, runs = 0;
    for (let trial = 0; trial < 300; trial++) {
      let list = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => entry(newRequestKey()));
      for (let step = 0; step < 12 && list.length; step++) {
        runs += 1;
        const target = pick(list);
        const other = newRequestKey();
        const status = pick(statuses);
        const json = pick([
          null, 'not json', {}, { error: 'Invented refusal' },
          { id: '0042', clientId: target.clientId },
          { id: '0042', clientId: target.clientId, repeat: true },
          { id: '0042' },
          { id: '0042', clientId: other },
          { id: 'NaN', clientId: target.clientId },
          { id: '', clientId: target.clientId },
          { id: 42, clientId: target.clientId },
          { location: 'issues/0042-x.md', clientId: target.clientId },
          { journaled: true, clientId: target.clientId },
          { journaled: true, clientId: target.clientId, repeat: true, id: '0042' },
          { journaled: true },
          { journaled: true, clientId: other },
          { journaled: 'yes', clientId: target.clientId },
        ] as const);
        const outcome = classify(target.clientId, status, json, status === null ? 'Could not reach the server' : undefined);
        const echoed = !!json && typeof json === 'object' && 'clientId' in json && json.clientId === target.clientId;
        const confirmed = status !== null && status >= 200 && status < 300 && echoed && (
          ('journaled' in json && json.journaled === true)
          || ('id' in json && typeof json.id === 'string' && /^\d+$/.test(json.id)));
        const before = list;
        list = settle(list, target.clientId, outcome, 5_000_000 + step);
        const gone = !list.some((e) => e.clientId === target.clientId);
        if (gone && !confirmed) removedWrongly += 1;
        if (!gone && confirmed) keptWrongly += 1;
        for (const e of before) if (e.clientId !== target.clientId && !list.includes(e)) touchedOthers += 1;
        const shouldRefuse = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
        const after = list.find((e) => e.clientId === target.clientId);
        if (after && after.refused !== shouldRefuse) refusedWrongly += 1;
        if (after && due(after, Number.MAX_SAFE_INTEGER, true) === after.refused) refusedWrongly += 1;
      }
    }
    check('Feedback journal: an entry leaves this browser only when a 2xx says the server journaled or filed it, echoing its client id',
      removedWrongly === 0 && keptWrongly === 0 && touchedOthers === 0,
      `${runs} invented sends over 300 journals (timeouts, 5xx, redirects, empty and foreign 200s): ${removedWrongly} removed unconfirmed, ${keptWrongly} kept confirmed, ${touchedOthers} other entries touched`);
    check('Feedback journal: a 4xx refusal waits for Retry now; timeouts, 408, 429 and 5xx retry on the clock',
      refusedWrongly === 0,
      `${refusedWrongly} entries marked wrongly; a refused entry is never due, even on a kick`);

    const id = newRequestKey();
    const note = { ...entry(id), target: 'connection' as const, request: { lp: newRequestKey(), page: '/routes', text: 'Invented note.' } };
    const ok = classify(id, 200, { id, at: '2026-09-27T12:00:00Z' }, undefined, 'connection');
    const noTime = classify(id, 200, { id }, undefined, 'connection');
    const journaledNote = classify(id, 202, { journaled: true, clientId: id }, undefined, 'connection');
    const foreign = classify(id, 200, { id: newRequestKey(), at: '2026-09-27T12:00:00Z' }, undefined, 'connection');
    check('Feedback journal: a connection note leaves only on a receipt with its own id and a time',
      ok.kind === 'filed' && noTime.kind === 'retry' && foreign.kind === 'retry' && journaledNote.kind === 'journaled'
        && settle([note], id, noTime, 0).length === 1 && settle([note], id, ok, 0).length === 0,
      'receipt without a time, or for another note, keeps it');
  }

  // ---------------------------------------------------------------- dedupe by client id
  {
    const { mkdtemp, readdir, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, relative } = await import('node:path');
    const { fileIssueSink } = await import('../../lib/issues/file');
    const dir = await mkdtemp(join(tmpdir(), 'plcos-fictional-journal-'));
    try {
      const sink = fileIssueSink(relative(process.cwd(), dir));
      const draft = (clientId?: string, title = 'Invented journal report') => ({
        title, body: 'Fixture only.', kind: 'bug' as const, priority: 'P2' as const, reporter: 'fixture',
        page: '/today', labels: [], context: null, ...(clientId ? { clientId } : {}),
      });
      const a = newRequestKey();
      const first = await sink.create(draft(a));
      const resent = await sink.create(draft(a, 'A resend may even carry different words'));
      // A resend racing the first write, as after a timeout while the server was stalled.
      const b = newRequestKey();
      const racing = await Promise.all(Array.from({ length: 6 }, () => sink.create(draft(b))));
      // Without a client id, concurrent creates still take distinct numbers.
      const plain = await Promise.all(Array.from({ length: 4 }, () => sink.create(draft())));
      // A status change keeps the key, and a resend after it still finds the issue.
      await sink.update(first.id, { status: 'triaged' });
      const afterEdit = await sink.create(draft(a));
      const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
      const text = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
      const withA = text.filter((t) => t.includes(`client_id: ${a}`)).length;
      const withB = text.filter((t) => t.includes(`client_id: ${b}`)).length;
      const racingIds = new Set(racing.map((r) => r.id));
      const plainIds = new Set(plain.map((r) => r.id));
      check('Feedback journal: the server files one issue per client id, however often and however concurrently it is sent',
        resent.id === first.id && resent.repeat === true && first.repeat === undefined
          && racingIds.size === 1 && racing.filter((r) => r.repeat).length === 5
          && afterEdit.id === first.id && afterEdit.repeat === true
          && withA === 1 && withB === 1 && files.length === 6 && plainIds.size === 4,
        `${files.length} files for 2 keyed reports sent 9 times and 4 unkeyed ones; the key survives a status change`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    check('Feedback journal: the route accepts only a plain client id, never something that could name a path',
      isClientId(newRequestKey()) && !isClientId('../../etc/passwd') && !isClientId('short') && !isClientId('x'.repeat(65))
        && !isClientId(42) && !isClientId(undefined) && !isClientId('a b c d e f g h'),
      'a v4 UUID passes; traversal, short, long, spaced and non-string ids are refused');
  }

  // ---------------------------------------------------------------- the server's journal
  {
    const { mkdtemp, readdir, readFile, rm, writeFile, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, relative } = await import('node:path');
    const inbox = await import('../../lib/feedback-inbox');
    const { ingestInbox } = await import('../../lib/feedback-ingest');
    const { fileIssueSink } = await import('../../lib/issues/file');
    const root = await mkdtemp(join(tmpdir(), 'plcos-fictional-inbox-'));
    const report = (clientId: string, title = 'Invented journaled report'): import('../../lib/feedback-inbox').InboxEntry => ({
      kind: 'issue', clientId, receivedAt: new Date().toISOString(), reporter: 'fixture',
      request: { title, body: 'Fixture only.', kind: 'bug', priority: 'P2', page: '/today', context: {}, screenshots: [], images: [], imageOffset: 0 },
    });
    try {
      // Atomic and idempotent: one id journaled twelve times at once and twice after is one complete file, no temporaries.
      const a = newRequestKey();
      const at = await Promise.all(Array.from({ length: 12 }, () => inbox.journal(root, report(a))));
      const again = await inbox.journal(root, report(a, 'A resend with other words'));
      const names = await readdir(inbox.inboxDir(root));
      const kept = JSON.parse(await readFile(join(inbox.inboxDir(root), `${a}.json`), 'utf8')) as { request: { title: string } };
      let traversal = false;
      try { await inbox.journal(root, report('../../escape')); } catch { traversal = true; }
      check('Feedback journal (server): a write is atomic and a client id is journaled once, however often and however concurrently it arrives',
        names.filter((n) => n.endsWith('.json')).length === 1 && !names.some((n) => n.endsWith('.tmp'))
          && at.filter((r) => r.already === null).length >= 1 && again.already === 'journaled'
          && kept.request.title === 'Invented journaled report' && traversal
          && (await inbox.inboxStatus(root, a))?.state === 'journaled',
        `${names.length} file for 14 sends, no temporary left, the first words kept; a path-like id is refused`);

      // A crash mid-write leaves only a temporary, which is never read as an entry.
      await writeFile(join(inbox.inboxDir(root), `.${newRequestKey()}.json.abc.tmp`), '{"half":');
      const ids = await inbox.inboxIds(root);
      check('Feedback journal (server): a half-written temporary is never taken for a report',
        ids.length === 1 && ids[0] === a, `${ids.length} entry listed beside a stray temporary`);

      // Ingest: files once, moves to filed/, and a resend after filing is told the number.
      await mkdir(join(root, 'issues'), { recursive: true });
      const sink = fileIssueSink(relative(process.cwd(), join(root, 'issues')));
      const fileIssue = async (e: Extract<import('../../lib/feedback-inbox').InboxEntry, { kind: 'issue' }>) => {
        const issue = await sink.create({ title: e.request.title, body: e.request.body, kind: 'bug', priority: 'P2', reporter: 'fixture', page: e.request.page, labels: [], context: null, clientId: e.clientId });
        return { id: issue.id, location: issue.location, title: issue.title };
      };
      const b = newRequestKey();
      await inbox.journal(root, report(b, 'Invented second report'));
      const first = await ingestInbox({ issuesRoot: root, fileIssue });
      const resent = await inbox.journal(root, report(a));
      // As if the server died between writing the issue and moving the entry: the entry is back in the inbox.
      await mkdir(inbox.inboxDir(root), { recursive: true });
      await writeFile(join(inbox.inboxDir(root), `${b}.json`), JSON.stringify(report(b, 'Invented second report')));
      const second = await ingestInbox({ issuesRoot: root, fileIssue });
      const issues = (await readdir(join(root, 'issues'))).filter((n) => n.endsWith('.md'));
      const statusA = await inbox.inboxStatus(root, a);
      const statusB = await inbox.inboxStatus(root, b);
      check('Feedback journal (server): ingest files each journaled report once, moves it to filed/, and a crash between the two files nothing twice',
        first.filed === 2 && first.waiting === 0 && resent.already === 'filed' && resent.filed?.issueId === '0001'
          && second.filed === 1 && issues.length === 2
          && statusA?.state === 'filed' && statusB?.state === 'filed' && (await inbox.inboxIds(root)).length === 0,
        `${issues.length} issues for 2 reports ingested three times; a resend after filing learns issue ${resent.filed?.issueId}`);

      // A failure stays in the inbox and is retried; a later pass files it.
      const c = newRequestKey();
      await inbox.journal(root, report(c, 'Invented third report'));
      const failing = await ingestInbox({ issuesRoot: root, fileIssue: async () => { throw new Error('invented disk error'); } });
      const stillThere = (await inbox.inboxStatus(root, c))?.state;
      const recovered = await ingestInbox({ issuesRoot: root, fileIssue });
      check('Feedback journal (server): a failed filing stays in the inbox and files on a later pass',
        failing.failed === 1 && failing.waiting === 1 && stillThere === 'journaled'
          && recovered.filed === 1 && (await inbox.inboxStatus(root, c))?.state === 'filed',
        'one pass fails, the entry waits, the next pass files it');

      // Validation before journaling.
      const big = 'A'.repeat(4_000_000);
      const checks = [
        inbox.checkReport({ body: '' }), inbox.checkReport({ title: 'x', screenshots: ['data:image/jpeg;base64,AAAA'] }),
        inbox.checkReport({ title: 'x', images: [{ dataUrl: 'data:text/html;base64,AAAA' }] }),
        inbox.checkReport({ title: 'x', screenshots: Array.from({ length: 11 }, () => `data:image/png;base64,${big}`) }),
      ];
      const good = inbox.checkReport({ body: 'Something broke on the invented page.', kind: 'nonsense', priority: 'P9', screenshots: ['data:image/png;base64,AAAA'] });
      check('Feedback journal (server): a report is checked before it is journaled; refusals say why, with the right status',
        checks.map((r) => (r.ok ? 'ok' : r.status)).join(',') === '400,400,400,413'
          && good.ok && good.value.kind === 'bug' && good.value.priority === 'P2' && good.value.title.length > 0
          && inbox.attachmentsOf(good.value).length === 1,
        'no words, a JPEG screenshot, an HTML attachment and 44 MB of pictures refused; odd kind and priority fall back');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  await reporterProperties(check);

  // ---------------------------------------------------------------- the route never waits on the database
  {
    const { readFileSync, existsSync } = await import('node:fs');
    const { dirname, join, relative } = await import('node:path');
    const cwd = process.cwd();
    const resolveFrom = (from: string, spec: string): string | null => {
      const base = spec.startsWith('@/') ? join(cwd, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
      if (!base) return null; // a package: next, node:*
      for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && !c.endsWith('/') && /\.tsx?$/.test(c)) return c;
      return null;
    };
    const walk = (entry: string) => {
      const seen = new Set<string>();
      const todo = [join(cwd, entry)];
      while (todo.length) {
        const f = todo.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        const text = readFileSync(f, 'utf8');
        // Static imports and re-exports only; `import type` is erased, `import()` runs after the response.
        for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
          const next = resolveFrom(f, m[1]!);
          if (next) todo.push(next);
        }
      }
      return [...seen].map((f) => relative(cwd, f));
    };
    const forbidden = (f: string) => /^lib\/db\/|^modules\/|^lib\/auth\/(?:index|local)\.ts$|^lib\/feedback-ingest\.ts$/.test(f);
    const chains = ['app/api/feedback/route.ts', 'app/api/connection-feedback/route.ts'].map((r) => [r, walk(r)] as const);
    const bad = chains.flatMap(([r, files]) => files.filter(forbidden).map((f) => `${r} → ${f}`));
    check('Feedback journal (server): the feedback routes load nothing that opens or waits on the database',
      bad.length === 0 && chains.every(([, files]) => files.includes('lib/feedback-inbox.ts')),
      bad.length ? bad.join('; ') : `${chains.map(([r, files]) => `${r}: ${files.length} files`).join('; ')}, none under lib/db, modules or auth`);
  }
}

/** The journal selector is untrusted; only resolved app_user rows can name the reporter. */
async function reporterProperties(check: Check) {
  const [{ openTestDb }, { migrate }, { withDb }, { mkdtemp, rm }, { tmpdir }, { join, relative }, inbox, { ingestInbox }, { fileIssueSink }] = await Promise.all([
    import('./database'), import('../../lib/db/migrate'), import('../../lib/db'), import('node:fs/promises'),
    import('node:os'), import('node:path'), import('../../lib/feedback-inbox'), import('../../lib/feedback-ingest'), import('../../lib/issues/file'),
  ]);
  const db = await openTestDb();
  const root = await mkdtemp(join(tmpdir(), 'plcos-reporter-fixture-'));
  const sink = fileIssueSink(relative(process.cwd(), root));
  const opts = { issuesRoot: root, sink };
  const report = (reporter: string | null): import('../../lib/feedback-inbox').InboxEntry => ({
    kind: 'issue', clientId: newRequestKey(), receivedAt: '2026-09-28T00:00:00.000Z', reporter,
    request: {
      title: 'Invented reporter fixture', body: 'Fixture only.', kind: 'bug', priority: 'P2', page: '/invented',
      context: { user: 'forged-client', reporterVerification: 'forged-client' }, screenshots: [], images: [], imageOffset: 0,
    },
  });
  try {
    await migrate(db);
    await db.exec(`insert into platform.app_user (handle,name,initials,role,email,active,created_at) values
      ('fixture-first','Invented First','IF','team','first@example.invalid',true,'2026-01-01'),
      ('fixture-selected','Invented Selected','IS','team','selected@example.invalid',true,'2026-01-02'),
      ('fixture-inactive','Invented Inactive','II','team','inactive@example.invalid',false,'2026-01-03')`);
    for (const selector of ['fixture-selected', null, 'forged-selector', 'fixture-inactive']) await inbox.journal(root, report(selector));
    const filed = await withDb(db, () => ingestInbox(opts));
    const issues = await sink.list({});
    check('Feedback reporter: journal selectors resolve to active app_users before the file is written',
      filed.filed === 4 && issues.filter(i => i.reporter === 'fixture-selected').length === 1
        && issues.filter(i => i.reporter === 'fixture-first').length === 3
        && issues.every(i => i.context?.user === i.reporter && i.context?.reporterVerification === 'verified'),
      'Selected, missing, forged and inactive selectors use the same server resolver as local auth; client context cannot replace the reporter.');

    // A query failure is not evidence that no user exists. Keep the journal intact until retry.
    const waiting = report('fixture-selected');
    await inbox.journal(root, waiting);
    const unavailable: import('../../lib/db').Db = {
      kind: db.kind, query: db.query.bind(db), exec: db.exec.bind(db), transaction: db.transaction.bind(db), close: async () => {},
      one: async () => { throw new Error('Invented reporter lookup unavailable'); },
    };
    const failed = await withDb(unavailable, () => ingestInbox(opts));
    const pending = await inbox.inboxStatus(root, waiting.clientId);
    const retried = await withDb(db, () => ingestInbox(opts));
    check('Feedback reporter: a failed lookup stays journaled and retries with a resolved actor',
      failed.failed === 1 && pending?.state === 'journaled' && retried.filed === 1
        && (await sink.list({})).filter(i => i.reporter === 'fixture-selected').length === 2,
      'A temporary database failure never files unknown or drops the durable report.');

    // Metadata is asynchronous. Wait for its completion before inspecting identity and closing this fixture database.
    let audits: Array<{ handle: string; subject_id: string | null }> = [];
    for (let attempt = 0; attempt < 200; attempt++) {
      audits = await db.query('select u.handle,a.subject_id from platform.audit_log a join platform.app_user u on u.id=a.actor_id where a.action = $1', ['feedback.filed']);
      if (audits.length === 5) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const metadata = await db.query<{ issue_ref: string; handle: string; context: Record<string, unknown> }>(
      'select f.issue_ref,u.handle,f.context from platform.feedback f join platform.app_user u on u.id=f.reporter_id');
    const known = await sink.list({});
    check('Feedback reporter: issue, database receipt and audit share the resolved app_user',
      audits.length === 5 && metadata.length === 5
        && metadata.every(m => known.find(i => i.id === m.issue_ref)?.reporter === m.handle && m.context.user === m.handle
          && audits.some(a => a.subject_id === m.issue_ref && a.handle === m.handle)),
      'Both database backends persist five invented reports with verified actor metadata.');

    await db.exec('update platform.app_user set active = false');
    const unresolved = report('fixture-selected');
    await inbox.journal(root, unresolved);
    const unknown = await withDb(db, () => ingestInbox(opts));
    const unknownIssues = (await sink.list({})).filter(i => i.reporter === 'unknown');
    check('Feedback reporter: unknown is reserved for a successful lookup with no active users',
      unknown.filed === 1 && unknownIssues.length === 1
        && unknownIssues[0]!.context?.user === 'unknown'
        && unknownIssues[0]!.context?.reporterVerification === 'no active app_user resolved'
        && (await db.query('select id from platform.feedback')).length === 5,
      'No invented user or audit actor is substituted when the active app_user set is empty.');
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}
