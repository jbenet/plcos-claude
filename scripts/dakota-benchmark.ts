/** Usage: node --import tsx scripts/dakota-benchmark.ts. Invented data only; no live DB or replica reads. */
import { translateDakota } from '../lib/connectors/dakota/translate';
import { inventedActor, inventedDakotaDb, inventedDakotaReplicas, observeDakotaJob } from './dakota-batched-properties';
import type { Db, Queryable } from '../lib/db';

const fixture = await inventedDakotaDb(5000);
try {
  const replicas = inventedDakotaReplicas(5000, 10000);
  let batches = 0, phase = '', phaseStarted = performance.now(), lastBatch = phaseStarted, maxBatchMs = 0, reportedRecords = 0;
  let currentRecords = 0, maxIndividualQueryMs = 0, slowestSql = '', maxCommitTailMs = 0, maxTransactionBodyMs = 0;
  const phases: Array<{ phase: string; elapsedMs: number }> = [];
  // SQL prefixes contain no parameters or record values. All records in this process are invented.
  const timed = async <T>(sql: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try { return await work(); }
    finally {
      const elapsed = performance.now() - started, prefix = sql.replace(/\s+/g, ' ').slice(0, 130);
      if (elapsed > maxIndividualQueryMs) { maxIndividualQueryMs = elapsed; slowestSql = prefix; }
      if (elapsed > 500) console.log(`Invented slow query phase=${phase} recordsBeforeBatch=${currentRecords} ms=${Math.ceil(elapsed)} sql=${prefix}`);
    }
  };
  const instrumented: Db = { ...fixture.db, transaction: async fn => {
    let bodyFinished = 0;
    const result = await fixture.db.transaction(async tx => {
      const bodyStarted = performance.now();
      const tracked: Queryable = {
        query: <T>(sql: string, params?: unknown[]) => timed(sql, () => tx.query<T>(sql, params)),
        one: <T>(sql: string, params?: unknown[]) => timed(sql, () => tx.one<T>(sql, params)),
        exec: sql => timed(sql, () => tx.exec(sql)),
      };
      try { return await fn(tracked); }
      finally { bodyFinished = performance.now(); maxTransactionBodyMs = Math.max(maxTransactionBodyMs, bodyFinished - bodyStarted); }
    });
    const tail = performance.now() - bodyFinished; maxCommitTailMs = Math.max(maxCommitTailMs, tail);
    if (tail > 500) console.log(`Invented slow commit phase=${phase} recordsBeforeBatch=${currentRecords} ms=${Math.ceil(tail)}`);
    return result;
  } };
  const measured = await observeDakotaJob(fixture.db, () => translateDakota(instrumented, inventedActor, replicas, {
    batchSize: 200, afterBatch: async progress => {
      batches++;
      const batchAt = performance.now();
      if (batchAt - lastBatch > 1000) console.log(`Invented slow batch phase=${phase} records=${currentRecords}-${progress.done} ms=${Math.ceil(batchAt - lastBatch)}`);
      maxBatchMs = Math.max(maxBatchMs, batchAt - lastBatch); lastBatch = batchAt;
      currentRecords = progress.done;
      if (progress.phase !== phase) {
        const now = performance.now();
        if (phase) phases.push({ phase, elapsedMs: Math.round(now - phaseStarted) });
        phase = progress.phase; phaseStarted = now;
        console.log(`Invented benchmark phase=${phase} records=${progress.done}/${progress.total} batches=${batches}`);
      }
      if (progress.done >= reportedRecords + 1000) {
        reportedRecords = progress.done;
        console.log(`Invented benchmark records=${progress.done}/${progress.total} maxBatchMs=${Math.ceil(maxBatchMs)}`);
      }
    },
  }));
  console.log(JSON.stringify({ records: 15000, batchSize: 200, batches,
    elapsedMs: Math.round(measured.elapsedMs), maxBatchMs: Math.ceil(maxBatchMs), foregroundQueriesAnswered: measured.completedDuringJob,
    maxIndividualQueryMs: Math.ceil(maxIndividualQueryMs), slowestSql,
    maxTransactionBodyMs: Math.ceil(maxTransactionBodyMs), maxCommitTailMs: Math.ceil(maxCommitTailMs),
    maxForegroundQueryMs: Math.ceil(measured.maxQueryMs), maxHeartbeatGapMs: Math.ceil(measured.maxTimerGapMs),
    foregroundErrors: measured.errors.length, phases, counts: measured.result,
  }, null, 2));
  if (measured.errors.length || measured.completedDuringJob < 2 || measured.maxQueryMs >= 2000 || measured.maxTimerGapMs >= 2000) {
    throw new Error('Invented Dakota benchmark exceeded the 2000 ms responsiveness bound.');
  }
} finally { await fixture.close(); }
