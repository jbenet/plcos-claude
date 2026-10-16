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
const packedLean = new WeakMap<readonly PipelineRow[], PackedRows>();
/**
 * `lean`: for the Pipeline table, which sorts and filters on the strategic level and points but never shows the
 * reasons behind them; those texts were 430 KB of Neurotech's 1.6 MB (16 Oct 2026). Selection shows them, so it
 * packs them whole.
 */
export function packPipelineRows(rows: readonly PipelineRow[], { lean = false }: { lean?: boolean } = {}): PackedRows {
  const memo = lean ? packedLean : packed;
  let value = memo.get(rows);
  if (!value) {
    value = packRows(rows.map((r) => {
      const b = forBrowser(r);
      return lean ? { ...b, strategic: { ...b.strategic, reasons: [] } } : b;
    }));
    memo.set(rows, value);
  }
  return value;
}
