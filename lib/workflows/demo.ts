import { createHash } from 'node:crypto';
import { encodeLine, type RunLine } from './ledger';

/**
 * Invented workflow runs for the demo profile (docs/20: "Demo uses invented fixtures"). Nothing here
 * describes a real run, person or batch; the shape is the ledger's, so the page is exercised by the
 * same fold and the same validation as the real file. Deterministic, so screenshots are stable.
 */

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const T0 = Date.parse('2026-09-18T02:00:00Z');
const H = 3600e3;

type Spec = {
  w: string | null; op: string; v: string | null; agent: string; source?: RunLine['source']; model?: string | null;
  at: number; mins: number; planned: number; written: number; failed?: number; outcome?: RunLine['outcome'];
  checks?: Array<[string, 'pass' | 'fail' | 'not-run']>; tokens?: [number, number] | null; measured?: boolean;
  parent?: number; reason?: string; folder?: string; open?: boolean;
};

const S: Spec[] = [
  { w: 'W0', op: 'freeze-research-set', v: 'docs/19', agent: 'Script', source: 'script', model: null, at: 0, mins: 2, planned: 60, written: 60, checks: [['schema', 'pass']], tokens: null },
  { w: 'W1', op: 'profile', v: '1.47', agent: 'Claude lp-researcher', at: 1, mins: 50, planned: 12, written: 12, checks: [['schema', 'pass'], ['sources cited', 'pass']], tokens: [420e3, 38e3] },
  { w: 'W1', op: 'profile', v: '1.47', agent: 'ChatGPT', source: 'chatgpt', at: 2.5, mins: 44, planned: 12, written: 11, failed: 1, outcome: 'partial', checks: [['schema', 'pass'], ['sources cited', 'fail']], tokens: [390e3, 31e3], reason: 'One profile cited a page that no longer loads.' },
  { w: 'W1c', op: 'fact-check', v: '1.2', agent: 'Claude fact-checker', at: 4, mins: 35, planned: 23, written: 23, checks: [['supported / readable', 'pass'], ['identity outcomes', 'pass']], tokens: [260e3, 22e3] },
  { w: 'W1', op: 'profile', v: '1.48', agent: 'Claude lp-researcher', at: 7, mins: 52, planned: 12, written: 12, checks: [['schema', 'pass'], ['sources cited', 'pass'], ['capacity labelled', 'pass']], tokens: [450e3, 41e3], measured: true },
  { w: 'W3', op: 'own-records-ties', v: 'connections-1.0', agent: 'Script', source: 'script', model: null, at: 9, mins: 6, planned: 60, written: 44, checks: [['no identity merges', 'pass']], tokens: null },
  { w: 'W5', op: 'strategy-batch-01', v: '1.8', agent: 'Claude strategy-writer', at: 11, mins: 70, planned: 10, written: 10, checks: [['schema', 'pass'], ['no invented capacity', 'pass'], ['route named', 'pass']], tokens: [610e3, 64e3] },
  { w: 'W5c', op: 'critic-batch-01', v: '1.8', agent: 'ChatGPT critic', source: 'chatgpt', at: 12.5, mins: 30, planned: 10, written: 10, parent: 7, checks: [['separate context', 'pass'], ['rubric scored', 'pass']], tokens: [240e3, 19e3] },
  { w: 'W5', op: 'strategy-batch-02', v: '1.9', agent: 'Claude strategy-writer', at: 26, mins: 64, planned: 10, written: 9, failed: 1, outcome: 'partial', checks: [['schema', 'pass'], ['no invented capacity', 'fail'], ['route named', 'pass']], tokens: [580e3, 60e3], reason: 'One strategy put a figure on a guess; held back for review.' },
  { w: 'W5c', op: 'critic-batch-02', v: '1.9', agent: 'ChatGPT critic', source: 'chatgpt', at: 27.5, mins: 28, planned: 10, written: 10, parent: 9, checks: [['separate context', 'pass'], ['rubric scored', 'pass']], tokens: [230e3, 18e3] },
  { w: 'W12', op: 'tag-batch-t01', v: '1.1', agent: 'Claude event-tagger', at: 29, mins: 40, planned: 200, written: 200, checks: [['every event tagged', 'pass']], tokens: [300e3, 27e3], measured: true },
  { w: 'W12', op: 'tag-batch-t02', v: '1.1', agent: 'Claude event-tagger', at: 30, mins: 38, planned: 200, written: 196, failed: 4, outcome: 'partial', checks: [['every event tagged', 'fail']], tokens: [290e3, 25e3], reason: 'Four events had no date; left untagged.' },
  { w: 'dakota', op: 'pull', v: 'v1', agent: 'Script', source: 'script', model: null, at: 31, mins: 12, planned: 2, written: 2, checks: [['counts match manifest', 'pass']], tokens: null },
  { w: null, op: 'implement issue-0042', v: null, agent: 'ChatGPT', source: 'chatgpt', at: 33, mins: 95, planned: 1, written: 1, checks: [['typecheck', 'pass'], ['boundaries', 'pass'], ['props', 'pass']], tokens: [1.2e6, 90e3] },
  { w: 'W1', op: 'profile', v: '1.49', agent: 'ChatGPT', source: 'chatgpt', at: 50, mins: 48, planned: 12, written: 12, checks: [['schema', 'pass'], ['sources cited', 'pass'], ['capacity labelled', 'pass']], tokens: [400e3, 36e3] },
  { w: 'W1c', op: 'fact-check', v: '1.3', agent: 'Claude fact-checker', at: 51.5, mins: 33, planned: 24, written: 24, checks: [['supported / readable', 'pass'], ['identity outcomes', 'pass']], tokens: [250e3, 21e3] },
  { w: 'W5', op: 'strategy-batch-03', v: '1.10', agent: 'Claude strategy-writer', at: 53, mins: 66, planned: 10, written: 10, checks: [['schema', 'pass'], ['no invented capacity', 'pass'], ['route named', 'pass']], tokens: [600e3, 62e3] },
  { w: 'W5c', op: 'critic-batch-03', v: '1.10', agent: 'ChatGPT critic', source: 'chatgpt', at: 54.5, mins: 29, planned: 10, written: 10, parent: 17, checks: [['separate context', 'pass'], ['rubric scored', 'pass']], tokens: [235e3, 18e3] },
  { w: 'W8', op: 'synthesis', v: null, agent: 'Script', source: 'script', model: null, at: 56, mins: 3, planned: 1, written: 1, checks: [['counts reconcile', 'pass']], tokens: null },
  { w: 'W3', op: 'warmth-refresh', v: 'connections-1.1', agent: 'ChatGPT', source: 'chatgpt', at: 57, mins: 20, planned: 60, written: 0, outcome: 'failed', checks: [['inputs unchanged', 'fail']], tokens: [80e3, 6e3], reason: 'An input changed during the run; stopped before writing.' },
  { w: 'W3', op: 'warmth-refresh', v: 'connections-1.1', agent: 'ChatGPT', source: 'chatgpt', at: 58, mins: 22, planned: 60, written: 47, checks: [['inputs unchanged', 'pass'], ['no identity merges', 'pass']], tokens: [150e3, 12e3] },
  { w: 'W7', op: 'materials-review', v: null, agent: 'ChatGPT', source: 'chatgpt', at: 59, mins: 18, planned: 5, written: 0, outcome: 'refused', checks: [], tokens: null, reason: 'The materials were not in scope for this envelope.' },
  { w: 'W1', op: 'profile', v: '1.49', agent: 'Claude lp-researcher', at: 61, mins: 0, planned: 12, written: 0, open: true, tokens: null },
];

export function demoLedger(): string {
  const lines: string[] = [];
  S.forEach((s, i) => {
    const started = new Date(T0 + s.at * H).toISOString();
    const base: Omit<RunLine, 'event' | 'endedAt' | 'counts' | 'checks' | 'usage' | 'outcome' | 'reason'> = {
      runId: id(i + 1), parentRunId: s.parent ? id(s.parent) : null, workflow: s.w, operation: s.op,
      protocol: { version: s.v, hash: hash(`demo-protocol:${s.w}:${s.v}`) }, source: s.source ?? 'claude-code',
      agent: s.agent, model: s.model === undefined ? (s.source === 'chatgpt' ? 'demo-model-b' : 'demo-model-a') : s.model,
      launchFolder: '/demo/checkout', workerFolder: `/demo/${s.folder ?? (s.source === 'chatgpt' ? 'codex-dev' : 'claude-live')}`,
      batch: { id: `demo-batch-${i + 1}`, manifest: `demo/manifests/${i + 1}.json`, hash: hash(`demo-batch:${i}`), planned: s.planned },
      startedAt: started,
    };
    lines.push(encodeLine({
      ...base, event: 'started', endedAt: null,
      counts: { selected: s.planned, written: null, valid: null, failed: null, skipped: null },
      checks: [], usage: null, outcome: 'unknown', reason: null,
    }));
    if (s.open) return;
    lines.push(encodeLine({
      ...base, event: 'finished', endedAt: new Date(T0 + s.at * H + s.mins * 60e3).toISOString(),
      counts: { selected: s.planned, written: s.written, valid: s.written, failed: s.failed ?? 0, skipped: s.planned - s.written - (s.failed ?? 0) },
      checks: (s.checks ?? []).map(([name, status]) => ({ name, status })),
      usage: s.tokens
        ? { input: s.tokens[0], output: s.tokens[1], cacheRead: Math.round(s.tokens[0] * 4), cacheWrite: 0, cost: null,
            source: s.measured ? 'measured' : 'estimated', method: s.measured ? 'demo: reported by the runner' : 'demo: session window estimate' }
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured', method: 'script: no model tokens' },
      outcome: s.outcome ?? 'succeeded', reason: s.reason ?? null,
    }));
  });
  return lines.join('');
}
