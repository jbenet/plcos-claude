/**
 * One formatter, used everywhere a number appears.
 *
 * There is deliberately no helper here that sums across vehicles or across tracks. A
 * convenient blended total is exactly how a $30M gap gets reported as closed three weeks
 * before it is (CLAUDE.md, rule 1).
 */
export function usdM(amount: number, digits = 1): string {
  return `$${(amount / 1_000_000).toFixed(digits)}M`;
}

/** A claimed size, compact: $2.4B, $5.0M, $250,000. For a figure, not a headline. */
export function usdCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return usdM(amount);
  return usd(amount);
}

/**
 * Formatters made once: `toLocaleString` builds a new one on every call, about 30 times the cost of using one, and LP
 * stats formats a few thousand numbers per build (performance pass, 17 Oct 2026). Same output as before.
 */
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const GROUPED = new Intl.NumberFormat('en-US');
const USD_SHORT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export function usd(amount: number): string {
  return USD.format(amount);
}

/**
 * Compact dollars, one decimal at most: $2.5M, $750K, $40. Strategy's tables made a formatter per cell, about a tenth
 * of rendering the page (perf pass, 17 Oct 2026).
 */
export function usdShort(amount: number): string {
  return USD_SHORT.format(amount);
}

/** A count or whole amount with thousands separators: 12,345 (what `n.toLocaleString('en-US')` gives). */
export function grouped(n: number): string {
  return GROUPED.format(n);
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function multiple(n: number): string {
  return `${n.toFixed(1)}×`;
}
