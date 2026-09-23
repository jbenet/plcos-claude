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

export function usd(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function multiple(n: number): string {
  return `${n.toFixed(1)}×`;
}
