import type { FloorItem, Temp } from '@/lib/floor-client';

/**
 * One visual vocabulary, shared by all five views.
 *
 * The views disagree about layout on purpose. They must not disagree about what a colour
 * or a size means, or switching tabs teaches you nothing — it just makes you relearn.
 *
 * - **Size** is money at stake, on a square-root scale so a $18M block is wider than a
 *   $2M one without being nine times wider. An item nobody has a number for is drawn at
 *   the minimum width, never at a guess.
 * - **Fill strength** is recency: solid means something was recorded this week, faint
 *   means nothing for six.
 * - **Hue** is reserved for exceptions — blocked, urgent, cash in the bank — so that a
 *   floor with nothing wrong on it is a floor with no colour on it.
 * - Every one of those is also a word or a glyph on the mark, because colour is never the
 *   only signal.
 */

export const TEMP_ALPHA: Record<Temp, number> = {
  hot: 1, warm: 0.62, cool: 0.34, cold: 0.16, unmoved: 0.07, done: 0.85,
};

export type MarkState = 'blocked' | 'urgent' | 'cash' | 'plain';

export const STATE_GLYPH: Record<MarkState, string> = {
  blocked: '✕', urgent: '!', cash: '✓', plain: '',
};

export const STATE_LABEL: Record<MarkState, string> = {
  blocked: 'Blocked', urgent: 'Dated, soon', cash: 'Cash received', plain: 'Running',
};

export function stateOf(item: FloorItem): MarkState {
  if (item.blocked || item.restricted || item.conflict) return 'blocked';
  if (item.urgent) return 'urgent';
  if (item.cashReceived) return 'cash';
  return 'plain';
}

/** Square-root width scale with a floor, so an unsized item is visibly unsized. */
export function widthScale(items: FloorItem[], min: number, max: number) {
  const top = Math.max(1, ...items.map((i) => i.amount ?? 0));
  return (amount: number | null) => (amount === null || amount === 0
    ? min
    : min + Math.sqrt(amount / top) * (max - min));
}

export function shortName(name: string, max = 18): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

export function compactUsd(amount: number | null): string {
  if (amount === null) return 'no number';
  return amount >= 1_000_000 ? `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`
    : `$${Math.round(amount / 1000)}k`;
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}
