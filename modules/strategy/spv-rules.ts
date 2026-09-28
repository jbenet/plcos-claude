/**
 * SPV stance (Juan, 27 Sep 2026): whether an LP unit does SPVs, and the least number of SPV or
 * co-investment deals we know of. Pure rules, no data access, so the properties and the browser can
 * use them (exported through client.ts).
 *
 *   1. A person's setting on the LP page wins, whatever the evidence says. It is reversible.
 *   2. Research facts (spv_appetite, spv_deals) beat derived signals.
 *   3. Derived signals: our own SPV commitments, then Dakota's co-investment flag, then research text.
 *   Within a tier the stronger evidence wins (kind, then confidence, then the newer date); when the
 *   evidence disagrees the losing side is shown as a conflict, never dropped.
 *   Nothing on file is `unknown`, read as "likely open": unsupported is not a refusal (rule 7).
 */

export type SpvStance = 'unknown' | 'does' | 'does-not';
export const SPV_STANCES: SpvStance[] = ['does', 'does-not', 'unknown'];
export type SpvKind = 'person' | 'research' | 'pipeline' | 'dakota' | 'text';
export type SpvConfidence = 'high' | 'medium' | 'low';

/** One piece of evidence, with rule 9's provenance: source, as of, confidence, last verified by. */
export interface SpvEvidence {
  kind: SpvKind;
  stance: SpvStance;
  /** A lower bound: known SPV or co-investment deals. Null when nothing counts them. */
  minDeals: number | null;
  /** What it is, in words: "Dakota: co-invests", "In 2 of our SPVs", "Research: does SPVs". */
  label: string;
  /** A short quote from our research's public source, or a person's note. Never Dakota text. */
  quote: string | null;
  source: string;
  url: string | null;
  asOf: string;
  confidence: SpvConfidence;
  lastVerifiedBy: string | null;
}

export interface SpvReading {
  stance: SpvStance;
  minDeals: number | null;
  /** Where the stance comes from. 'none' is the default: nothing on file either way. */
  basis: 'person' | 'research' | 'derived' | 'none';
  winner: SpvEvidence | null;
  /** Everything on file, strongest first: the winner, what agrees, what disagrees. */
  evidence: SpvEvidence[];
  /** The strongest evidence on the other side, when there is some. */
  conflict: SpvEvidence | null;
}

const TIER: Record<SpvKind, number> = { person: 3, research: 2, pipeline: 1, dakota: 1, text: 1 };
/** Within derived signals: our own records, then a vendor's flag, then words in research text. */
const KIND: Record<SpvKind, number> = { person: 0, research: 0, pipeline: 3, dakota: 2, text: 1 };
const CONF: Record<SpvConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Stronger first. A tie goes to the newer date, then to does-not: the careful reading. */
export function strongerFirst(a: SpvEvidence, b: SpvEvidence): number {
  return TIER[b.kind] - TIER[a.kind] || KIND[b.kind] - KIND[a.kind] || CONF[b.confidence] - CONF[a.confidence]
    || b.asOf.localeCompare(a.asOf) || (a.stance === 'does-not' ? -1 : 0) - (b.stance === 'does-not' ? -1 : 0);
}

/** Only a person may assert `unknown`; from anywhere else, unknown is the absence of a stance. */
const bears = (e: SpvEvidence) => e.kind === 'person' || e.stance !== 'unknown';

export function resolveSpv(evidence: SpvEvidence[]): SpvReading {
  const all = [...evidence].sort(strongerFirst);
  const winner = all.find(bears) ?? null;
  if (!winner) return { stance: 'unknown', minDeals: null, basis: 'none', winner: null, evidence: all, conflict: null };
  const stance = winner.stance;
  // A count is a lower bound, so the largest agreeing one holds; a person's own count wins when given.
  const counts = all.filter((e) => e.stance === 'does' && e.minDeals && e.minDeals > 0).map((e) => e.minDeals!);
  const minDeals = stance !== 'does' ? null
    : winner.kind === 'person' && winner.minDeals ? winner.minDeals : counts.length ? Math.max(...counts) : null;
  const conflict = all.find((e) => bears(e) && e !== winner && e.stance !== stance && e.stance !== 'unknown') ?? null;
  const basis = winner.kind === 'person' ? 'person' : winner.kind === 'research' ? 'research' : 'derived';
  return { stance, minDeals, basis, winner, evidence: all, conflict };
}

/** The compact mark in a list: "≥4 SPVs", "SPVs", "no SPVs", "SPVs ?". */
export function spvMark(r: Pick<SpvReading, 'stance' | 'minDeals'>): string {
  return r.stance === 'does' ? (r.minDeals ? `≥${r.minDeals} SPVs` : 'does SPVs') : r.stance === 'does-not' ? 'no SPVs' : 'SPVs ?';
}
/** The stance in words. */
export function spvWords(r: Pick<SpvReading, 'stance' | 'minDeals'>): string {
  return r.stance === 'does'
    ? r.minDeals ? `Does SPVs · ≥ ${r.minDeals} known SPV or co-investment ${r.minDeals === 1 ? 'deal' : 'deals'}` : 'Does SPVs · count not known'
    : r.stance === 'does-not' ? 'Doesn’t do SPVs' : 'Unknown, likely open';
}
export const SPV_BASIS_LABEL: Record<SpvReading['basis'], string> = {
  person: 'set by a person', research: 'from research', derived: 'derived from our records', none: 'nothing on file',
};
export const SPV_KIND_LABEL: Record<SpvKind, string> = {
  person: 'A person’s setting', research: 'Research', pipeline: 'Our SPVs', dakota: 'Dakota', text: 'Research text',
};

/** The compact reading a list row carries: small enough for thousands of rows. */
export interface SpvRowMark {
  stance: SpvStance;
  minDeals: number | null;
  basis: SpvReading['basis'];
  /** Why, in one line: the winning evidence's label and source, for a title or a dimmed row. */
  why: string | null;
  /** The same, short: whose word and when, for a dimmed row. */
  short: string | null;
  conflict: boolean;
}
export function spvRowMark(r: SpvReading): SpvRowMark {
  const w = r.winner;
  const why = !w ? null : w.kind === 'person'
    ? `${w.lastVerifiedBy ? `Set by ${w.lastVerifiedBy}` : 'Set by a person'} ${w.asOf}${w.quote ? `: “${w.quote}”` : ''}`
    : `${w.label}${w.quote ? `: “${w.quote}”` : ''} (${w.asOf})`;
  const short = !w ? null : w.kind === 'person' ? `set by ${w.lastVerifiedBy ?? 'a person'}, ${w.asOf}`
    : `${w.kind === 'research' ? 'research' : w.label}, ${w.asOf}`;
  return { stance: r.stance, minDeals: r.minDeals, basis: r.basis, why, short, conflict: Boolean(r.conflict) };
}

// ── Research facts (W1 fields spv_appetite and spv_deals) ──────────────────────────────────────

/** spv_appetite's value: exactly one of the three stances. */
export const spvAppetite = (value: unknown): SpvStance | null =>
  typeof value === 'string' && (SPV_STANCES as string[]).includes(value.trim()) ? value.trim() as SpvStance : null;
/** spv_deals's value: a whole number of deals, as a number or digits (a trailing "+" is allowed). */
export function spvDeals(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
  const m = typeof value === 'string' ? /^\s*(\d{1,5})\+?\s*$/.exec(value) : null;
  return m && Number(m[1]) <= 10000 ? Number(m[1]) : null;
}

// ── Derived from research text ────────────────────────────────────────────────────────────────

const VEHICLE = String.raw`(?:SPVs?|special[- ]purpose vehicles?|co-?investments?|co-?investing|co-?invest\s+(?:program|programme|opportunit\w*|rights|alongside)|syndicat(?:es?|ions?|ed deals?))`;
const NOT = new RegExp(String.raw`\b(?:(?:does|do|did|will)\s+not|doesn['’]t|don['’]t|won['’]t|never|no|avoids?|declines?|not\s+(?:open\s+to|interested\s+in))\b[^.;:]{0,40}?\b${VEHICLE}`, 'i');
const ONLY_FUNDS = /\b(?:only|exclusively|solely)\s+(?:invests?|investing|allocates?|commits?)?\s*(?:in|through|via|to)\s+(?:(?:blind[- ]pool|commingled|primary)\s+)?funds\b|\bfund(?:s|\s+commitments)\s+only\b|\bno\s+direct\s+(?:or\s+co-?invest\w*\s+)?deals\b/i;
const CAVEAT = /\b(?:unknown|unverified|not\s+verified|verified|no\s+(?:explicit|specific|public|evidence|record)|evidence|inferr?e?d?|establish(?:es|ed)?|prove[ns]?|unclear|not\s+found|was\s+found|were\s+found|opened\s+sources|companion|appetite)\b/i;
const YES = new RegExp(String.raw`\b${VEHICLE}\b`, 'i');
const COUNT = new RegExp(String.raw`\b(\d{1,3})\s+(?:\w+\s+)?(?:SPVs|special[- ]purpose vehicles|co-?investments|syndicat(?:es|ed deals))\b`, 'i');

/** A sentence around the match, cut to 25 words: what the evidence shows. */
function around(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  const endDot = text.indexOf('.', index);
  const sentence = text.slice(start, endDot < 0 ? undefined : endDot + 1).trim();
  const words = sentence.split(/\s+/);
  return words.length <= 25 ? sentence : `${words.slice(0, 25).join(' ')}…`;
}

/**
 * What a piece of research text says about SPVs, if anything. "Does not do SPVs" and "only invests
 * through funds" read as does-not; a named SPV, co-investment or syndicate as does, with a count when
 * the text gives one. Weak evidence: it is words, not a record, and ranks below every other kind.
 */
export function readSpvText(text: string): { stance: Exclude<SpvStance, 'unknown'>; minDeals: number | null; quote: string } | null {
  if (!text) return null;
  // Sentence by sentence. A sentence about the evidence itself ("SPV appetite unknown", "no explicit
  // SPV mandate verified", "not inferred") is a research caveat, not the LP's policy, and says nothing
  // either way (27 Sep: 257 such caveats had been read as "doesn't do SPVs").
  const sentences = text.split(/(?<=[.;!?])\s+|\n+/);
  let yes: { sentence: string; count: number | null } | null = null;
  for (const sentence of sentences) {
    if (!YES.test(sentence) && !ONLY_FUNDS.test(sentence)) continue;
    if (CAVEAT.test(sentence)) continue;
    const no = NOT.exec(sentence) ?? ONLY_FUNDS.exec(sentence);
    if (no) return { stance: 'does-not', minDeals: null, quote: around(sentence, no.index) };
    if (!yes) { const count = COUNT.exec(sentence); yes = { sentence, count: count ? Number(count[1]) || null : null }; }
  }
  if (!yes) return null;
  const at = YES.exec(yes.sentence)?.index ?? 0;
  return { stance: 'does', minDeals: yes.count, quote: around(yes.sentence, at) };
}

/** Dakota's co_investments__c, read as a flag. Only a yes is a signal; its text is never kept. */
export const dakotaCoInvests = (value: unknown): boolean => /^\s*(true|yes|y|1)\b/i.test(String(value ?? ''));
export const DAKOTA_SPV_LABEL = 'Dakota: co-invests';
