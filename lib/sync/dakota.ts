/**
 * Dakota never reaches the cloud (Juan, 4 Oct 2026, decision C; docs/20-dakota.md): a pushed research
 * file is refused when any claim in it rests on Dakota. Checked on the Mac before anything is sent
 * (scripts/cloud-push.sh) and again by the server, which keeps nothing from a refused push.
 *
 * Two tests, both on text only, so they work on findings, reviews and strategies alike:
 *   - a source field — `source`, `url`, `title`, `sources`, a link — that names Dakota at all;
 *   - anywhere, wording that cites Dakota or its product as a source ("per Dakota", "Dakota
 *     Marketplace", "Dakota shows", "dakota.com").
 * The states are not Dakota: "North Dakota" and "South Dakota" (and north-dakota in a URL) pass. A firm
 * or a person merely named Dakota passes in prose, but not as a source. A heuristic: it errs toward
 * refusing, and the reason names the path so a person can look.
 */
const NOT_STATE = String.raw`(?<!north[\s_.-]?|south[\s_.-]?)`;
const NAMES_DAKOTA = new RegExp(`${NOT_STATE}dakota`, 'i');
const CITES_DAKOTA = new RegExp([
  String.raw`\b(?:per|via|from|according to|source[sd]?:?|sourced from|pulled from|in|on)\s+dakota\b(?!\s+(?:capital|partners|county|state|territory|university|college|street|avenue|ventures|group|fund|holdings|wesleyan))`,
  String.raw`${NOT_STATE}\bdakota(?:'s)?\s+(?:marketplace|live|networks?|data(?:base)?|records?|profiles?|crm|exports?|entry|entries|listing|shows|lists|says|reports|notes|flags|marks|has (?:him|her|them|it) as)\b`,
  String.raw`\bdakota(?:marketplace|live)\b`, String.raw`\bdakota\.com\b`, String.raw`marketplace-as-a-service`,
].join('|'), 'i');
const SOURCE_KEYS = new Set(['source', 'sources', 'url', 'title', 'links', 'provenance', 'via']);

export interface DakotaHit { path: string; why: 'source' | 'cites' }

/** Every place a value rests on Dakota, as JSON paths (`facts[2].source.url`). Empty means none found. */
export function dakotaClaims(value: unknown, path = '', underSource = false, out: DakotaHit[] = []): DakotaHit[] {
  if (typeof value === 'string') {
    if (underSource && NAMES_DAKOTA.test(value)) out.push({ path, why: 'source' });
    else if (CITES_DAKOTA.test(value)) out.push({ path, why: 'cites' });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => dakotaClaims(v, `${path}[${i}]`, underSource, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) dakotaClaims(v, path ? `${path}.${k}` : k, underSource || SOURCE_KEYS.has(k), out);
  }
  return out;
}

export const dakotaProblems = (value: unknown): string[] => dakotaClaims(value).map((h) =>
  h.why === 'source' ? `${h.path}: the source is Dakota; Dakota data does not go to the cloud` : `${h.path}: cites Dakota as a source; Dakota data does not go to the cloud`);
