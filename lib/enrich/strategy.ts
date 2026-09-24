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
  made: { at: string; by: string; workflow: 'W5'; version: number; inputs?: { finding: string | null; money?: string | null } };
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
  next: { what: string; who: string; when: string; material?: string | null };
  /** `co-invest` (W5 v1.3): a fund in our field that backs our portfolio companies — a co-investor, not an LP. */
  ask: { vehicle: string; shape: 'fund commitment' | 'SPV' | 're-up or upsize' | 'intro to others' | 'advice' | 'verify first' | 'firm-level ask' | 'co-invest' | 'none yet'; range?: string | null };
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
  finding: { researched: { at: string } } | null | undefined,
  money?: { track: string; state: string; amount: number } | null,
): boolean {
  const pinned = s.made.inputs;
  if (pinned && 'money' in pinned && money !== undefined && (pinned.money ?? null) !== moneyKey(money)) return true;
  if (!finding) return false;
  if (pinned?.finding !== undefined) return pinned.finding !== finding.researched.at;
  return new Date(finding.researched.at).getTime() > new Date(s.made.at).getTime();
}

/**
 * The critic's evidence gates (W5 v1.5), as warnings: what a strategy claims beyond what the files
 * show. "This year" needs a word from them in the last 90 days, money on the close track, or a
 * meeting that wasn't a group date; a capacity band needs the finding's estimate or money on file;
 * a route can't be better than the best path W3 found for the LP.
 */
export function gates(
  s: Pick<Strategy, 'list' | 'scores' | 'route'>,
  c: { contact: { lastFromThem: string | null; meetings: number; groupMeetings: number }; money: unknown } | undefined,
  finding: { profile?: { capacity?: { band: string } } } | null | undefined,
  bestTier: 'A' | 'B' | 'C' | 'D' | null,
  today = new Date(),
): string[] {
  const out: string[] = [];
  if (!c) return out;
  const recent = c.contact.lastFromThem && today.getTime() - new Date(c.contact.lastFromThem).getTime() <= 90 * 86_400_000;
  const oneToOne = c.contact.meetings > c.contact.groupMeetings;
  if (s.list === 'this year' && !recent && !c.money && !oneToOne) out.push('this year, without the evidence gate');
  const band = s.scores?.capacity?.band ?? 'unknown';
  if (!/unknown|not known/i.test(band) && (finding?.profile?.capacity?.band ?? 'unknown') === 'unknown' && !c.money) out.push('capacity ahead of the evidence');
  const rank = { A: 0, B: 1, C: 2, D: 3 } as const;
  if (s.route && (bestTier === null || rank[s.route.tier] < rank[bestTier])) out.push('route better than the best path on file');
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
  if (x.next && /\b(send|email|message|post)\b.*\b(now|automatically)\b/i.test(x.next.what)) p.push('next reads as an automatic send');
  if (!x.ask || !isStr(x.ask.vehicle)) p.push('ask needs a vehicle');
  if (!['this year', '2027', 'not now'].includes(x.list ?? '')) p.push('list must be this year, 2027 or not now');
  if (x.route && !['A', 'B', 'C', 'D'].includes(x.route.tier)) p.push('route tier must be A–D');
  return p;
}
