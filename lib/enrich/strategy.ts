/**
 * W4 and W5 — fit, angle, strategy and the next action (N64, docs/19): what a working session
 * writes for one LP, `data/<profile>/enrich/strategy/<key>.json`, from the public profile (W1),
 * the paths (W3), and where they stand with us. A proposal for a person, never a decision: the
 * import turns it into a suggestion someone accepts or dismisses, and accepting changes only the
 * pursuit's next step. It never sets a status, records a rung, touches money, or sends anything.
 *
 * The scores follow docs/04 §4 — capacity, affinity, propensity, time to decision — each with
 * its evidence, never collapsed into one number; and docs/04 §0's two lists, this year's close
 * and 2027.
 */

export type Level = 'high' | 'medium' | 'low' | 'unknown';

export interface Strategy {
  key: string;
  name: string;
  /**
   * `inputs` pins what it was written from (iteration 3; CLAUDE.md, Agent rules: run records pin
   * their inputs): the finding's `researched.at`, or null when there was none. A strategy whose LP
   * has a newer finding is stale, and the checker says so.
   */
  made: {
    at: string; by: string; workflow: 'W5'; version: number;
    inputs?: { finding: string | null; money?: string | null; bestPath?: 'A' | 'B' | 'C' | 'D' | null; lead?: { key: string; at: string } | null };
    /** Changes made by rule after it was written — each traceable to the rule that made it. */
    revised?: Array<{ at: string; by: string; rule: string }>;
  };
  fit: Record<string, { verdict: 'strong' | 'good' | 'possible' | 'weak' | 'unknown'; why: string; gates?: Array<{ gate: string; answer: 'yes' | 'no' | 'unknown'; basis: string }> }>;
  scores: {
    capacity: { band: string; basis: string };
    affinity: { level: Level; basis: string };
    propensity: { level: Level; basis: string };
    timeToDecision: { band: 'weeks' | '1–2 months' | 'a quarter or more' | 'unknown'; basis: string };
  };
  /** Why they'd care, from their own record, in a sentence or two. */
  angle: string;
  /** The best path in, from W3 — or none, said so. */
  route: { via: string; tier: 'A' | 'B' | 'C' | 'D'; why: string } | null;
  /**
   * `lookAgain` (the critic's fourth round): when the step parks the LP, the date to look again — a
   * park "until the search pass" with no date is a park for good if the pass never runs.
   */
  next: { what: string; who: string; when: string; material?: string | null; lookAgain?: string | null };
  /** `co-invest` (W5 v1.3): a fund in our field that backs our portfolio companies — a co-investor, not an LP. */
  ask: { vehicle: string; shape: 'fund commitment' | 'SPV' | 're-up or upsize' | 'intro to others' | 'advice' | 'verify first' | 'firm-level ask' | 'co-invest' | 'none yet'; range?: string | null;
    /** Who would commit (W5 1.5, s16): the unit at the firm, or "personal" for a partner's own check. */
    unit?: string | null };
  openQuestions: string[];
  risks: string[];
  list: 'this year' | '2027' | 'not now';
  confidence: 'high' | 'medium' | 'low';
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** The import keeps what, who and when together in 400 characters (W5 v1.3); longer is cut, not refused. */
export const nextTooLong = (s: Pick<Strategy, 'next'>) => `${s.next.what} — ${s.next.who}, ${s.next.when ?? ''}`.length > 400;
/** W5 v1.5: one person, one action, a date — under 300 characters with who and when. */
export const nextOverLimit = (s: Pick<Strategy, 'next'>) => `${s.next.what} — ${s.next.who}, ${s.next.when ?? ''}`.length > 300;

/** The close track as a strategy pins it (W5 v1.5): "<track> <state> <amount>", or null. */
export const moneyKey = (m: { track: string; state: string; amount: number } | null | undefined) => (m ? `${m.track} ${m.state} ${m.amount}` : null);

/**
 * Written before its LP's current finding — from records alone, or from an older finding — or,
 * when it pinned the close track (v1.5), before that changed.
 */
export function isStale(
  s: Pick<Strategy, 'made'>,
  finding: { researched: { at: string; corrected?: Array<{ at: string }> } } | null | undefined,
  money?: { track: string; state: string; amount: number } | null,
  bestPath?: 'A' | 'B' | 'C' | 'D' | null,
  /** The team's newest context on this LP (issue 0016): a strategy written before it is due a re-think. */
  contextAt?: string | null,
): boolean {
  if (contextAt && s.made.at && Date.parse(contextAt) > Date.parse(s.made.at)) return true;
  const pinned = s.made.inputs;
  if (pinned && 'money' in pinned && money !== undefined && (pinned.money ?? null) !== moneyKey(money)) return true;
  // The best path on file when it was written (v1.5, v01's learning): a route resting on a path W3
  // no longer finds needs rewriting.
  if (pinned && 'bestPath' in pinned && bestPath !== undefined && (pinned.bestPath ?? null) !== bestPath) return true;
  if (!finding) return false;
  // A correction made to the finding after the strategy was written — the fact check, a band sweep —
  // keeps `researched.at`, so the pin still matches while the strategy may repeat what was cut (W5
  // after the search pass).
  if (s.made.at && (finding.researched.corrected ?? []).some((c) => Date.parse(c.at) > Date.parse(s.made.at))) return true;
  if (pinned?.finding !== undefined) return pinned.finding !== finding.researched.at;
  return new Date(finding.researched.at).getTime() > new Date(s.made.at).getTime();
}

/**
 * The critic's evidence gates (W5 v1.5), as warnings: what a strategy claims beyond what the files
 * show. "This year" needs a word from them in the last 90 days, money on the close track, or a
 * meeting that wasn't a group date; a capacity band needs the finding's estimate or money on file;
 * a route can't be better than the best path W3 found for the LP.
 */
/** What counts as evidence for a capacity band (1.18): money, assets, a check, a filing. */
// A bare "commit" is a practice, not money (W5c round three: "commits to venture funds" read as
// capacity); a commitment counts through its amount or its filing.
export const CAPACITY_EVIDENCE = /\$\s?\d|\b\d+(\.\d+)?\s?(m|mm|million|b|bn|billion|k)\b|\baum\b|assets|net worth|13f|form d|form 4|990|filing|check size|checks? of|holdings|stake|sold|raised|fund size|shares? (held|owned)|holds [\d,]+ shares/i;

/**
 * Evidence in a band's basis, clause by clause (s08, v04): a match inside a denial ("no LP
 * commitment is on record") is the absence of evidence, and a company's valuation or the size of a
 * round it raised is the company's money, not the person's.
 */
export function hasCapacityEvidence(basis: string, today = new Date()): boolean {
  // Old evidence is no evidence (s19): a clause whose every year is more than six years back.
  const stale = (clause: string) => {
    const years = [...clause.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    return years.length > 0 && years.every((y) => y < today.getFullYear() - 6);
  };
  // A Form D's "date of first sale" is a date, not a sale (W5 after the search pass): it tripped the
  // sale-price filter below, so no Form D fact could count.
  return basis.split(/(?<=[.;])\s+|,\s+(?:but|and)\s+/).map((c) => c.replace(/\b(?:date of )?first sale\b/gi, 'filing date'))
    .some((clause) => CAPACITY_EVIDENCE.test(clause) && !stale(clause)
    && !/\b(no|not|none|never|without|nothing|unknown|unclear|unconfirmed|unverified)\b|n['’]t\b/i.test(clause)
    && !/\b(valuation|valued at|rounds?|raised|series [a-f]|company['’]s)\b/i.test(clause)
    // A hypothetical is no evidence (s21): "a personal commitment would be his decision". "may" in
    // lower case only: the month in "(May 2026)" is a date, not a hedge (W5 after the search pass).
    && !/\b(would|could|might)\b/i.test(clause) && !/\bmay\b/.test(clause)
    && !/\b(under|less than|below|up to)\s+\$/i.test(clause)
    // A company's sale price and a GP's fund sizes are not the LP's own money (s11) — but their own
    // shares sold, on a Form 4, are (s16).
    && !/\b(sold for|sale price|acquired for|acquisition price|funds? of \$|fund size|under management|project value|offered|offering)\b/i.test(clause)
    // The size of a fund they back is that fund's money (s24): "an LP in Fund III, €90 million".
    && !/\b(an? LP in|limited partner in|backed|backs|invested in)\b[^.;]*\bfund\b/i.test(clause)
    && (!/\b(sale|acquisition|acquired|merger|buyout|to [A-Z][\w&.-]*( [A-Z][\w&.-]*)* for \$)\b/.test(clause) || /\b(form 4|shares|proceeds|stake|holding)\b/i.test(clause)));
}

/**
 * Where the record or the research places an LP, tested for the US (s24): outside it, counsel comes
 * before any fund material (W5 1.5). A place not stated is not "outside"; the US territories are in
 * (a reviser found Puerto Rico flagged as abroad), and so is "U.S." however it is spaced.
 */
export const IN_US = /(?:^|[^a-z])u\.\s?s\.(?:\s?a\.?)?(?![a-z])|\b(united states|usa|puerto rico|guam|virgin islands|northern mariana islands|american samoa|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawai['ʻ’]?i|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|san francisco|los angeles|boston|chicago|seattle|miami|austin|denver)\b/i;
export const outsideUs = (where: string | null | undefined): boolean => Boolean(where?.trim()) && !IN_US.test(where ?? '');
/**
 * Outside the US when some source places them and none places them in it (v13a1): a finding's short
 * "Palo Alto" beside our record's "Palo Alto, California, United States" is the US.
 */
export const placedOutsideUs = (places: Array<string | null | undefined>): boolean => {
  const said = places.filter((p): p is string => Boolean(p?.trim()));
  return said.length > 0 && !said.some((p) => IN_US.test(p));
};

/** A step that parks the LP with no date to look again (the critic's fourth round). */
export function parksWithoutDate(s: { next?: { what: string; lookAgain?: string | null } }): boolean {
  const what = s.next?.what ?? '';
  // "park" or "parked" as a word — not "a parked page" (a dead domain, W1 1.25) nor "Parker" (W5 after
  // the search pass: a domain note in a next step read as a park with no date).
  // …and a park worded without the word: "waits for the search pass", "hold until the fund closes".
  const at = what.search(/\bpark(?:ed)?\b(?!\s+(?:page|domain|site|website))|\bwait(?:s|ing)?\s+(?:for|until)\b|\bhold(?:s|ing)?\s+(?:until|till)\b/i);
  if (at < 0 || s.next?.lookAgain) return false;
  // The park's own date: introduced by "to", "until", "till" or "look again" — not any date later in
  // the sentence (W5 after the search pass: "park until the search pass; the Form D was filed 3 Jun
  // 2026" passed on the filing's date).
  const date = String.raw`(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})`;
  // A weekday may come first: "to Mon 4 Jan 2027".
  return !new RegExp(String.raw`\b(?:to|until|till|through|look again(?: on| in)?|revisit(?: on| in)?)\s+(?:the\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?${date}\b`, 'i').test(what.slice(at));
}

export function gates(
  s: Pick<Strategy, 'list' | 'scores' | 'route'> & { ask?: Strategy['ask']; angle?: string; next?: { what: string; lookAgain?: string | null }; risks?: string[]; openQuestions?: string[] },
  c: { contact: { lastFromThem: string | null; meetings: number; groupMeetings: number }; money: unknown; notes?: Array<{ summary: string | null }>; location?: string | null } | undefined,
  finding: { profile?: { investorType?: string; capacity?: { band: string; basis?: string } }; identity?: { canonical?: { location?: string | null } | null }; facts?: Array<{ field: string; value: string }> } | null | undefined,
  bestTier: 'A' | 'B' | 'C' | 'D' | null,
  today = new Date(),
): string[] {
  const out: string[] = [];
  if (!c) return out;
  const recent = c.contact.lastFromThem && today.getTime() - new Date(c.contact.lastFromThem).getTime() <= 90 * 86_400_000;
  const oneToOne = c.contact.meetings > c.contact.groupMeetings;
  if (s.list === 'this year' && !recent && !c.money && !oneToOne) out.push('this year, without the evidence gate');
  // The finding's own band counts only when its basis is evidence (1.18): assets, a check or a
  // commitment on record, a filing — not a title or a career (v03's learning).
  const fb = finding?.profile?.capacity;
  // A manager's assets under management are its clients' money, not the LP's own (v08) — except for
  // a family office's principal or a foundation, whose office's money is theirs to direct.
  const ownsItsAssets = ['fo_principal', 'foundation', 'angel'].includes(finding?.profile?.investorType ?? '');
  const managersMoney = !ownsItsAssets && /\b(aum|aua|assets under management|manages|managed|manager|under management|under advice|under advisement|advised assets|supervises|supervised|advises on|advisory assets|client assets)\b/i.test(fb?.basis ?? '');
  // Our own notes count too (v09): a family office's stated minimum can sit only in a note.
  const fromNotes = (c?.notes ?? []).some((n) => n.summary && hasCapacityEvidence(n.summary));
  // And the finding's own facts (v13a2): a net worth recorded as a capacity fact is evidence even when
  // the profile's summary only says "a billionaire". Assets under management count only for an
  // investor whose assets are their own.
  const fromFacts = (finding?.facts ?? []).some((f) => (f.field === 'capacity' || f.field === 'check_size' || (f.field === 'aum' && ownsItsAssets)) && hasCapacityEvidence(f.value));
  const evidenced = Boolean((fb && fb.band !== 'unknown' && hasCapacityEvidence(fb.basis ?? '') && !managersMoney) || fromNotes || fromFacts);
  const band = s.scores?.capacity?.band ?? 'unknown';
  if (!/unknown|not known/i.test(band) && !evidenced && !c.money) out.push('capacity ahead of the evidence');
  const rank = { A: 0, B: 1, C: 2, D: 3 } as const;
  if (s.route && (bestTier === null || rank[s.route.tier] < rank[bestTier])) out.push('route better than the best path on file');
  // A range on the ask with no capacity behind it gets round the capacity gate (the critic, round two).
  // An amount, not any digit: a rule number or "Fund 3" in the range is no size (s15).
  if (s.ask?.range && /\$\s?\d|\b\d+(\.\d+)?\s?(k|m|mm|million|b|bn|billion)\b/i.test(s.ask.range) && /unknown|not known/i.test(band) && !c.money) out.push('ask sized without capacity');
  // An LP placed outside the US (1.5): the counsel gate is written into the strategy. The critic's
  // third round found every such strategy on the list we act on first without it.
  const said = [s.angle, s.next?.what, ...(s.risks ?? []), ...(s.openQuestions ?? [])].filter(Boolean).join(' ');
  if (placedOutsideUs([finding?.identity?.canonical?.location, c.location]) && !/\bcounsel\b/i.test(said)) out.push('outside the US, no counsel gate');
  if (parksWithoutDate(s)) out.push('a park with no date to look again');
  return out;
}

export function checkStrategy(s: unknown, expectKey?: string): string[] {
  const p: string[] = [];
  const x = s as Partial<Strategy>;
  if (!x || typeof x !== 'object') return ['not an object'];
  if (!isStr(x.key)) p.push('no key');
  if (expectKey && x.key !== expectKey) p.push('key does not match its file name');
  if (!x.fit || typeof x.fit !== 'object' || !Object.keys(x.fit).length) p.push('no fit');
  for (const k of ['capacity', 'affinity', 'propensity', 'timeToDecision'] as const) {
    if (!x.scores?.[k] || !isStr((x.scores[k] as { basis?: string }).basis)) p.push(`scores.${k} needs a basis`);
  }
  if (!isStr(x.angle)) p.push('no angle');
  if (!x.next || !isStr(x.next.what) || !isStr(x.next.who)) p.push('next needs what and who');
  // The verb beside "now" or "automatically" — not a description ("our email … now redirects", s17).
  if (x.next && /\b(send|email|message|post)\s+(it|them|this|the \w+)?\s*(now|automatically)\b|\bautomatically\s+(send|email|message|post)/i.test(x.next.what)) p.push('next reads as an automatic send');
  if (!x.ask || !isStr(x.ask.vehicle)) p.push('ask needs a vehicle');
  if (!['this year', '2027', 'not now'].includes(x.list ?? '')) p.push('list must be this year, 2027 or not now');
  if (x.route && !['A', 'B', 'C', 'D'].includes(x.route.tier)) p.push('route tier must be A–D');
  return p;
}
