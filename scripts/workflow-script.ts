/** Run an approved local TS script, recording process status, not invented item/check results. */
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { mainCheckout, readLayout } from '../config/ports';
import { beginRun, realRoot, type Begin } from '../lib/workflows/ledger';
import { finishWithUsage } from '../lib/workflows/usage';

async function main() {
  const [metadataFile, separator, script, ...args] = process.argv.slice(2);
  if (!metadataFile || separator !== '--' || !script) throw new Error('Usage: workflow-script.ts <metadata.json> -- scripts/<script>.ts [args]');
  await realRoot();
  const cwd = await realpath(process.cwd());
  if (readLayout(cwd).role !== 'live' || mainCheckout(cwd) !== cwd) throw new Error('Workflow scripts run only in the live folder.');
  const target = await realpath(resolve(script));
  if (target !== join(cwd, 'scripts', basename(target)) || !target.endsWith('.ts')
      || ['workflow-run.ts', 'workflow-script.ts'].includes(basename(target))) throw new Error('Choose a workflow script directly inside scripts/.');
  const metadata: Begin = JSON.parse(await readFile(metadataFile, 'utf8'));
  const id = await beginRun({ ...metadata, source: 'script', model: null, workerFolder: cwd });
  console.error(`Workflow run: ${id}`);
  const status = await new Promise<{ code: number | null; signal: string | null }>((done) => {
    const child = spawn(process.execPath, ['--import', 'tsx', target, ...args], { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', () => done({ code: null, signal: 'spawn-error' }));
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  await finishWithUsage(id, {
    counts: { selected: metadata.batch.planned, written: null, valid: null, failed: null, skipped: null },
    checks: [{ name: 'process-exit', status: status.code === 0 ? 'pass' : 'fail' }], usage: null,
    outcome: status.code === 0 ? 'succeeded' : 'failed',
    reason: `Process only: exit ${status.code ?? 'unknown'}${status.signal ? ` (${status.signal})` : ''}; item validation not recorded.`,
  });
  process.exitCode = status.code === 0 ? 0 : 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof SyntaxError ? 'Invalid workflow JSON.' : error instanceof Error ? error.message : 'Workflow script failed.');
  process.exitCode = 1;
});
