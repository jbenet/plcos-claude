// Deliberately native ESM: Next and CLI launches use the same worker without a compiler.
import { parentPort, workerData } from 'node:worker_threads';
import { PGlite } from '@electric-sql/pglite';

let pg;
let transactionId = null;
let transactionHandle = null;
let finishTransaction = null;
let transactionCompletion = null;
const rollbackSignal = new Error('Requested transaction rollback');
const serializeError = error => ({
  name: error?.name ?? 'Error', message: error?.message ?? 'Database worker failed',
  code: error?.code, detail: error?.detail, constraint: error?.constraint,
  table: error?.table, schema: error?.schema, count: error?.count,
});
try {
  pg = await PGlite.create(workerData.dir);
  parentPort.postMessage({ ready: true });
} catch (error) {
  parentPort.postMessage({ startupError: serializeError(error) });
  parentPort.close();
}
// Serialize even concurrent messages from Promise.all inside a transaction. The parent
// scheduler keeps the entire callback indivisible; IDs additionally refuse stale handles.
let tail = Promise.resolve();
parentPort.on('message', message => {
  tail = tail.then(async () => {
    const { id, op, sql, params = [], tx = null } = message;
    try {
      let value;
      if (op === 'begin') {
        if (transactionId !== null || !tx) throw new Error('Database transaction already active or missing ID');
        // PGlite's native callback owns its transaction flag as well as BEGIN/COMMIT.
        // Plain SQL BEGIN would sync the filesystem after every subsequent statement.
        // Hold that callback open across messages, but release this message queue once
        // its handle is ready; COMMIT/ROLLBACK must still be able to reach the worker.
        let began = false;
        let resolveStarted, rejectStarted;
        const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
        const finish = new Promise(resolve => { finishTransaction = resolve; });
        transactionCompletion = pg.transaction(async handle => {
          transactionHandle = handle;
          transactionId = tx;
          began = true;
          resolveStarted();
          if (await finish) throw rollbackSignal;
        }).then(() => ({}), error => {
          if (!began) rejectStarted(error);
          return error === rollbackSignal ? {} : { error };
        });
        await started;
      } else {
        if (tx !== transactionId) throw new Error('Database transaction handle is no longer active');
        if (op === 'commit' || op === 'rollback') {
          if (!tx) throw new Error('Database transaction ID required');
          finishTransaction(op === 'rollback');
          const outcome = await transactionCompletion;
          transactionId = null;
          transactionHandle = null;
          transactionCompletion = null;
          finishTransaction = null;
          if (outcome.error) throw outcome.error;
        } else if (op === 'close') {
          await pg.close();
        } else if (op === 'exec') {
          await (transactionHandle ?? pg).exec(sql);
        } else if (op === 'query' || op === 'one') {
          const connection = transactionHandle ?? pg;
          const result = params.length ? await connection.query(sql, params) : (await connection.exec(sql)).at(-1);
          const rows = result?.rows ?? [];
          if (op === 'one' && rows.length > 1) {
            const error = new Error(`one() expected at most 1 row, got ${rows.length}`);
            error.name = 'TooManyRows'; error.count = rows.length;
            throw error;
          }
          value = op === 'one' ? rows[0] ?? null : rows;
        } else throw new Error('Unknown database worker operation');
      }
      parentPort.postMessage({ id, value });
      if (op === 'close') parentPort.close();
    } catch (error) {
      parentPort.postMessage({ id, error: serializeError(error) });
    }
  });
});
