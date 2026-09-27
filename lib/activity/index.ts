import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityData } from './types';

/**
 * Demo only (issue 0103): invented activity from fixtures/activity.json, so Developer → Connectors
 * can be built against the contract. The real implementation replaces this file at merge.
 */
export async function getActivity(): Promise<ActivityData> {
  const raw = JSON.parse(await readFile(join(process.cwd(), 'fixtures/activity.json'), 'utf8')) as ActivityData;
  return { points: raw.points, origins: raw.origins, sources: raw.sources, asOf: raw.asOf };
}
