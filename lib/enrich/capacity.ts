import { config } from '@/config/deployment';

/**
 * Capacity from size, and a floor from angel checks (W1 1.49, W5 1.9) — Juan's two answers of
 * 24 Sep, as rules a checker can hold a band to. The table and the floor are in
 * config/deployment.ts, both GUESSES.
 *
 * A band read off the table says so first — "By size: a family office with $800M in assets" — and a
 * floor the same way — "Floor: 12 angel checks on record, sizes unknown". The words are what a
 * search finds when the table changes, and what the check below parses: code reads the size off
 * the basis and the band off the table, so a band that says "by size" and is not the table's is
 * caught.
 */

export const BY_SIZE = /^\s*by size\b/i;
export const FLOOR = /^\s*floor\b/i;

/** The kinds the table knows, and the words that name each in a basis. */
const KINDS: Array<[string, RegExp]> = [
  ['family_office', /\b(single[- ]family office|family office|principal['’]s (?:office|assets)|investable assets)\b/i],
  ['foundation', /\b(foundation|endowment|charitable trust)\b/i],
  ['wealth_manager', /\b(wealth manager|multi[- ]family office|mfo|ria|registered investment advis[eo]r|adviser|advisor|ocio|private bank)\b/i],
  ['fund_of_funds', /\b(fund of funds|fund-of-funds|lp programme|lp program)\b/i],
  ['individual', /\b(net worth|personal wealth|personally worth)\b/i],
];

/** A dollar amount in words: "$800M", "$1.2 billion", "US$ 3bn". The first one. */
export function parseUsd(text: string): number | null {
  const m = /(?:us)?\$\s?(\d+(?:[.,]\d+)?)\s?(k|thousand|m|mm|mn|million|b|bn|billion)?\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  const unit = (m[2] ?? '').toLowerCase();
  const x = unit.startsWith('k') || unit === 'thousand' ? 1e3 : unit.startsWith('m') ? 1e6 : unit.startsWith('b') ? 1e9 : 1;
  return Number.isFinite(n) ? n * x : null;
}

/** The table's band for a kind and a size, or null for a kind it doesn't know. */
export function bandBySize(kind: string, usd: number): string | null {
  const steps = config.capacity.bySize[kind];
  if (!steps || !Number.isFinite(usd) || usd <= 0) return null;
  return steps.find(([bound]) => usd < bound)?.[1] ?? null;
}

/** What a "By size" basis says: the kind, the size, and the band the table gives them. */
export function sizeReading(basis: string): { kind: string; usd: number; band: string } | null {
  if (!BY_SIZE.test(basis)) return null;
  const kind = KINDS.find(([, re]) => re.test(basis))?.[0];
  const usd = parseUsd(basis);
  if (!kind || !usd) return null;
  const band = bandBySize(kind, usd);
  return band ? { kind, usd, band } : null;
}

/** A "Floor" basis that counts enough angel checks: "Floor: 12 angel checks on record". */
export function floorHolds(basis: string): boolean {
  if (!FLOOR.test(basis)) return false;
  const m = /\b(\d{1,3})\s+(?:\w+\s+){0,2}(?:angel\s+)?(?:checks|investments|deals|companies)\b/i.exec(basis);
  return Boolean(m && Number(m[1]) >= config.capacity.angelFloor.checks);
}

/**
 * A strategy's band by rule, held to its rule: null when the basis claims neither; else whether the
 * band is the one the rule gives.
 */
export function bandByRule(band: string, basis: string): { rule: 'size' | 'floor'; holds: boolean; want: string | null } | null {
  if (BY_SIZE.test(basis)) {
    const r = sizeReading(basis);
    return { rule: 'size', holds: Boolean(r && r.band === band), want: r?.band ?? null };
  }
  if (FLOOR.test(basis)) {
    return { rule: 'floor', holds: floorHolds(basis) && band === config.capacity.angelFloor.band, want: config.capacity.angelFloor.band };
  }
  return null;
}
