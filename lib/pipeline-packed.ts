import type { PipelineRow } from '@/components/strategy/pipeline-model';
import { forBrowser } from '@/components/strategy/pipeline-model';
import { packRows, type PackedRows } from '@/lib/packed-rows';

/**
 * The pipeline's rows as the browser gets them, packed once per build of the rows (15 Oct 2026: packing 6,000 rows
 * was about 70 ms of every Pipeline and Selection view). Keyed by the rows array itself: the shared cache's array
 * for a person who sees every column, a fresh (redacted) one for anyone else, which is packed each time as before.
 * The packed value is shared: never change it.
 */
const packed = new WeakMap<readonly PipelineRow[], PackedRows>();
export function packPipelineRows(rows: readonly PipelineRow[]): PackedRows {
  let value = packed.get(rows);
  if (!value) { value = packRows(rows.map(forBrowser)); packed.set(rows, value); }
  return value;
}
