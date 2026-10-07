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
import { bandByRule } from './capacity';
import { greeted, lintEmail, sentenceCount, wordCount } from '../email/lint';

export type Level = 'high' | 'medium' | 'low' | 'unknown';

/**
 * The kinds of email (docs/email-guidelines.md): an intro ask to the connector, with a note they can
 * forward; the first message after an introduction (or from a team member who knows them); a cold
 * note, rare; a follow-up to someone who has met us; a reply we owe.
 */
export type EmailKind = 'intro_ask' | 'after_intro' | 'cold' | 'follow_up' | 'reply';
export const EMAIL_KINDS: EmailKind[] = ['intro_ask', 'after_intro', 'cold', 'follow_up', 'reply'];

/**
 * The next email to write, as its own field (W5 1.11, Juan 3 Oct 2026: "This is not a good email").
 * The words go to the recipient as they stand: written to them, in the sender's voice, with none of
 * the analysis — no sources, reading dates, notes, scores or instructions to ourselves. The LP page's
 * Email box starts from this and nothing else.
 */
export interface FirstMessage {
  kind: EmailKind;
  /** The route holder who sends it: a team member's name as in us/team.json. */
  from: string;
  /** The recipient: the LP, or for an intro ask the connector. `key` is their entity key when known. */
  to: { name: string; key?: string | null; isPerson?: boolean };
  subject: string;
  /** Greeting to sign-off, paragraphs separated by a blank line. Aim for 80–150 words. */
  body: string;
  /** An intro ask's note for the connector to forward: 3–4 sentences, written for the LP to read. */
  blurb?: string | null;
}

/** GUESSES (docs/email-guidelines.md): the aim is 80–150 words; past these a draft is refused. */
export const FIRST_MESSAGE_MAX_WORDS = 200;
export const BLURB_MAX_WORDS = 100;

export interface Strategy {
  key: string;
  /** Optional canonical identity when the file uses a research alias. */
  entityId?: string;
  candidateKey?: string;
  name: string;
  /**
   * `inputs` pins what it was written from (iteration 3; CLAUDE.md, Agent rules: run records pin
   * their inputs): the finding's `researched.at`, or null when there was none. A strategy whose LP
   * has a newer finding is stale, and the checker says so.
   */
  made: {
    /** The protocol version, "1.10" as a string since 1.10: the number 1.10 is 1.1 once parsed. */
    at: string; by: string; workflow: 'W5'; version: number | string;
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
  /** Optional until a W5 pass fills it; validated whenever present (`checkFirstMessage`). */
  firstMessage?: FirstMessage;
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/**
 * A protocol version as [major, minor] (N81). Written as a number up to 1.9 and as a string from
 * "1.10" on, because JSON reads 1.10 as 1.1: a W5 reader found every 1.10 strategy picked up again
 * as "older than 1.3". A number keeps its written digits ("1.7" is [1, 7]).
 */
export function versionOf(v: number | string | null | undefined): [number, number] {
  const [a, b] = String(v ?? '0').split('.');
  return [Number(a) || 0, Number(b ?? 0) || 0];
}

/** True when `v` comes before `than`: "1.10" is after 1.9, and 1.2 before 1.3. */
export function versionBefore(v: number | string | null | undefined, than: string): boolean {
  const [a1, b1] = versionOf(v);
  const [a2, b2] = versionOf(than);
  return a1 < a2 || (a1 === a2 && b1 < b2);
}

/** The import keeps what, who and when together in 400 characters (W5 v1.3); longer is cut, not refused. */
export const nextTooLong = (s: Pick<Strategy, 'next'>) => `${s.next.what} — ${s.next.who}, ${s.next.when ?? ''}`.length > 400;
/** W5 v1.5: one person, one action, a date — under 300 characters with who and when. */
export const nextOverLimit = (s: Pick<Strategy, 'next'>) => `${s.next.what} — ${s.next.who}, ${s.next.when ?? ''}`.length > 300;

/** The close track as a strategy pins it (W5 v1.5): "<track> <state> <amount>", or null. */
export const moneyKey = (m: { track: string; state: string; amount: number } | null | undefined) => (m ? `${m.track} ${m.state} ${m.amount}` : null);

type Tier = 'A' | 'B' | 'C' | 'D';
/**
 * The best tier per LP over every path, and over the paths that start from our side (the team, our organizations,
 * our backers), for the best-path pin (isStale). A path to another LP is proximity between two LPs.
 */
export function bestTiers(paths: Iterable<{ lp: string; tier: Tier; other: { type: string } }>): (lp: string) => Array<Tier | null> {
  const all = new Map<string, Tier>(), ours = new Map<string, Tier>();
  for (const p of paths) {
    if (!all.has(p.lp) || p.tier < all.get(p.lp)!) all.set(p.lp, p.tier);
    if (p.other.type !== 'lp' && (!ours.has(p.lp) || p.tier < ours.get(p.lp)!)) ours.set(p.lp, p.tier);
  }
  return (lp) => [all.get(lp) ?? null, ours.get(lp) ?? null];
}

/**
 * The newest team context that bears on a strategy for `vehicle` (a slug): a note about the LP as a
 * whole, or one written from that vehicle. A note written from another vehicle's pursuit is that
 * vehicle's: on 7 Oct a line added for SPV - Science marked every vehicle's strategy for the LP stale.
 * Without a vehicle, the newest note of any kind. Context is newest first.
 */
export function contextAtFor(context: Array<{ at: string; vehicle?: string | null }> | null | undefined, vehicle?: string | null): string | null {
  return (context ?? []).find((c) => !vehicle || !c.vehicle || c.vehicle === vehicle)?.at ?? null;
}

/**
 * Which strategies a correction to a finding can change (7 Oct 2026, counted on the Mac's 3,700 findings:
 * 2,466 correction entries, of which 1,209 were append-only SPV appetite passes, most adding no fact, and
 * 321 appended connector evidence). An append-only SPV pass bears only on SPV strategies, and not even
 * those when it added no fact; appended ties change W3's paths, which the best-path pin already watches.
 * Anything else — the W1c fact check above all, which cuts and moves facts — bears on every strategy.
 */
export function correctionReach(c: { by?: string | null; what?: string | null }): 'none' | 'spv' | 'all' {
  const by = c.by ?? '', what = c.what ?? '';
  if (/\bW1c\b/.test(by)) return 'all';
  // Connector research names itself in its round as often as in its words: "cold1-04", "cold1 batch 05", "evening e-2 connection-only".
  if (/connector evidence|connection-only|sourced ties added/i.test(what) || /\bcold\d|connection-only/i.test(by)) return 'none';
  if (/\bSPV\b/i.test(what) && /append-only|preserved/i.test(what)) return /\b(?:0|no) (?:new )?facts\b/i.test(what) ? 'none' : 'spv';
  return 'all';
}

/**
 * Written before its LP's current finding — from records alone, or from an older finding — or,
 * when it pinned the close track (v1.5), before that changed.
 */
export function isStale(
  s: Pick<Strategy, 'made'>,
  finding: { researched: { at: string; corrected?: Array<{ at: string; by?: string | null; what?: string | null }> } } | null | undefined,
  money?: { track: string; state: string; amount: number } | null,
  /**
   * The best tier on file, or the tiers the pin may match (bestPaths): over every path, and over the paths that start
   * from our side. 7 Oct 2026: a new C between two LPs (same employer, co-investors) moved "none" to C and staled
   * strategies whose route nothing had changed; a pin matching either still holds.
   */
  bestPath?: 'A' | 'B' | 'C' | 'D' | null | Array<'A' | 'B' | 'C' | 'D' | null>,
  /** The team's newest context on this LP (issue 0016): a strategy written before it is due a re-think. */
  contextAt?: string | null,
  /** The strategy's vehicle kind ('fund', 'spv', …); unknown counts an SPV-only correction (correctionReach). */
  vehicleKind?: string | null,
): boolean {
  if (contextAt && s.made.at && Date.parse(contextAt) > Date.parse(s.made.at)) return true;
  const pinned = s.made.inputs;
  if (pinned && 'money' in pinned && money !== undefined && (pinned.money ?? null) !== moneyKey(money)) return true;
  // The best path on file when it was written (v1.5, v01's learning): a route resting on a path W3
  // no longer finds needs rewriting.
  if (pinned && 'bestPath' in pinned && bestPath !== undefined && ![bestPath].flat().includes(pinned.bestPath ?? null)) return true;
  if (!finding) return false;
  // A correction made to the finding after the strategy was written — the fact check, a band sweep —
  // keeps `researched.at`, so the pin still matches while the strategy may repeat what was cut (W5
  // after the search pass).
  if (s.made.at && (finding.researched.corrected ?? []).some((c) => Date.parse(c.at) > Date.parse(s.made.at)
    && (correctionReach(c) === 'all' || (correctionReach(c) === 'spv' && (vehicleKind ?? 'spv') === 'spv')))) return true;
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
export const IN_US = /(?:^|[^a-z])u\.\s?s\.(?:\s?a\.?)?(?![a-z])|\b(united states|usa|puerto rico|guam|virgin islands|northern mariana islands|american samoa|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawai['ʻ’]?i|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|san francisco|los angeles|boston|chicago|seattle|miami|austin|denver|silicon valley|bay area|palo alto|menlo park|mountain view|sunnyvale|cupertino|san jose|santa clara|san mateo|redwood city|woodside|atherton|portola valley|los altos|los gatos|saratoga|burlingame|hillsborough|berkeley|oakland|sausalito|mill valley|tiburon|belvedere|san diego|la jolla|santa monica|malibu|beverly hills|pasadena|irvine|nyc|manhattan|brooklyn|greenwich|houston|dallas|atlanta|philadelphia|pittsburgh|nashville|phoenix|scottsdale|salt lake city|minneapolis|detroit|baltimore|raleigh|durham|boulder|aspen|jackson hole|palm beach|new orleans)\b/i;
/** "Palo Alto, CA": a state's postal code after a comma, upper case, for codes no other country's place is written with. */
const US_STATE_CODE = /,\s*(?:CA|NY|MA|WA|TX|FL|IL|NJ|CT|NC|VA|MD|GA|PA|AZ|UT|MN|MI|OH|NV|DC|TN|WY)\b/;
const inUs = (where: string) => IN_US.test(where) || US_STATE_CODE.test(where);
export const outsideUs = (where: string | null | undefined): boolean => Boolean(where?.trim()) && !inUs(where ?? '');
/**
 * Outside the US when some source places them and none places them in it (v13a1): a finding's short
 * "Palo Alto" beside our record's "Palo Alto, California, United States" is the US.
 */
export const placedOutsideUs = (places: Array<string | null | undefined>): boolean => {
  const said = places.filter((p): p is string => Boolean(p?.trim()));
  return said.length > 0 && !said.some((p) => inUs(p));
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
  c: {
    contact: { lastFromThem: string | null; meetings: number; groupMeetings: number }; money: unknown; notes?: Array<{ summary: string | null }>; location?: string | null;
    /** N81: each pursuit's own counted contact, when the export carries it. */
    pursuits?: Array<{ contact?: { lastFromThem: string | null; meetings: number } }>;
  } | undefined,
  finding: { profile?: { investorType?: string; capacity?: { band: string; basis?: string } }; identity?: { canonical?: { location?: string | null } | null }; facts?: Array<{ field: string; value: string }> } | null | undefined,
  bestTier: 'A' | 'B' | 'C' | 'D' | null,
  today = new Date(),
): string[] {
  const out: string[] = [];
  if (!c) return out;
  // "This year" rests on the pursuit's own contact (W5 1.10): a catch-up about something else is the
  // relationship, not evidence the raise is moving. The export before N81 carries only the LP's.
  const counted = (c.pursuits ?? []).map((p) => p.contact).filter((x): x is { lastFromThem: string | null; meetings: number } => Boolean(x));
  const lastFromThem = counted.length
    ? counted.map((x) => x.lastFromThem).filter((x): x is string => Boolean(x)).sort().pop() ?? null
    : c.contact.lastFromThem;
  const recent = lastFromThem && today.getTime() - new Date(lastFromThem).getTime() <= 90 * 86_400_000;
  const oneToOne = counted.length ? counted.some((x) => x.meetings > 0) : c.contact.meetings > c.contact.groupMeetings;
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
  const band = s.scores?.capacity?.band ?? 'unknown';
  // Or a band by rule (W5 1.9, Juan 24 Sep): read off the size table, or the floor from many angel
  // checks — held to the rule, so a band that says "by size" and isn't the table's is caught.
  const byRule = bandByRule(band, s.scores?.capacity?.basis ?? '');
  if (byRule && !byRule.holds) {
    out.push(byRule.rule === 'size' ? `capacity off the size table${byRule.want ? ` (it gives ${byRule.want})` : ''}` : 'a floor without the angel checks behind it');
  }
  const evidenced = Boolean((fb && fb.band !== 'unknown' && hasCapacityEvidence(fb.basis ?? '') && !managersMoney) || fromNotes || fromFacts || byRule?.holds);
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
  if (x.firstMessage !== undefined && x.firstMessage !== null) p.push(...checkFirstMessage(x));
  return p;
}

/** The vehicle kind an ask names, for the one-vehicle check: an SPV, a fund, or not known. */
export function askVehicleKind(ask: Partial<Strategy['ask']> | undefined): 'fund' | 'spv' | null {
  if (!ask) return null;
  if (ask.shape === 'SPV' || /\bspv\b/i.test(ask.vehicle ?? '')) return 'spv';
  if (/fund|neurotech|crypto|rails/i.test(ask.vehicle ?? '')) return 'fund';
  return null;
}

/**
 * The first message against docs/email-guidelines.md: the right recipient and sender for the kind,
 * the greeting to that recipient, no analysis or private detail in the words, one vehicle, and the
 * length. Each problem starts "firstMessage".
 */
export function checkFirstMessage(x: Partial<Strategy>): string[] {
  const p: string[] = [];
  const m = x.firstMessage as Partial<FirstMessage> | undefined;
  if (!m || typeof m !== 'object') return ['firstMessage must be an object'];
  if (!EMAIL_KINDS.includes(m.kind as EmailKind)) p.push(`firstMessage.kind must be one of ${EMAIL_KINDS.join(', ')}`);
  if (!isStr(m.from)) p.push('firstMessage needs from, the team member who sends it');
  if (!m.to || !isStr(m.to.name)) p.push('firstMessage needs to.name');
  if (!isStr(m.subject)) p.push('firstMessage needs a subject');
  else if (m.subject.length > 90) p.push('firstMessage.subject is over 90 characters');
  if (!isStr(m.body)) { p.push('firstMessage needs a body'); return p; }
  const lpName = x.name ?? null;
  const toLp = Boolean(m.to?.key && (m.to.key === x.key || m.to.key === x.entityId));
  // Who it goes to, by kind: an intro ask goes to the connector, never the LP; the others to the LP.
  if (m.kind === 'intro_ask') {
    if (toLp || (m.to?.name && lpName && m.to.name.trim().toLowerCase() === lpName.trim().toLowerCase())) p.push('firstMessage: an intro ask goes to the connector, not the LP');
    if (!x.route) p.push('firstMessage: an intro ask needs a route through someone');
    if (!isStr(m.blurb)) p.push('firstMessage: an intro ask needs a blurb the connector can forward');
    else {
      const n = sentenceCount(m.blurb);
      if (n < 2 || n > 5) p.push(`firstMessage.blurb has ${n} sentences; write 3–4`);
      if (wordCount(m.blurb) > BLURB_MAX_WORDS) p.push(`firstMessage.blurb is over ${BLURB_MAX_WORDS} words`);
    }
  } else if (m.to?.key && !toLp) p.push('firstMessage: this kind goes to the LP, but to.key is someone else');
  // A route through someone means the first email is the intro ask (or comes after it), not a cold note.
  if (m.kind === 'cold' && x.route && (x.route.tier === 'A' || x.route.tier === 'B')) p.push(`firstMessage: a cold note while the route goes through ${x.route.via} (tier ${x.route.tier}); write the intro ask, or the message after it`);
  if (m.kind === 'after_intro' && !x.route) p.push('firstMessage: after_intro needs the route it follows');
  // The greeting addresses the recipient: an intro ask addressed to the LP is a cold note in disguise.
  const hi = greeted(m.body);
  if (hi && m.to?.name && !m.to.name.toLowerCase().split(/[\s,]+/).includes(hi.toLowerCase())) p.push(`firstMessage greets ${hi}, but goes to ${m.to.name}`);
  const kind = askVehicleKind(x.ask);
  const vehicle = kind ? { name: x.ask?.vehicle ?? '', kind } : null;
  const lint = (text: string, recipient: { name: string | null; isPerson: boolean } | null, maxWords: number) =>
    lintEmail(text, { recipient, vehicle, maxWords }).map((i) => `${i.text}${i.match ? ` (“${i.match}”)` : ''}`);
  // The body talks to its recipient; an intro ask's body talks about the LP to the connector, which is fine.
  const bodyTo = m.kind === 'intro_ask' ? null : { name: m.to?.name ?? lpName, isPerson: m.to?.isPerson ?? true };
  for (const t of lint(m.body, bodyTo, FIRST_MESSAGE_MAX_WORDS)) p.push(`firstMessage.body: ${t}`);
  if (isStr(m.blurb)) for (const t of lint(m.blurb, { name: lpName, isPerson: m.to?.isPerson ?? true }, BLURB_MAX_WORDS)) p.push(`firstMessage.blurb: ${t}`);
  for (const t of lint(m.subject ?? '', null, 30)) p.push(`firstMessage.subject: ${t}`);
  return p;
}
