import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LinearClient } from './client';
import { ENTITIES, opName, type Entity } from './queries';
import { lastCompletePull, type Manifest } from './replica';

/**
 * Pull the workspace into the raw replica (docs/24-linear.md): every entity, page by page, into
 * <rawDir>/<entity>/<stamp>.jsonl, then a manifest saying what finished. After the first complete
 * pull, only what changed since it started (less an overlap) is asked for. The first error stops the
 * pull; what finished before it stays usable, and the next pull asks again from the last complete one.
 */
export interface PullOptions {
  full?: boolean;
  pageSize: number;
  overlapMs: number;
  now?: () => Date;
  onEntity?: (entity: Entity, index: number) => Promise<void>;
}

export async function pullLinear(client: LinearClient, rawDir: string, opts: PullOptions): Promise<Manifest & { name: string }> {
  const now = opts.now ?? (() => new Date());
  const started = now();
  const stamp = started.toISOString().replace(/[:.]/g, '-');
  const last = opts.full ? null : await lastCompletePull(rawDir);
  const since = last ? new Date(Date.parse(last) - opts.overlapMs).toISOString() : null;
  const filter = since ? { updatedAt: { gt: since } } : null;
  const entities: Manifest['entities'] = {};
  await mkdir(rawDir, { recursive: true });
  let failed = false;
  for (const [i, entity] of ENTITIES.entries()) {
    await opts.onEntity?.(entity, i);
    const dir = join(rawDir, entity);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${stamp}.jsonl`);
    await writeFile(file, '', { mode: 0o600 });
    let written = 0;
    try {
      for await (const nodes of client.pages<unknown>(opName(entity), filter, opts.pageSize)) {
        if (nodes.length) await appendFile(file, nodes.map((n) => JSON.stringify(n)).join('\n') + '\n', { mode: 0o600 });
        written += nodes.length;
      }
      entities[entity] = { written };
    } catch (err) {
      // Fixed words only: a message from below could carry a record.
      const status = (err as { status?: number }).status;
      entities[entity] = { written, error: status === 429 ? 'rate-limited: stopped' : err instanceof Error && err.name === 'LinearRefused' ? 'refused by the read-only guard' : 'read failed' };
      failed = true;
      break;
    }
  }
  const s = client.stats(), b = client.budget();
  const manifest: Manifest = {
    at: started.toISOString(), finishedAt: now().toISOString(), since, full: !since,
    requests: s.requests, bytesIn: s.bytesIn, bytesOut: s.bytesOut, records: s.records,
    budget: { requestsLeft: b.requestsLeft, requestsLimit: b.requestsLimit, complexityLeft: b.complexityLeft, complexityLimit: b.complexityLimit },
    entities, complete: !failed && ENTITIES.every((e) => entities[e] && !entities[e]!.error),
  };
  const name = `${stamp}.manifest.json`;
  await writeFile(join(rawDir, name), JSON.stringify(manifest, null, 1) + '\n', { mode: 0o600 });
  return { ...manifest, name };
}
