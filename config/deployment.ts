/**
 * Every deferred decision lives here. One file.
 *
 * Rule from CLAUDE.md: a constant marked GUESS came from an unverified source and should
 * not survive two weeks of real data. Do not scatter these values through the codebase —
 * import `config`, never re-declare a number.
 */

export type AffinityTier = 'scale' | 'advanced' | 'enterprise' | null;
export type AffinitySyncMode = 'deferred' | 'poll' | 'dataShare';
export type CanonMode = 'inProcess' | 'warehouse';
export type IssueProvider = 'file' | 'linear' | 'github';
export type AuthKind = 'local' | 'labos';
export type DataProfile = 'demo' | 'real';

/**
 * Which data this process serves (N38). One environment variable, read here and nowhere
 * else.
 *
 * `demo` is fictional. It can be reset, screenshotted and published. `real` is the replica of
 * Affinity and everything we write about it, and none of it leaves `data/real/`: not into git,
 * not into the build log, not onto the office network (docs/15).
 *
 * A typo fails loudly rather than falling back, so `DATA_PROFILE=rael` cannot show the demo
 * to somebody who believes they are looking at the raise.
 */
function dataProfile(): DataProfile {
  const v = process.env.DATA_PROFILE;
  if (v === undefined || v === '' || v === 'demo') return 'demo';
  if (v === 'real') return 'real';
  throw new Error(`DATA_PROFILE must be "demo" or "real", not "${v}".`);
}
const PROFILE = dataProfile();

/**
 * The real profile is this machine only until a deployment is chosen, so a connection string
 * pointing somewhere else is refused rather than quietly obeyed.
 */
function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL ?? null;
  if (url && PROFILE === 'real') {
    throw new Error('DATABASE_URL is set in the real profile. Real data stays in data/real/ until deployment is decided (docs/15).');
  }
  return url;
}

export const config = {
  /**
   * What the tool is called on screen (issue 0019). "Capital OS" stays as the codename — in
   * the code, the docs, the design history and the storage keys, which cannot be renamed
   * without signing everybody out and resetting their preferences. This is the name people
   * see, and going back to the old one is this block.
   */
  product: {
    name: 'PLC Raise Tools',
    /** The letter in the square. */
    mark: 'P',
    /** For labels on things that leave the system, like a Linear ticket. */
    slug: 'plc-raise-tools',
    codename: 'Capital OS',
  },
  data: {
    profile: PROFILE,
    /** Everything this profile keeps on disk is under here, and git ignores all of it. */
    root: `data/${PROFILE}`,
    /**
     * Cookies belong to a host, not a port, so the two servers would share who you are and
     * which vehicle you had open. Local storage is per port already.
     */
    cookiePrefix: PROFILE === 'real' ? 'capitalos_real_' : 'capitalos_',
  },
  affinity: {
    /**
     * Juan doesn't know the tier (22 Sep). Developer → Affinity → Test the connection reads
     * it from the account's own limits; set it here once that has answered.
     */
    tier: null as AffinityTier,
    syncMode: 'deferred' as AffinitySyncMode,
    /** Read-only, enforced by the client (docs/15). Writing back is a later decision. */
    readOnly: true,
    /** Our own ceiling per rolling minute. Affinity allows 900 per user; we need nowhere near it. */
    maxPerMinute: 300, // GUESS
    /**
     * The monthly quota belongs to the whole account and every other integration on it, so
     * this tool takes a share of it and no more.
     */
    monthlyShare: 0.25, // GUESS
    /** Below this fraction of the account's month, stop asking altogether. */
    monthlyFloor: 0.1, // GUESS
    /**
     * The most one slice may spend on per-entity reads (notes, relationships) before a person
     * has seen the estimate. Over it, the run holds and waits for a go-ahead (N42). The demo's
     * fake Affinity is tiny, so its ceiling is too — otherwise the hold would never be seen.
     */
    sliceCeiling: PROFILE === 'demo' ? 10 : 3000, // GUESS (the real one)
  },
  warehouse: {
    enabled: false,
    canonMode: 'inProcess' as CanonMode,
  },
  issues: {
    provider: 'file' as IssueProvider,
    /**
     * Demo feedback is part of the repository, so the complaint and its fix travel in one
     * pull request. Feedback filed while looking at real data can quote it, or carry a
     * screenshot of it, so it stays with the data instead.
     */
    dir: PROFILE === 'real' ? 'data/real/issues' : 'issues',
  },
  auth: {
    provider: 'local' as AuthKind,
  },
  guard: {
    asksPerRelationshipPerQuarter: 1,
    asksPerConnectorPerQuarter: 3, // GUESS — v3 gave a 1–5 range and labelled it unverified.
    conflictWindowDays: 14, // GUESS — v3's default, never tested against our own calendar.
  },
  scoring: {
    weights: { capacity: 0.25, affinity: 0.3, propensity: 0.25, timeToDecision: 0.2 },
  },
  agents: {
    correctionBudgetHoursPerWeek: 12, // GUESS — v3 said 10–15 h/week; circuit-breaker threshold.
  },
  /** Their read (N57, docs/18): past this age a read is shown as old, still counted, dated. */
  reads: {
    staleAfterDays: 180, // GUESS — half a year; nobody has measured how fast an LP's read goes stale.
  },

  /**
   * Capacity from size (W1 1.49, W5 1.9). Juan, 24 Sep, asked whether an office's totals may set a
   * band: "it likely can set an informed capacity limit for us to make an educated guess. I would
   * guess based on what similar entities with similar sizes tend to do in terms of check sizes. ofc
   * it will vary, but it's a well informed guess." So a band may be read off this table: one typical
   * commitment to one venture fund, by the kind of investor and the size of the unit that commits —
   * each step's upper bound in dollars. Every band is a GUESS from general practice, not from our
   * own closes, and none should survive two weeks of real commitments.
   */
  capacity: {
    bySize: {
      /** A family office's or principal's investable assets. */
      family_office: [[100e6, '<$250K'], [500e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A foundation's or endowment's assets. */
      foundation: [[250e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A wealth manager, multi-family office or adviser that places clients' money in funds: its assets under management. */
      wealth_manager: [[1e9, '$250K–1M'], [10e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A fund of funds or a fund's LP programme: the fund's size. */
      fund_of_funds: [[100e6, '$1–5M'], [500e6, '$1–5M'], [Infinity, '$5–25M']],
      /** A person's net worth. */
      individual: [[25e6, '<$250K'], [100e6, '$250K–1M'], [1e9, '$1–5M'], [Infinity, '$5–25M']],
    } as Record<string, Array<[number, string]>>,
    /**
     * Juan, 24 Sep, on angel checks whose sizes aren't known: "many angel checks probably means at
     * least capacity in the 100K-250K range? maybe more? unsure." A floor, not a band.
     */
    angelFloor: { checks: 5, band: '$100K+ (floor)' }, // GUESS — "many" read as five or more; the floor is Juan's own guess.
  },

  /**
   * L10. A signal is a change that crossed a threshold; everything else is noise. These
   * are the thresholds, and every one of them is a judgement rather than a measurement.
   */
  signals: {
    /** Below this, a public statement is chatter rather than a signal. */
    minConfidence: 'medium' as 'high' | 'medium' | 'low', // GUESS
    /** A signal older than this is history, and stops appearing in the daily queue. */
    freshDays: 21, // GUESS
    /** Personnel changes matter most when they touch the person who decides. */
    decisionMakerOnly: true, // GUESS
  },

  /**
   * L9. Where the rubric bands are cut. Judgement, not measurement.
   */
  scoringBands: {
    strong: 0.7, // GUESS
    worthALook: 0.45, // GUESS
  },

  /**
   * L4. How a warm-introduction route is weighted for influence, once it has passed the
   * safety rules. Every one of these is judgement — there are no outcomes behind them —
   * and they are here rather than in the scorer so that arguing with them is a config
   * change and not a code change.
   */
  routeInfluence: {
    withUs: 0.28,     // GUESS — skin in the game: an LP asking carries more than an acquaintance
    withTarget: 0.30, // GUESS — standing with *this* target, which is the scarce thing
    topic: 0.18,      // GUESS — credibility does not transfer between domains (Report 6 §2)
    tie: 0.14,        // GUESS — tie strength, on an inverted U
    willing: 0.10,    // GUESS — goodwill left, and whether they have delivered before
  },

  /** L7. How much of a week has to be lost before it stops counting as a working week. */
  calendarDeadWeekDays: 3, // GUESS

  /**
   * Added during L1. Both are deployment facts rather than domain guesses.
   */
  db: {
    /**
     * PGlite data directory when DATABASE_URL is unset. PGLITE_DIR is how the property
     * harness points at a scratch copy; the real profile ignores it, so its data cannot be
     * redirected out of data/real/.
     */
    localDir: PROFILE === 'real' ? './data/real/database' : (process.env.PGLITE_DIR ?? './data/demo/database'),
    /** Set DATABASE_URL and the Db seam resolves to node-postgres instead. */
    url: databaseUrl(),
  },
  agentRuntime: {
    /** No key present → the Agent seam is a no-op that refuses rather than guesses. */
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
  },
} as const;

export type DeploymentConfig = typeof config;

/**
 * The constants above that are explicitly guesses, so the UI can say so out loud
 * instead of rendering an estimate as a fact.
 */
export const GUESSED_CONSTANTS: ReadonlyArray<{ path: string; value: number; why: string }> = [
  {
    path: 'guard.asksPerConnectorPerQuarter',
    value: config.guard.asksPerConnectorPerQuarter,
    why: 'v3 gave a 1–5 range and labelled it [Analysis]. Replace with our own connector data.',
  },
  {
    path: 'guard.conflictWindowDays',
    value: config.guard.conflictWindowDays,
    why: 'v3 default. Never checked against how long our own asks actually take to resolve.',
  },
  {
    path: 'agents.correctionBudgetHoursPerWeek',
    value: config.agents.correctionBudgetHoursPerWeek,
    why: 'v3 said 10–15 h/week, unverified. Circuit-breaker threshold for agent autonomy.',
  },
  {
    path: 'guard.asksPerRelationshipPerQuarter',
    value: config.guard.asksPerRelationshipPerQuarter,
    why:
      'Comes from the same unverified v3 analysis as the two above and was not labelled in ' +
      'CLAUDE.md. Also under-specified: one ask per relationship per quarter across ALL FOUR ' +
      'vehicles makes the conflict case nearly redundant, because every collision also trips ' +
      'this cap. It is probably meant per vehicle.',
  },
  {
    path: 'routeInfluence.withTarget',
    value: config.routeInfluence.withTarget,
    why: 'The heaviest route-influence weight. Report 6 says standing with the specific target is what matters; how much more than the others is my judgement.',
  },
  {
    path: 'routeInfluence.topic',
    value: config.routeInfluence.topic,
    why: 'How much a domain mismatch should cost a route. The direction is from Report 6; the size is a guess.',
  },
  {
    path: 'scoringBands.strong',
    value: config.scoringBands.strong,
    why: 'Where the selection rubric calls a target strong. Judgement, with no outcomes behind it yet.',
  },
  {
    path: 'scoringBands.worthALook',
    value: config.scoringBands.worthALook,
    why: 'The lower rubric band. Same provenance: none.',
  },
  {
    path: 'calendarDeadWeekDays',
    value: config.calendarDeadWeekDays,
    why: 'Working days a week must lose before it stops counting as a working week. My judgement while building L7.',
  },
  {
    path: 'affinity.monthlyShare',
    value: config.affinity.monthlyShare,
    why: 'How much of the Affinity account’s monthly requests this tool may use. Nobody has said what else draws on that quota.',
  },
  {
    path: 'affinity.monthlyFloor',
    value: config.affinity.monthlyFloor,
    why: 'The share of the account’s month kept untouched for everything else that uses Affinity. My judgement.',
  },
  {
    path: 'affinity.sliceCeiling',
    value: config.affinity.sliceCeiling,
    why: 'Requests one slice may spend on notes and relationships without someone approving the estimate first. A round number under this tool’s monthly share.',
  },
  {
    path: 'affinity.maxPerMinute',
    value: config.affinity.maxPerMinute,
    why: 'Our own pace, a third of Affinity’s published 900 per user per minute. Chosen to be polite, not measured.',
  },
  {
    path: 'signals.freshDays',
    value: config.signals.freshDays,
    why: 'After this a signal is history rather than something to act on. Never measured.',
  },
];
