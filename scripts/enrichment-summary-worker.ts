import { parentPort,workerData } from 'node:worker_threads';
import { enrichmentFileSummary } from '../lib/enrich/file-summary';
void enrichmentFileSummary(workerData.dir).then(result=>parentPort?.postMessage({result}),()=>parentPort?.postMessage({error:true}));
