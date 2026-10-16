import type { PipelineRow } from '@/components/strategy/pipeline-model';
import { firstScreen, forBrowser, type Status } from '@/components/strategy/pipeline-model';
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

/** The rows a list's first screen shows (GUESS: its 30 visible rows and a few to move the cursor through). */
const FIRST_SCREEN = 40;

/**
 * A list's rows in two parts (16 Oct 2026): its first screen, packed small and sent at once, and every row, sent in
 * the same response right after it. The table shows on the first part; Neurotech's Pipeline was 1.2 MB to send and
 * unpack before anything showed. Spread into PipelineTable's props.
 */
export function firstThenRest(rows: readonly PipelineRow[], o: { ids: Status[]; mode: 'pipeline' | 'selection';
  initialStatus?: Status | 'all' | null; initialFilters?: Record<string, string>; asOf: string }) {
  const first = firstScreen(rows as PipelineRow[], { ...o, limit: FIRST_SCREEN });
  const packed = packRows(first.rows.map((r) => { const b = forBrowser(r); return { ...b, strategic: { ...b.strategic, reasons: [] } }; }));
  // Resolved on a later turn, so the first part is written before the whole set is.
  const more = new Promise<PackedRows>((resolve) => setTimeout(() => resolve(packPipelineRows(rows, { lean: true })), 0));
  return { packed, more, first: { counts: first.counts, total: first.total } };
}
