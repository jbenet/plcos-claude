import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { proxy } from '../../proxy';
import { healthRoute } from '../../lib/authz/route';
import { initializeRoutingSecret } from '../../lib/internal-routing';
import { runWorkflow } from '../../lib/workflows/api';
import { readRuns } from '../../lib/workflows/ledger';
import type { Check } from './harness';

export async function workflowApiProperties(check: Check) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-api-')), dir = join(root, 'enrich');
  const originalFetch = globalThis.fetch, originalKey = process.env.ANTHROPIC_API_KEY, originalModel = process.env.ANTHROPIC_MODEL;
  const finding = { key: 'invented', name: 'Invented Person', researched: { at: '2026-09-28', by: 'fixture', workflow: 'W1', version: '1.50' }, identity: { match: 'not_found', basis: 'Invented test' }, facts: [] };
  const reply = (stop_reason: string, content: unknown[]) => Response.json({ stop_reason, content, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } });
  const output = (files: unknown[]) => [{ type: 'text', text: JSON.stringify({ files }) }];
  const batch = join(dir, 'batches', 'fixture.jsonl');
  let calls: Array<Record<string, any>> = [];
  try {
    await mkdir(join(dir, 'batches'), { recursive: true });
    await writeFile(batch, JSON.stringify({ key: 'invented', name: 'Invented Person' }));
    process.env.ANTHROPIC_API_KEY = 'invented-stub-only'; delete process.env.ANTHROPIC_MODEL;
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return calls.length === 1 ? reply('pause_turn', [{ type: 'server_tool_use', id: 'invented-tool', name: 'web_search', input: { query: 'invented' } }])
        : reply('end_turn', output([{ path: 'raw/invented.json', content: finding }]));
    };
    await runWorkflow({ protocol: 'w1', batch }, root);
    const first = (await readRuns({ root })).runs[0]!;
    initializeRoutingSecret();
    const rewritten = proxy(new NextRequest('http://localhost/health'));
    check('Workflow API resumes server tools, validates files, measures usage and serves root health',
      calls.length === 2 && calls[0]!.model === 'claude-sonnet-5' && calls[1]!.messages[1].content[0].type === 'server_tool_use'
      && calls[0]!.tools.every((t: any) => t.blocked_domains.includes('linkedin.com'))
      && calls[1]!.max_tokens === calls[0]!.max_tokens - 5 && first.finish?.usage?.input === 30 && first.finish.usage.output === 10
      && first.outcome === 'succeeded' && JSON.parse(await readFile(join(dir, 'raw/invented.json'), 'utf8')).key === 'invented'
      && rewritten.headers.get('x-middleware-rewrite') === 'http://localhost/api/health' && healthRoute().status === 200,
      'Invented fixture, two stubbed HTTP responses, real validators and JSONL ledger.');

    let refused = 0;
    const fails = async (input: Record<string, unknown>) => { try { await runWorkflow(input, root); } catch { refused++; } };
    delete process.env.ANTHROPIC_API_KEY;
    await fails({ protocol: 'w1', batch });
    process.env.ANTHROPIC_API_KEY = 'invented-stub-only'; process.env.ANTHROPIC_MODEL = 'invented-model';
    await writeFile(join(root, 'outside.jsonl'), '{"key":"invented"}');
    await symlink(join(root, 'outside.jsonl'), join(dir, 'batches', 'escape.jsonl'));
    await fails({ protocol: 'w1', batch: join(root, 'outside.jsonl') });
    await fails({ protocol: 'w1', batch: join(dir, 'batches', 'escape.jsonl') });
    calls = [];
    globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return reply('end_turn', output([{ path: 'strategy/invented.json', content: {} }])); };
    await fails({ protocol: 'w5', batch });
    const w5NoTools = !calls[0]!.tools && calls[0]!.model === 'invented-model';
    globalThis.fetch = async () => reply('end_turn', output([{ path: 'raw/invented.json', content: finding }, { path: '../outside.json', content: finding }]));
    await fails({ protocol: 'w1c', batch });
    let turns = 0;
    globalThis.fetch = async () => { turns++; return reply('pause_turn', []); };
    await fails({ protocol: 'w1', batch });
    const runs = (await readRuns({ root })).runs;
    check('Workflow API refuses missing keys, escaped paths, invalid output and exhausted turns',
      refused === 6 && w5NoTools && turns === 8 && runs.slice(1).every(r => r.outcome === 'failed')
      && (await readdir(join(dir, 'rejects'))).length === 3 && JSON.parse(await readFile(join(dir, 'raw/invented.json'), 'utf8')).name === 'Invented Person',
      'No network or real key; W5 has no web tools; whole-output validation preserves previous findings.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = originalModel;
    await rm(root, { recursive: true, force: true });
  }
}
