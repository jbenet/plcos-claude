import { notifyActivityChange } from './notifications';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../../config/deployment';
import type { ActivitySource } from './types';
import { host, quantity, segment, sources, utcDay } from './model';
export interface ActivityEvent {
  source: ActivitySource; at?: string; segment?: string | null; runId?: string;
  requests: number | null; bytesIn: number | null; bytesOut: number | null; records: number | null;
  origin?: string; estimated?: boolean; basis?: string;
}
export const runKey = (id: string): string => createHash('sha256').update(id).digest('hex');
/** Invalidation marker for external file writers. No directory walk on warm requests. */
export async function touchActivity(root: string = config.data.root): Promise<void> {
  await mkdir(join(root, 'activity'), { recursive: true });
  await writeFile(join(root, 'activity', 'generation'), randomUUID(), { mode: 0o600 });
  notifyActivityChange(root);
}
/** Best effort telemetry: never make a successful source read fail. No arbitrary text survives. */
export async function recordActivity(event: ActivityEvent, root?: string): Promise<void> {
  if (!root && (config.data.profile !== 'real' || config.data.copyTakenAt)) return;
  try {
    if (!sources.includes(event.source)) return;
    const at = event.at ?? new Date().toISOString(), day = utcDay(at);
    if (!day) return;
    const origin = host(event.origin);
    const source = origin && (origin === 'sec.gov' || origin.endsWith('.sec.gov')) && ['search','fetch','sec'].includes(event.source) ? 'sec' : event.source;
    const row = { id: randomUUID(), at: new Date(at).toISOString(), source, segment: segment(source, event.segment),
      ...(event.runId ? { run: runKey(event.runId) } : {}), requests: quantity(event.requests), bytesIn: quantity(event.bytesIn), bytesOut: quantity(event.bytesOut), records: quantity(event.records),
      ...(origin && ['search','fetch','sec'].includes(source) ? { origin } : {}), estimated: event.estimated === true,
      ...(event.estimated ? { basis: source === 'agents' ? `GUESS: UTF-8 bytes = tokens × ${config.activity.bytesPerToken}; input includes cache and output includes reasoning.` : source === 'warehouse' ? 'CLI attempts and JSON/SQL UTF-8 payload bytes; not measured network traffic.' : 'Estimated from recorded counts or payload sizes; not measured network traffic.' } : {}) };
    const target = root ?? config.data.root;
    await mkdir(join(target, 'activity'), { recursive: true });
    // A leading newline isolates a torn prior append without rewriting history.
    await appendFile(join(target, 'activity', `${day}.jsonl`), '\n' + JSON.stringify(row) + '\n', { mode: 0o600 });
    await touchActivity(target);
  } catch { console.warn('[activity] Could not record counts; activity history may be incomplete.'); }
}
