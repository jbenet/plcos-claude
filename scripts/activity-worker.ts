import { parentPort, workerData } from 'node:worker_threads';
import { backfill, readLog, type Evidence } from '../lib/activity/backfill';
import { aggregate } from '../lib/activity/model';

async function run() {
  if (!parentPort) throw new Error('Activity worker requires a parent port.');
  const log = await readLog(workerData.root);
  // Only cutoff dates and hashed run IDs are needed by the SQL reader. Source files and
  // unaggregated observations stay here; the parent receives the compact daily result.
  const database = new Promise<Evidence>(resolve => parentPort!.once('message', resolve));
  parentPort.postMessage({ type: 'database', log: { cutoffs: log.cutoffs, runs: log.runs, points: [], origins: [] } });
  const [history, rows] = await Promise.all([backfill(workerData.root, log), database]);
  parentPort.postMessage({ type: 'result', data: aggregate(
    [...history.points, ...rows.points, ...log.points],
    [...history.origins, ...rows.origins, ...log.origins], new Date().toISOString(),
  ) });
}
void run().catch(() => parentPort?.postMessage({ type: 'error' }));
