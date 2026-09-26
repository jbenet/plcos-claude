import type { Path } from './connect';

/** W3 includes connector-only rows. Only pipeline keys belong in LP coverage. */
export function connectionCoverage(paths: Path[], lpKeys: string[]) {
  const pipeline = new Set(lpKeys);
  const lps = paths.filter((p) => pipeline.has(p.lp));
  const count = (ps: Path[]) => new Set(ps.map((p) => p.lp)).size;
  const warm = new Set(lps.filter((p) => ['A', 'B'].includes(p.tier)).map((p) => p.lp));
  return {
    reached: count(lps), total: pipeline.size,
    nonLpEndpoints: count(paths.filter((p) => !pipeline.has(p.lp))),
    warehouseReached: count(lps.filter((p) => p.warehouse)),
    viaIntermediaries: count(lps.filter((p) => p.warehouse?.ties.length === 2)),
    warm: warm.size, onlyCD: count(lps.filter((p) => !warm.has(p.lp))),
  };
}
