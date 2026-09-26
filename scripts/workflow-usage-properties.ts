import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  } finally { await rm(temp, { recursive: true, force: true }); }
}
