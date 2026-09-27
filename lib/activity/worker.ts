import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { Evidence, Logged } from './backfill';
import type { ActivityData } from './types';

/** Parse private source files and aggregate their counts away from the request event loop. */
export async function readActivityInWorker(root: string, database?: (log: Logged) => Promise<Evidence>): Promise<ActivityData> {
  const worker = new Worker(join(process.cwd(), 'scripts/activity-worker.mjs'), {
    workerData: { root }, execArgv: [],
  });
  try {
    return await new Promise<ActivityData>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('exit', () => reject(new Error('Activity worker exited before completing the snapshot.')));
      worker.on('message', (message: { type: string; log?: Logged; data?: ActivityData }) => {
        if (message.type === 'result') resolve(message.data!);
        else if (message.type === 'database') {
          void Promise.resolve().then(() => database ? database(message.log!) : { points: [], origins: [] })
            .then(evidence => worker.postMessage(evidence)).catch(reject);
        } else if (message.type === 'error') reject(new Error('Activity history could not be aggregated.'));
      });
    });
  } finally {
    await worker.terminate();
  }
}
