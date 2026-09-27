import { monitorEventLoopDelay } from 'node:perf_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { config } from '../config/deployment';

export interface ResponsivenessSample {
  at: string;
  since: string;
  windowMs: number;
  samples: number;
  p99Ms: number;
  maxMs: number;
}
interface Monitor {
  histogram: ReturnType<typeof monitorEventLoopDelay>;
  timer: ReturnType<typeof setInterval>;
  since: number;
  latest: ResponsivenessSample | null;
  writing: boolean;
}
// Next's instrumentation and page bundles must share one histogram, including during HMR.
const shared = globalThis as typeof globalThis & { __plcosResponsiveness?: Monitor };

/** Numeric telemetry only; independent of DB locks and connector activity totals. */
export async function recordResponsiveness(sample: ResponsivenessSample, root: string = config.data.root): Promise<void> {
  const numbers = [sample.windowMs, sample.samples, sample.p99Ms, sample.maxMs];
  if (numbers.some(value => !Number.isFinite(value) || value < 0)
    || !Number.isInteger(sample.samples) || sample.samples < 1
    || !Number.isFinite(Date.parse(sample.at)) || !Number.isFinite(Date.parse(sample.since))) {
    throw new Error('Invalid responsiveness sample.');
  }
  // Whitelist fields even if a caller passes a wider object. No arbitrary text is logged.
  const row = { source: 'server', metric: 'event-loop-delay',
    at: new Date(sample.at).toISOString(), since: new Date(sample.since).toISOString(),
    windowMs: sample.windowMs, samples: sample.samples, p99Ms: sample.p99Ms, maxMs: sample.maxMs };
  const directory = join(root, 'activity');
  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, `server-${row.at.slice(0, 10)}.jsonl`),
    '\n' + JSON.stringify(row) + '\n', { mode: 0o600 });
}

/** Runs only in the request-serving main thread; it never opens a database. */
export function startResponsivenessMonitor(): void {
  if (!isMainThread || shared.__plcosResponsiveness) return;
  const histogram = monitorEventLoopDelay({ resolution: config.responsiveness.resolutionMs });
  histogram.enable();
  const state = { histogram, since: Date.now(), latest: null, writing: false } as Monitor;
  state.timer = setInterval(() => {
    const now = Date.now();
    if (!histogram.count) return;
    const sample: ResponsivenessSample = {
      at: new Date(now).toISOString(), since: new Date(state.since).toISOString(),
      windowMs: now - state.since, samples: histogram.count,
      p99Ms: histogram.percentile(99) / 1e6, maxMs: histogram.max / 1e6,
    };
    state.latest = sample;
    state.since = now;
    histogram.reset();
    // A slow filesystem must not create an unbounded queue of telemetry writes.
    if (state.writing) return;
    state.writing = true;
    void recordResponsiveness(sample).catch(() => {
      console.warn('[responsiveness] Could not record event-loop delay.');
    }).finally(() => { state.writing = false; });
  }, config.responsiveness.reportIntervalMs);
  state.timer.unref();
  shared.__plcosResponsiveness = state;
}

/** Latest completed window; null during the first reporting interval. */
export function responsivenessSnapshot(): ResponsivenessSample | null {
  startResponsivenessMonitor();
  return shared.__plcosResponsiveness?.latest ?? null;
}
