import type { Check } from './harness';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const realProcess = (code: string, env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '-e', code], {
      env: { ...process.env, DATA_PROFILE: 'real', PGLITE_DIR: '', DATABASE_URL: '', ...env },
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

export async function profileProperties(check: Check) {
  const inReal = realProcess;
  // ---------------------------------------------------------------- the real profile (N38)
  //
  // This process is pinned to the demo, so each of these asks a child process started in
  // the real profile. None of them opens the real database.


  const paths = inReal(
    `import('./config/deployment.ts').then(({ config: c }) => console.log(JSON.stringify([c.data.root, c.db.localDir, c.issues.dir])))`,
    { PGLITE_DIR: './somewhere-else' },
  );
  const where = (() => { try { return JSON.parse(paths.out.trim().split('\n').pop()!) as string[]; } catch { return []; } })();
  check(
    'The real profile keeps every path under data/real, even when PGLITE_DIR says otherwise',
    where.length === 3 && where.every((p) => p.replace(/^\.\//, '').startsWith('data/real')),
    where.length ? where.join(' · ') : `could not read the config: ${paths.out.slice(0, 200)}`,
  );

  const remote = inReal(`import('./config/deployment.ts').then(() => console.log('opened'))`, {
    DATABASE_URL: 'postgres://example.invalid/raise',
  });
  check(
    'The real profile refuses a remote database',
    remote.status !== 0 && remote.out.includes('DATABASE_URL is set in the real profile'),
    remote.status !== 0 ? 'refused at config load' : 'a DATABASE_URL was accepted',
  );

  const seeding = inReal(
    `import('./lib/seed.ts').then(async ({ seed }) => {
       let touched = 0;
       const db = new Proxy({}, { get: () => { touched++; return async () => []; } });
       try { await seed(db); console.log('seeded'); } catch (e) { console.log('refused', touched, e.message); }
     })`,
  );
  check(
    'Seeding refuses the real profile before it touches the database',
    /refused 0 Refusing to seed/.test(seeding.out),
    seeding.out.includes('refused') ? 'refused, with no call on the database' : `not refused: ${seeding.out.slice(0, 200)}`,
  );

  // Real-profile behavior, entirely fictional input and a new scratch database. Import
  // and migrate from the checkout, then change cwd before loadInit can read any init file.
  const init = inReal(`(async () => {
    const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
    const { openPglite } = await import('./lib/db/pglite.ts');
    const { migrate } = await import('./lib/db/migrate.ts');
    const { loadInit } = await import('./lib/real/init.ts');
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-init-cache-'));
    const cwd = process.cwd();
    let db;
    try {
      db = await openPglite(path.join(scratch, 'database'));
      await migrate(db);
      process.chdir(scratch);
      await fs.mkdir('data/real', { recursive: true });
      const file = { team: [{ handle: 'fixture', name: 'Invented Operator' }],
        vehicles: [{ slug: 'fixture-fund', name: 'Invented Fund', kind: 'fund', exemption: '506(c)', target: 1000000 }] };
      const write = () => fs.writeFile('data/real/init.jsonc', JSON.stringify(file));
      const snapshot = async () => ({
        revision: (await db.one('select revision::text from network.read_revision where singleton')).revision,
        sources: JSON.stringify(await db.query('select * from platform.source_sync order by source')),
        audits: (await db.one("select count(*)::int as n from platform.audit_log where action = 'init.loaded'")).n,
      });
      await write();
      await loadInit(db);
      const first = await snapshot();
      await loadInit(db);
      const second = await snapshot();
      file.team[0].name = 'Renamed Invented Operator';
      file.vehicles[0].target = 2000000;
      await write();
      await loadInit(db);
      const changed = await snapshot();
      const person = await db.one("select name from platform.app_user where handle = 'fixture'");
      const vehicle = await db.one("select target_amount::text as target from platform.vehicle where slug = 'fixture-fund'");
      await fs.writeFile('data/real/init.jsonc', '{}');
      const invalid = await loadInit(db);
      const afterInvalid = await snapshot();
      console.log('INIT_RESULT ' + JSON.stringify({
        stable: JSON.stringify(first) === JSON.stringify(second) && first.audits === 1,
        changed: changed.revision !== second.revision && changed.audits === 2
          && person.name === file.team[0].name && Number(vehicle.target) === file.vehicles[0].target,
        invalid: !invalid.init && invalid.problems.length > 0 && JSON.stringify(changed) === JSON.stringify(afterInvalid),
      }));
    } finally {
      process.chdir(cwd);
      if (db) await db.close();
      await fs.rm(scratch, { recursive: true, force: true });
    }
  })().catch(e => { console.error(e); process.exitCode = 1; });`);
  const initResult = (() => { try { return JSON.parse(init.out.match(/INIT_RESULT (.+)/)?.[1] ?? '{}') as Record<string, boolean>; } catch { return {}; } })();
  check('CACHE loading an unchanged init file preserves revisions, source status and its successful-load audit',
    init.status === 0 && initResult.stable === true,
    init.status === 0 ? 'Fictional init loaded twice in an isolated database; the second load wrote nothing.' : init.out.slice(-500));
  check('CACHE changed init applies and invalidates, while invalid init preserves the last successful state',
    init.status === 0 && initResult.changed === true && initResult.invalid === true,
    'Changed fictional name and target apply once; invalid replacement neither writes nor invalidates.');
}

export async function checkoutProperties(check: Check) {
  const inReal = realProcess;
  // The local layout (docs/COLLAB.md): a checkout's ports come from its row in .ports.json, only the
  // live folder serves the real data, a preview replaces nothing but its own copy, every server keeps
  // its own cookies, and a preview never holds the Affinity key. Fake checkouts, fake data.
  {
    const ports = await import('../../config/ports');
    const preview = await import('../preview-copy');
    const { mkdir: mk, readFile: rf, symlink, writeFile: wf } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const scratch = join(process.cwd(), 'data', 'demo', 'props-layout');
    await rm(scratch, { recursive: true, force: true });
    const file = await rf(join(process.cwd(), ports.PORTS_FILE), 'utf8');
    const common = join(scratch, 'plcos-claude-live', '.git');
    const checkout = async (name: string, worktree: boolean) => {
      const root = join(scratch, name);
      await mk(root, { recursive: true });
      await wf(join(root, ports.PORTS_FILE), file);
      if (worktree) {
        await mk(join(common, 'worktrees', name), { recursive: true });
        await wf(join(root, '.git'), `gitdir: ${join(common, 'worktrees', name)}\n`);
      } else {
        await mk(join(root, '.git'), { recursive: true });
      }
      return ports.readLayout(root);
    };
    const live = await checkout('plcos-claude-live', false);
    const dev = await checkout('plcos-claude-dev', true);
    const agent = await checkout('agent-a1b2', true);
    const missing = join(scratch, 'missing-layout');
    check('LIVE role preserves local layouts and treats LabOS as live without a layout',
      [live, dev, agent].every(l => ports.isLiveServer(l.root, {}) === (l.role === 'live'))
        && !ports.isLiveServer(missing, {})
        && [live.root, dev.root, agent.root, missing].every(root =>
          ports.isLiveServer(root, { LABOS_ME_URL: 'https://labos.invalid/me' }))
        && !ports.isLiveServer(dev.root, { LABOS_ME_URL: '' }),
      'Invented live/dev/unlisted/missing checkouts; unset and empty LabOS preserve Mac roles.');
    type L = typeof live;
    const port = (s: 'demo' | 'real' | 'preview', l: L, env: Record<string, string> = {}) => {
      try { return ports.portFor(s, l, env); } catch (e) { return e instanceof Error ? e.message : String(e); }
    };
    check(
      'Ports come from the folder’s row: the live folder takes 3000 and 3001, a dev worktree its own two, and PORT changes only the number',
      port('real', live) === 3000 && port('demo', live) === 3001 &&
        port('preview', dev) === 3100 && port('demo', dev) === 3101 && port('demo', agent, { PORT: '3110' }) === 3110 && port('preview', dev, { PORT: '3290' }) === 3290,
      `live ${port('real', live)}/${port('demo', live)}; dev ${port('preview', dev)}/${port('demo', dev)}; a sub-agent’s with PORT=3110: ${port('demo', agent, { PORT: '3110' })}`,
    );
    const devReal = port('real', dev, { PORT: '3100' });
    const livePreview = port('preview', live);
    const noRow = port('demo', agent);
    check(
      'Only a live row serves the real data, whatever PORT says; a live row serves no preview; a folder with no row and no PORT is told which file to fix',
      devReal === 'This folder serves a copy: use npm run preview.' && typeof livePreview === 'string' &&
        typeof port('real', agent, { PORT: '3110' }) === 'string' && typeof noRow === 'string' && noRow.includes(ports.PORTS_FILE),
      `dev:real in a dev worktree: ${devReal}; preview in the live folder: ${livePreview}; no row: ${noRow}`,
    );
    const liveOf = (l: L) => (l.live === null ? 'none' : `${l.live.real}/${l.live.demo}`);
    const devHome = ports.feedbackHome('real', dev.root);
    const liveFiles = ports.feedbackHome('demo', live.root).filesHere;
    check(
      'Every worktree finds the live app through .git, and only the live folder files feedback; a dev worktree points at the live app instead',
      liveOf(dev) === '3000/3001' && liveOf(agent) === '3000/3001' && liveOf(live) === '3000/3001' && agent.role === 'dev' &&
        liveFiles && !devHome.filesHere && devHome.livePort === 3000 && !ports.feedbackHome('demo', agent.root).filesHere,
      `live app from a dev worktree: ${liveOf(dev)}, from a sub-agent’s: ${liveOf(agent)}; feedback from the live folder: ${liveFiles ? 'filed' : 'refused'}, ` +
        `from a dev worktree: ${devHome.filesHere ? 'filed' : `refused, pointing at :${devHome.livePort}`}`,
    );

    // The preview's copy, of a fake source whose lock holds a live pid, as the live server's does.
    const source = join(scratch, 'plcos-data', 'real');
    await mk(join(source, 'database'), { recursive: true });
    await wf(join(source, 'database', 'PG_VERSION'), '17\n');
    await wf(join(source, 'database.lock'), String(process.pid));
    await wf(join(source, 'init.jsonc'), '{}\n');
    const copied = join(dev.root, 'data', 'real');
    const empty = preview.previewRefusal(dev.root);
    const first = preview.takeCopy(source, dev.root);
    const own = preview.previewRefusal(dev.root);
    const lockCopied = existsSync(join(copied, 'database.lock'));
    const sourceLock = await rf(join(source, 'database.lock'), 'utf8');
    let failed = false;
    try { preview.takeCopy(join(scratch, 'nowhere'), dev.root); } catch { failed = true; }
    const kept = (await rf(join(copied, preview.MARKER), 'utf8')).trim() === first.takenAt && existsSync(join(copied, 'init.jsonc'));
    await rm(join(copied, preview.MARKER));
    const unmarked = preview.previewRefusal(dev.root);
    await rm(copied, { recursive: true });
    await symlink(source, copied);
    const linked = preview.previewRefusal(dev.root);
    await rm(scratch, { recursive: true, force: true });
    check(
      'A preview replaces only its own copy, never a link or an unmarked folder; the copy leaves the live server’s lock behind and the source untouched, and a failed copy leaves the last one',
      empty === null && own === null && !lockCopied && sourceLock === String(process.pid) && failed && kept && unmarked !== null && linked !== null,
      `nothing there: ${empty ?? 'copied'}; its own copy: ${own ?? 'replaced'}; lock carried into the copy: ${lockCopied}; source lock untouched: ${sourceLock === String(process.pid)}; ` +
        `failed copy kept the last: ${failed && kept}; unmarked folder: ${unmarked ? 'refused' : 'replaced'}; a link: ${linked ? 'refused' : 'replaced'}`,
    );
  }

  const prefixes = [['real', '3100'], ['real', '3290'], ['demo', '3291']].map(([profile, p]) => {
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '-e', `import('./config/deployment.ts').then(({ config: c }) => console.log(c.data.cookiePrefix))`], {
      env: { ...process.env, DATA_PROFILE: profile, PORT: p, PGLITE_DIR: '', DATABASE_URL: '' },
      encoding: 'utf8',
    });
    return r.stdout.trim().split('\n').pop() ?? '';
  });
  check(
    'Every server keeps its own cookies: the name carries the port, so two servers on one host never share who you are or which vehicle you had open',
    prefixes.join(' ') === 'capitalos_real_3100_ capitalos_real_3290_ capitalos_3291_',
    prefixes.join(' · '),
  );

  const keyless = inReal(
    `Promise.all([import('./lib/connectors/affinity/key.ts'), import('./config/deployment.ts')]).then(([k, d]) =>
       console.log(JSON.stringify([k.affinityKey(), d.config.data.copyTakenAt, 'AFFINITY_API_KEY' in k.withoutKey(process.env)])))`,
    { PREVIEW_COPY_AT: '2026-09-25T10:00:00.000Z', AFFINITY_API_KEY: 'not-a-key' },
  );
  check(
    'A preview never holds the Affinity key: the launcher starts it without one, and the connector will not read one it is given',
    keyless.out.trim().split('\n').pop() === '[null,"2026-09-25T10:00:00.000Z",false]',
    keyless.out.trim().split('\n').pop() ?? keyless.out.slice(0, 200),
  );
}
