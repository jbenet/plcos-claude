import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateUsage, usageFields, type Window } from '../lib/workflows/usage';

/** Invented session files only; never inspect the developer's session history. */
export async function workflowUsageProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const temp = await mkdtemp(join(tmpdir(), 'workflow-usage-props-'));
  const roots = { codex: join(temp, 'codex'), claude: join(temp, 'claude') };
  const stamp = (n: number) => new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString();
  const at = (n: number) => Date.parse(stamp(n));
  const window = (runId: string, start: number, end: number, source = 'chatgpt', folder = temp): Window =>
    ({ runId, start: at(start), end: at(end), source, folders: [folder] });
  const event = (n: number, input: number) => ({ timestamp: stamp(n), type: 'event_msg', payload: {
    type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: input / 2,
      output_tokens: input / 5, reasoning_output_tokens: input / 10 } } } });
  const meta = { type: 'session_meta', timestamp: stamp(0), payload: { id: 'invented-session', cwd: temp, timestamp: stamp(0) } };
  const write = (file: string, rows: unknown[]) => writeFile(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  try {
    await mkdir(roots.codex); await mkdir(roots.claude);
    const file = join(roots.codex, 'invented.jsonl');
    await write(file, [meta, event(10, 100), event(12, 100), event(20, 200)]);
    let estimates = await estimateUsage([window('a', 0, 20), window('b', 10, 20), window('outside', 20, 30),
      window('wrong-folder', 0, 20, 'chatgpt', '/invented/other'), window('wrong-provider', 0, 20, 'claude-code')], roots);
    const a = estimates[0], b = estimates[1];
    assert.equal(a.input, 150); assert.equal(b.input, 50);
    assert.equal(a.cachedInput, 75); assert.equal(a.output, 30); assert.equal(a.reasoning, 15);
    assert.ok(estimates.slice(2).every(e => e.input === null && e.sessions.length === 0));
    assert.equal(a.sessions.length, 1);
    check('Usage deltas follow windows and split only concurrent session time', true, '150/50 split conserves 200 input tokens; repeated cumulative reports ignored');

    estimates = await estimateUsage([window('partial', 5, 15)], roots);
    assert.equal(estimates[0].input, 87.5); // 50 before t=10, then 3/8 of the next delta
    // Many different overlaps conserve all usage when a covering run is present.
    for (let n = 1; n <= 10; n++) {
      const windows = [window('cover', 0, 20), ...Array.from({ length: n }, (_, i) => window(`overlap-${i}`, i, 20 - i))];
      const shares = await estimateUsage(windows, roots);
      assert.ok(Math.abs(shares.reduce((sum, e) => sum + e.input!, 0) - 200) < 1e-9);
    }
    check('Partial intervals and arbitrary concurrency conserve usage without rounding drift', true, 'time proration; fractional tokens retained in sidecar');

    await write(file, [meta, event(10, 100), event(20, 40)]);
    estimates = await estimateUsage([window('reset', 0, 20)], roots);
    assert.equal(estimates[0].input, 140);
    const assistant = (n: number, output: number) => ({ type: 'assistant', timestamp: stamp(n), cwd: temp,
      sessionId: 'invented-claude', message: { id: 'invented-message', content: [{ text: 'DO NOT EXTRACT THIS BODY' }],
        usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: output } } });
    await write(join(roots.claude, 'invented.jsonl'), [assistant(4, 1), assistant(5, 4), assistant(5, 4)]);
    estimates = await estimateUsage([window('c', 0, 10, 'claude-code'), window('d', 0, 10, 'claude-code')], roots);
    assert.equal(estimates[0].input, 17.5); assert.equal(estimates[0].cachedInput, 10);
    assert.equal(estimates[0].output, 2); assert.equal(estimates[0].cacheWrite, 2.5);
    assert.equal(estimates[1].input, 17.5);
    const projected = usageFields(JSON.stringify(assistant(4, 1)));
    assert.ok(!JSON.stringify(projected).includes('DO NOT EXTRACT'));
    assert.equal(projected['message.usage.output_tokens'], 1);
    assert.throws(() => usageFields('{"message":'));
    check('Counter resets and repeated Claude messages do not inflate usage', true, 'cache semantics normalized; message bodies absent from allowlisted projection');

    // An exec child may inherit the parent's payload.id/session_id and timestamp.
    // Its filename and outer metadata timestamp identify its own counter stream.
    await rm(roots.codex, { recursive: true }); await mkdir(roots.codex);
    await rm(roots.claude, { recursive: true }); await mkdir(roots.claude);
    const parent = { ...meta, payload: { ...meta.payload, session_id: 'invented-session',
      originator: 'codex_exec', source: 'exec' } };
    const childId = '00000000-0000-4000-8000-000000000001';
    const childFile = join(roots.codex, `rollout-2020-01-01T00-00-10-${childId}.jsonl`);
    const child = { ...parent, timestamp: stamp(10), payload: { ...parent.payload,
      source: { subagent: { thread_spawn: { parent_thread_id: 'invented-session' } } } } };
    await write(file, [parent, event(10, 100), event(20, 200)]);
    await write(childFile, [child, { ...parent, timestamp: stamp(10) }, event(20, 100)]);
    estimates = await estimateUsage([window('headless', 0, 20)], roots);
    assert.equal(estimates[0].input, 300);
    assert.equal(estimates[0].sessions.length, 2);
    assert.ok(estimates[0].sessions.includes(`chatgpt:${childId}`));
    estimates = await estimateUsage([window('before-child', 0, 10)], roots);
    assert.equal(estimates[0].input, 100); // child creation is t=10, not inherited t=0
    check('Headless child counters use rollout identity and their own creation time', true,
      'inherited parent IDs do not merge independent child streams');

    await rm(childFile);
    // A resumed partial copy must merge observations before computing deltas.
    const copy = join(roots.codex, 'resumed.jsonl');
    await write(copy, [parent, event(20, 200)]);
    estimates = await estimateUsage([window('resumed', 0, 20)], roots);
    assert.equal(estimates[0].input, 200);
    assert.equal(estimates[0].source, 'measured');
    await rm(copy);
    const unrelated = join(roots.codex, 'unrelated.jsonl');
    await writeFile(unrelated, '{broken record\n');
    estimates = await estimateUsage([window('healthy', 0, 20)], roots);
    assert.equal(estimates[0].input, 200);
    assert.equal(estimates[0].source, 'measured');
    check('Resumed copies and unrelated malformed logs neither inflate nor erase usage', true,
      '200 measured tokens survive a partial copy and a corrupt unrelated file');

    await appendFile(file, '{"timestamp":"2020-01-01T00:00:21Z","payload":');
    estimates = await estimateUsage([window('open', 0, 25)], roots);
    assert.equal(estimates[0].input, 200);
    assert.equal(estimates[0].source, 'estimated');
    assert.ok(estimates[0].diagnostics.includes('incomplete final record ignored'));
    assert.ok(estimates[0].diagnostics.some(d => d.includes('in-flight')));
    // Once the write completes, the same file can supply the next cumulative report.
    await write(file, [parent, event(10, 100), event(20, 200), event(25, 300)]);
    estimates = await estimateUsage([window('closed', 0, 25)], roots);
    assert.equal(estimates[0].input, 300);
    assert.equal(estimates[0].source, 'measured');
    await writeFile(file, [JSON.stringify(parent), JSON.stringify(event(10, 100)), '{broken',
      JSON.stringify(event(20, 200))].join('\n') + '\n');
    estimates = await estimateUsage([window('damaged', 0, 20)], roots);
    assert.equal(estimates[0].input, 200);
    assert.equal(estimates[0].source, 'estimated');
    assert.ok(estimates[0].diagnostics.includes('malformed records skipped'));
    check('Still-open and internally damaged logs preserve observed counters with explicit uncertainty', true,
      'partial tail is distinguished from internal damage; a completed next report restores full coverage');

    await write(file, [parent, event(20, 0)]);
    estimates = await estimateUsage([window('zero', 0, 20)], roots);
    assert.equal(estimates[0].input, 0);
    assert.equal(estimates[0].source, 'measured');
    await write(file, [parent]);
    estimates = await estimateUsage([window('missing', 0, 20)], roots);
    assert.equal(estimates[0].input, null);
    assert.equal(estimates[0].source, 'estimated');
    assert.match(estimates[0].method, /^unavailable:/);
    check('Observed zero usage is distinct from a session with no usage reports', true,
      'missing metadata never manufactures zero tokens');
  } finally { await rm(temp, { recursive: true, force: true }); }
}
