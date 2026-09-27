import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Check } from './harness';
import { recordResponsiveness, responsivenessSnapshot, startResponsivenessMonitor } from '../../lib/responsiveness';

export async function responsivenessProperties(check: Check) {
  const root = await mkdtemp(join(tmpdir(), 'plcos-responsiveness-invented-'));
  try {
    const sample = { at: '2026-09-27T12:00:00Z', since: '2026-09-27T11:59:00Z',
      windowMs: 60000, samples: 5980, p99Ms: 10.2, maxMs: 27.1, note: 'INVENTED_PRIVATE_TEXT' };
    await recordResponsiveness(sample, root);
    await recordResponsiveness({ ...sample, p99Ms: 11.5 }, root);
    const path = join(root, 'activity/server-2026-09-27.jsonl');
    const raw = await readFile(path, 'utf8'), rows = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    check('Responsiveness journal keeps numeric windows without opening a database',
      rows.length === 2 && rows[0].p99Ms === 10.2 && rows[1].p99Ms === 11.5
        && rows.every(row => row.source === 'server' && row.metric === 'event-loop-delay'
          && Object.keys(row).length === 8 && ['windowMs', 'samples', 'p99Ms', 'maxMs'].every(key => Number.isFinite(row[key])))
        && !raw.includes('INVENTED_PRIVATE_TEXT'),
      'Two complete append-only windows retain measured values and omit arbitrary text; only temporary invented files are used.');
    let refused = 0;
    for (const bad of [{ ...sample, p99Ms: NaN }, { ...sample, samples: 0 }, { ...sample, at: 'not a date' }]) {
      try { await recordResponsiveness(bad, root); } catch { refused++; }
    }
    check('Responsiveness journal refuses invalid and incomplete windows before writing',
      refused === 3 && await readFile(path, 'utf8') === raw,
      'Non-finite lag, zero samples and an invalid timestamp append nothing.');
  } finally { await rm(root, { recursive: true, force: true }); }

  const shared = globalThis as typeof globalThis & { __plcosResponsiveness?: {
    histogram: ReturnType<typeof monitorEventLoopDelay>; timer: ReturnType<typeof setInterval>; latest: unknown;
  } };
  const existing = shared.__plcosResponsiveness;
  try {
    startResponsivenessMonitor();
    const first = shared.__plcosResponsiveness;
    startResponsivenessMonitor();
    const snapshot = responsivenessSnapshot();
    check('Responsiveness monitor is one unrefed main-thread timer and never invents a warmup sample',
      Boolean(first) && first === shared.__plcosResponsiveness && !first!.timer.hasRef()
        && (existing ? snapshot === existing.latest : snapshot === null),
      'Repeated startup reuses one histogram/timer; before a complete window, Status receives null and displays Collecting.');
  } finally {
    if (!existing && shared.__plcosResponsiveness) {
      clearInterval(shared.__plcosResponsiveness.timer);
      shared.__plcosResponsiveness.histogram.disable();
      delete shared.__plcosResponsiveness;
    }
  }
}
