import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beginRun, encodeLine, finishRun, foldRuns, readRuns, realRoot, type Begin, type Finish } from '../lib/workflows/ledger';

/** Fictional layout only: no operation below resolves this checkout's real ledger. */
export async function workflowProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'plcos-workflow-props-')));
  const live = join(temp, 'plcos-claude-live'), dev = join(temp, 'plcos-codex-dev'), claude = join(temp, 'plcos-claude-dev');
  const root = join(temp, 'plcos-data/real'), file = join(root, 'workflows/runs.jsonl');
  const context = { cwd: dev, profile: 'real' };
  const metadata: Begin = {
    parentRunId: null, workflow: 'W1c', operation: 'review', protocol: { version: null, hash: 'a'.repeat(64) },
    source: 'chatgpt', agent: 'fixture', model: null, launchFolder: dev, workerFolder: dev,
    batch: { id: 'fictional', manifest: 'enrich/batches/fictional.txt', hash: 'b'.repeat(64), planned: 2 },
  };
  const result: Finish = { counts: { selected: 2, written: 2, valid: 2, failed: 0, skipped: 0 },
    checks: [{ name: 'fixture-check', status: 'pass' }],
    usage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 1, cost: null, source: 'measured' }, outcome: 'succeeded', reason: null };
  try {
    await mkdir(join(live, '.git'), { recursive: true });
    await mkdir(join(live, 'data'));
    await mkdir(root, { recursive: true });
    await symlink(root, join(live, 'data/real'));
    const ports = JSON.stringify({
      'plcos-claude-live': { role: 'live', real: 3000, demo: 3001 },
      'plcos-codex-dev': { role: 'dev', preview: 3200, demo: 3201, previewSource: '../plcos-data/real' },
      'plcos-claude-dev': { role: 'dev', preview: 3100, demo: 3101, previewSource: '../plcos-data/real' },
    });
    for (const folder of [live, dev, claude]) {
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, '.ports.json'), ports);
      if (folder !== live) await writeFile(join(folder, '.git'), `gitdir: ${live}/.git/worktrees/${folder.split('/').pop()}\n`);
    }
    // A dev checkout has a preview, but the recorder must select the sibling real root.
    await mkdir(join(dev, 'data/real'), { recursive: true });
    await writeFile(join(dev, 'data/real/.preview-copy'), 'fictional');
    assert.equal(await realRoot(context), root);
    const id = await beginRun(metadata, context);
    assert.equal((await readRuns(context)).runs[0]?.outcome, 'unknown');
    check('A workflow start without a finish is unknown', true, 'temporary layout only; no success inferred');
    const beforeFinish = await readFile(file, 'utf8');
    for (const usage of [null, undefined, {}, { ...result.usage, source: undefined }]) {
      await assert.rejects(finishRun(id, { ...result, usage } as Finish, context));
      assert.equal(await readFile(file, 'utf8'), beforeFinish);
    }
    check('Workflow finish refuses missing usage or provenance before writing', true, 'null, omitted, empty and unsourced usage refused');
    await finishRun(id, result, { cwd: live, profile: 'real' });
    await finishRun(id, result, context); // retry does not append another finish
    const text = await readFile(file, 'utf8'), folded = await readRuns({ cwd: claude, profile: 'real' });
    assert.equal(text.trim().split('\n').length, 2);
    assert.equal(folded.runs.length, 1);
    assert.equal(folded.runs[0]?.outcome, 'succeeded');
    assert.deepEqual(folded.issues, []);
    assert.equal(foldRuns(text + text).runs.length, 1);
    check('Workflow append/fold shares one run across live and both dev folders', true, 'begin + finish = one run; duplicate finish is harmless');

    await assert.rejects(realRoot({ ...context, profile: 'demo' }));
    await assert.rejects(realRoot({ ...context, profile: 'preview' }));
    await writeFile(join(root, '.preview-copy'), 'fictional snapshot');
    await assert.rejects(realRoot(context));
    await rm(join(root, '.preview-copy'));
    await rm(join(live, 'data/real'));
    await symlink(join(dev, 'data/real'), join(live, 'data/real'));
    await assert.rejects(realRoot(context));
    await rm(join(live, 'data/real'));
    await symlink(root, join(live, 'data/real'));
    check('Workflow recording refuses demo, preview and redirected real roots', true, 'no fallback to the dev copy');

    const line = folded.runs[0]!.start!;
    const overhead = Buffer.byteLength(encodeLine(line));
    assert.throws(() => encodeLine({ ...line, operation: line.operation + 'x'.repeat(4096 - overhead) }));
    await assert.rejects(beginRun({ ...metadata, operation: '界'.repeat(1600) }, context));
    assert.equal(await readFile(file, 'utf8'), text);
    assert.throws(() => encodeLine({ ...line, protocol: { ...line.protocol, version: 1.10 as unknown as string } }));
    assert.throws(() => encodeLine({ ...line, source: ['chatgpt'] as unknown as typeof line.source }));
    check('Workflow lines under 4 KB are enforced in UTF-8 bytes before append', true, 'exact limit and oversized multibyte text rejected; versions stay strings');

    const conflicting = { ...folded.runs[0]!.finish!, outcome: 'failed' as const };
    assert.equal(foldRuns(text + encodeLine(conflicting)).runs[0]?.outcome, 'unknown');
    assert.ok(foldRuns(text + '{"incomplete":').issues.length);
    assert.ok(foldRuns(text + 'not-json\n').issues.length);
    await assert.rejects(finishRun(id, { ...result, outcome: 'failed' }, context));
    assert.equal(await readFile(file, 'utf8'), text);
    await rm(file);
    await writeFile(join(temp, 'sentinel'), 'unchanged');
    await symlink(join(temp, 'sentinel'), file);
    await assert.rejects(beginRun(metadata, context));
    assert.equal(await readFile(join(temp, 'sentinel'), 'utf8'), 'unchanged');
    await rm(file);
    await writeFile(file, text);
    check('Workflow conflicts, malformed tails and symlinked ledgers cannot silently pass', true, 'history flagged; conflicting finish and escaping write refused');

    // Exercise the actual entry points with fictional scripts, still entirely in temp.
    await mkdir(join(live, 'scripts'));
    await symlink(resolve('node_modules'), join(live, 'node_modules'));
    await writeFile(join(live, 'scripts/fixture.ts'), 'process.exitCode = Number(process.argv[2] ?? 0);\n');
    await writeFile(join(temp, 'metadata.json'), JSON.stringify(metadata));
    await writeFile(join(temp, 'result.json'), JSON.stringify(result));
    const cli = (script: string, args: string[], cwd = live) => spawnSync(process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts', script), ...args],
      { cwd, env: { ...process.env, HOME: temp, DATA_PROFILE: 'real' }, encoding: 'utf8' });
    const started = cli('workflow-run.ts', ['begin', join(temp, 'metadata.json')], dev);
    assert.equal(started.status, 0, started.stderr);
    const finished = cli('workflow-run.ts', ['finish', started.stdout.trim(), join(temp, 'result.json')], claude);
    assert.equal(finished.status, 0, finished.stderr);
    for (const exit of [0, 7]) {
      const run = cli('workflow-script.ts', [join(temp, 'metadata.json'), '--', 'scripts/fixture.ts', String(exit)]);
      assert.equal(run.status, exit === 0 ? 0 : 1, run.stderr);
    }
    const refused = cli('workflow-script.ts', [join(temp, 'metadata.json'), '--', join(live, 'scripts/fixture.ts')], dev);
    assert.equal(refused.status, 1);
    const { finishWithUsage } = await import('../lib/workflows/usage');
    const automatic = await beginRun(metadata, context);
    const noSessions = { codex: join(temp, 'no-codex'), claude: join(temp, 'no-claude') };
    await finishWithUsage(automatic, { ...result, usage: null }, context, noSessions);
    const afterEstimate = await readFile(file, 'utf8');
    await finishWithUsage(automatic, { ...result, usage: null }, context, noSessions);
    assert.equal(await readFile(file, 'utf8'), afterEstimate);
    const estimated = (await readRuns(context)).runs.find(r => r.runId === automatic)!.finish!.usage!;
    assert.equal(estimated.source, 'estimated');
    assert.equal(estimated.input, null);
    check('Automatic finish records unavailable estimates honestly and retries unchanged', true, 'usage object required even when counts cannot be recovered');
    const all = await readRuns(context);
    assert.equal(all.runs.length, 5);
    assert.equal(all.runs.filter((r) => r.outcome === 'failed').length, 1);
    assert.ok(all.runs.every((r) => r.finish));
    assert.deepEqual(all.issues, []);
    check('Workflow CLI and live-script wrapper record success/failure in a temporary layout', true, 'dev wrapper refused; process exit is not an item-validation claim');
    const observed = await beginRun({ ...metadata, workerFolder: join(dev, 'worker') }, context);
    const observedStart = (await readRuns(context)).runs.find(r => r.runId === observed)!.start!.startedAt!;
    const sessions = { codex: join(temp, 'sessions'), claude: join(temp, 'no-claude') };
    await mkdir(sessions.codex);
    const session = (id: string, cwd: string, input: number) => [
      { timestamp: observedStart, type: 'session_meta', payload: { id, cwd, source: 'exec', originator: 'codex_exec' } },
      { timestamp: observedStart, type: 'event_msg', payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: input, output_tokens: 2, cached_input_tokens: 3 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n';
    await writeFile(join(sessions.codex, 'worker.jsonl'), session('worker-session', join(dev, 'worker'), 10) + '{"partial":');
    await writeFile(join(sessions.codex, 'launcher.jsonl'), session('launcher-session', dev, 9999));
    await finishWithUsage(observed, { ...result, usage: null }, context, sessions);
    const recorded = (await readRuns(context)).runs.find(r => r.runId === observed)!.finish!.usage!;
    assert.equal(recorded.input, 10);
    assert.equal(recorded.source, 'estimated');
    assert.deepEqual(recorded.sessions, ['chatgpt:worker-session']);
    assert.match(recorded.method!, /incomplete final record/);
    const frozen = await readFile(file, 'utf8');
    await writeFile(join(sessions.codex, 'worker.jsonl'), session('worker-session', join(dev, 'worker'), 20));
    await finishWithUsage(observed, { ...result, usage: null }, context, sessions);
    assert.equal(await readFile(file, 'utf8'), frozen);
    check('Finish persists usable headless counters, match provenance and stable retries', true,
      'open worker log is read; unrelated launcher tokens excluded; later reports cannot alter a retry');

  } finally { await rm(temp, { recursive: true, force: true }); }
}
