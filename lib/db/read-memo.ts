import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A long read that plans many targets one after another (top_connectors, lib/outreach/connectors.ts) asks the same
 * questions thousands of times: which revision the route, edge and read caches are at, which sources are synced, every
 * exposure, the blanket restrictions. On 7 Oct 2026 an invented 5,418-LP vehicle (scripts/connectors-perf.ts) spent more of its SQL time on those
 * than on routes: about ten revision reads per LP. Inside withReadMemo each such statement runs once per parameters.
 *
 * Only these statements, only outside a transaction, and only inside the scope. The caller owns staleness: a plan
 * job is keyed to the revision it started at and is replaced when that moves (connectors.ts planOpen), so reading
 * the revisions once for its lifetime changes nothing it answers. Everything else reads live.
 */
const MEMOIZED = [
  /^\s*select\b[^;]*\bfrom\s+network\.(route|edge|read)_revision\b[^;]*\bsingleton\b[^;]*$/i,
  /^\s*select source, label, status, last_sync_at, detail from platform\.source_sync order by label\s*$/i,
];
// Statements a module marks as safe to share the same way (memoizable below): whole-table reads that only a write moves.
const MARKED = new Set<string>();
/** Mark a read-only statement as shareable inside withReadMemo; returns it unchanged. */
export const memoizable = (sql: string) => { MARKED.add(sql); return sql; };
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export const withReadMemo = <T>(work: () => Promise<T>): Promise<T> => store.run(new Map(), work);

/** `shape` tells apart calls whose results differ in form for the same statement (PGlite's query and one). */
export function memoRead<T>(sql: string, params: unknown[], run: () => Promise<T>, shape = ''): Promise<T> {
  const memo = store.getStore();
  if (!memo || !(MARKED.has(sql) || MEMOIZED.some((re) => re.test(sql)))) return run();
  const key = JSON.stringify([shape, sql, params]);
  let hit = memo.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = run();
    memo.set(key, hit);
    hit.catch(() => { if (memo.get(key) === hit) memo.delete(key); });
  }
  return hit;
}
