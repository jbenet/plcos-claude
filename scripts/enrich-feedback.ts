/** Run in the live folder for real data, before W3/import. No database or external calls.
 * DATA_PROFILE=real npx tsx scripts/enrich-feedback.ts
 * The next approved workflow reads enrich/feedback/find-similar.jsonl.
 */
import { join } from 'node:path';
import { config } from '../config/deployment';
import { processConnectionFeedback } from '../lib/enrich/feedback';

processConnectionFeedback(join(process.cwd(), config.data.root, 'enrich'))
  .then((counts) => console.log(JSON.stringify(counts)))
  .catch(() => { console.error('Feedback processing stopped. Inspect the private feedback files and processing lock before retrying.'); process.exitCode = 1; });
