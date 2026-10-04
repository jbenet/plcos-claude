/**
 * The email guidelines (docs/email-guidelines.md) as checks a machine can make: what never goes
 * into an email to someone outside — our sources and reading dates, our notes, scores and reasoning,
 * instructions to ourselves, a second message quoted inside the first, the old template's lines, an
 * amount, a portfolio company's private terms — and one vehicle per email.
 *
 * Pure and shared: the strategy checker (lib/enrich/strategy.ts) refuses a first message that fails
 * them, the prefill (modules/email/rules.ts) never starts a draft from one, and the draft-time checks
 * warn when a typed or agent-written draft carries one.
 *
 * Patterns, not understanding: they catch what Juan's 3 Oct 2026 example did ("This is not a good
 * email"), and a person still reads every draft before it goes anywhere.
 */

export type LintRule =
  | 'citation' | 'analysis' | 'third_person' | 'two_messages' | 'template' | 'amount' | 'private'
  | 'other_lps' | 'other_vehicle' | 'mixed_vehicles' | 'performance' | 'length';

export interface LintIssue { rule: LintRule; text: string; match: string }

export type VehicleKind = 'fund' | 'spv' | 'grant_rail';

export interface LintContext {
  /** Who the words are written to. A person's first name is checked for being talked about. */
  recipient?: { name: string | null; isPerson: boolean } | null;
  /** The vehicle this email is about, and the others it must not name. */
  vehicle?: { name: string; kind: VehicleKind } | null;
  otherVehicles?: Array<{ name: string }>;
  /** Over this many words is a `length` issue. Omitted: no length check. */
  maxWords?: number;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE = `(?:\\d{1,2} ${MONTH}(?: \\d{4})?|${MONTH} \\d{1,2},? \\d{4}|${MONTH} \\d{4}|\\d{4}-\\d{2}-\\d{2})`;

/** [rule, pattern, what it is]. Case-insensitive unless the pattern says otherwise. */
const PATTERNS: Array<[LintRule, RegExp, string]> = [
  // Where we read it, and when: a source belongs in our records, not in their inbox.
  ['citation', /\bper (?:our|the team['’]s)\b/i, 'a citation of our own records ("per our …")'],
  ['citation', /\bper (?:the|his|her|their) (?:[\w-]+ ){0,2}(?:document|doc|notes?|records?|research|finding|files?|database|crm|homepage|website|site)\b/i, 'a citation ("per the …")'],
  ['citation', new RegExp(`\\b(?:read|retrieved|accessed|checked|seen|verified)(?: on)? ${DATE}`, 'i'), 'the date we read a source'],
  ['citation', new RegExp(`\\((?:[A-Z][\\p{L}'’-]+|the team|team),? ${DATE}\\)`, 'iu'), 'a note cited by its author and date ("(Juan, 26 Sep)")'],
  ['citation', /\b(?:the team['’]s|our internal|internal|our team['’]s) notes?\b/i, 'our internal notes'],
  ['citation', /\b(?:portfolio document|our records|our notes|our files|the finding|our crm|in affinity|from affinity|dakota|polaris)\b/i, 'our records or research tools'],
  // Our reasoning and our instructions to ourselves.
  ['analysis', /\(draft, nothing sent\)|\bnothing (?:is |was )?sent\b|\bdraft only\b/i, 'a note to ourselves about the draft'],
  ['analysis', /\bfirst message\b|\bafter the introduction:/i, 'an instruction to ourselves'],
  ['analysis', /\bthen the (?:position|ask|money|commitment|pitch|close)\b/i, 'the strategy’s sequence ("then the position")'],
  ['analysis', /\b(?:ask (?:him|her|them) for|offer (?:him|her|them)|lead with|open with|pitch (?:him|her|them))\b/i, 'an instruction to ourselves'],
  ['analysis', /\b(?:propensity|affinity (?:score|level|band)|capacity (?:band|score|estimate)|tier [A-D]\b|(?:high|medium|low) confidence|time to decision|the angle\b|this LP\b|the LP\b|the recipient\b|W[1-9]c?\b)/i, 'scores or strategy language'],
  // Two messages in one: a quoted message inside the email, or the old template's lines after it.
  ['two_messages', /:\s*['‘"“][A-Z][^'’"”]{40,}/, 'a second message quoted inside this one'],
  ['template', /\bI would like to tell you about\b|\bWould you have time for a short call in the next couple of weeks\b/i, 'the old template’s generic line'],
  // Money and private terms.
  ['amount', /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:k|m|mm|million|bn|billion)\b|\b(?:usd|eur|gbp)\s?\d/i, 'an amount'],
  ['private', new RegExp(`\\b(?:pre-?seed|seed|series [a-f]|bridge)\\b(?: round)?,?\\s*(?:in |closed in |in late |in early )?${DATE}`, 'i'), 'a portfolio company’s round and date'],
  ['private', /\b(?:valuation|post-money|pre-money|cap table|pro[- ]rata|term sheet|safe note)\b/i, 'private deal terms'],
  ['other_lps', /\b(?:other|another|existing|our) LPs?\b|\bLPs? (?:like|such as|including)\b|\b(?:has|have) (?:already )?committed\b|\balready in for\b/i, 'other LPs or their decisions'],
  // 506(c) care: no performance claims, no promises.
  ['performance', /\b(?:guarantee[ds]?|risk[- ]free|can['’]?t lose|sure thing|\d+x returns?|returns? of \d|IRR|track record of \d|outperform\w*)\b/i, 'a performance claim or a promise'],
];

const SPV_WORDS = /\b(?:SPVs?|special purpose vehicle|vehicle for individuals|small vehicle|single[- ]company vehicle|co-?invest(?:ment)?)\b/i;
const FUND_WORDS = /\b(?:fund|first close|LP commitment|fund commitment|Neurotech I|Crypto\/Rails|portfolio compan(?:y|ies))\b/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A name or slug in the text as a whole word, at least three letters long. */
export const mentions = (hay: string, needle: string) =>
  needle.trim().length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(needle.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(hay);

/** The first name a person is greeted by, if the text opens with a greeting. */
export function greeted(text: string): string | null {
  const m = /^\s*(?:hi|hello|dear|hey|good (?:morning|afternoon))\s+([\p{L}][\p{L}'’.-]*)/iu.exec(text);
  return m ? m[1]!.replace(/[.,]+$/, '') : null;
}

/** Greeting lines, and sign-off lines: more than one of either is two messages in one. */
const GREETINGS = /^\s*(?:hi|hello|dear|hey)\b[^\n]{0,40},?\s*$/gim;
const SIGNOFFS = /^\s*(?:best|thanks|thank you|cheers|regards|best regards|warmly|all the best)[,.!]?\s*$/gim;

/** Both kinds of vehicle in one email — the fund's portfolio and an SPV, say (domain rules 5 and 11). */
export function mixesVehicles(text: string, kind?: VehicleKind | null): string | null {
  const spv = SPV_WORDS.exec(text)?.[0];
  const fund = FUND_WORDS.exec(text)?.[0];
  if (kind === 'fund') return spv ?? null;
  if (kind === 'spv') return fund ?? null;
  return spv && fund ? `${fund} … ${spv}` : null;
}

/** Everything in `text` the guidelines keep out of an email. Empty means none of these patterns. */
export function lintEmail(text: string, c: LintContext = {}): LintIssue[] {
  const out: LintIssue[] = [];
  for (const [rule, re, what] of PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ rule, text: what, match: m[0] });
  }
  const g = text.match(GREETINGS)?.length ?? 0;
  const s = text.match(SIGNOFFS)?.length ?? 0;
  if (g > 1 || s > 1) out.push({ rule: 'two_messages', text: 'two greetings or two sign-offs: two messages in one', match: `${g} greetings, ${s} sign-offs` });

  // Talking about the person you are writing to: "his field", "Jeremy is …".
  const r = c.recipient;
  if (r?.isPerson && r.name) {
    const first = r.name.trim().split(/\s+/)[0] ?? '';
    const pron = /\b(?:his|her) (?:field|work|firm|fund|office|interests?|background|portfolio|company|research|lab|thesis|focus|money|capacity|career|team|board|checks?|deals?)\b/i.exec(text);
    if (pron) out.push({ rule: 'third_person', text: 'writes about the recipient in the third person', match: pron[0] });
    else if (first.length >= 2) {
      const named = new RegExp(`\\b${esc(first)}(?:['’]s\\b| (?:is|has|was|said|says|backs|backed|invested|invests|runs|ran|leads|led|would|could|might|works|worked|wrote|cares|likes)\\b)`, 'iu').exec(text);
      if (named) out.push({ rule: 'third_person', text: 'writes about the recipient by name, in the third person', match: named[0] });
    }
  }

  if (c.vehicle) {
    for (const v of c.otherVehicles ?? []) {
      if (mentions(text, v.name)) { out.push({ rule: 'other_vehicle', text: `names another vehicle, ${v.name}`, match: v.name }); break; }
    }
    if (c.vehicle.kind !== 'grant_rail') {
      // The email's own vehicle is no mix: "Netholabs SPV" in the SPV's email.
      const own = text.replace(new RegExp(esc(c.vehicle.name), 'giu'), ' ');
      const mixed = mixesVehicles(own, c.vehicle.kind);
      if (mixed) out.push({ rule: 'mixed_vehicles', text: `${c.vehicle.kind === 'fund' ? 'an SPV' : 'the fund'} in an email about ${c.vehicle.name}`, match: mixed });
    }
  } else {
    const mixed = mixesVehicles(text);
    if (mixed) out.push({ rule: 'mixed_vehicles', text: 'a fund and an SPV in one email', match: mixed });
  }
  if (c.maxWords && words(text) > c.maxWords) out.push({ rule: 'length', text: `${words(text)} words, over ${c.maxWords}`, match: '' });
  return out;
}

export const wordCount = words;

/** Sentences in a short note, for the forwardable blurb (3–4). */
export const sentenceCount = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z‘“"'])/).filter((x) => x.trim()).length;
