/** Launcher-owned recording; see docs/COLLAB.md. Never starts a workflow. */
import { readFile } from 'node:fs/promises';
import { beginRun, finishRun } from '../lib/workflows/ledger';

async function main() {
  const [command, first, second, ...extra] = process.argv.slice(2);
  if (extra.length || !first || (command === 'begin' ? Boolean(second) : command !== 'finish' || !second)) {
    throw new Error('Usage: workflow-run.ts begin <metadata.json> | finish <runId> <result.json>');
  }
  if (command === 'begin') console.log(await beginRun(JSON.parse(await readFile(first, 'utf8'))));
  else await finishRun(first, JSON.parse(await readFile(second!, 'utf8')));
}
main().catch((error: unknown) => {
  // JSON parsing can echo private input in its error message.
  console.error(error instanceof SyntaxError ? 'Invalid workflow JSON.' : error instanceof Error ? error.message : 'Workflow recording failed.');
  process.exitCode = 1;
});
