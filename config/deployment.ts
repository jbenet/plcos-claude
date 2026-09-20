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

export const config = {
  affinity: {
    tier: null as AffinityTier,
    syncMode: 'deferred' as AffinitySyncMode,
  },
  warehouse: {
    enabled: false,
    canonMode: 'inProcess' as CanonMode,
  },
  issues: {
    provider: 'file' as IssueProvider,
    dir: 'issues',
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

  /** L7. How much of a week has to be lost before it stops counting as a working week. */
  calendarDeadWeekDays: 3, // GUESS

  /**
   * Added during L1. Both are deployment facts rather than domain guesses.
   */
  db: {
    /** PGlite data directory when DATABASE_URL is unset. */
    localDir: process.env.PGLITE_DIR ?? './local/capital',
    /** Set DATABASE_URL and the Db seam resolves to node-postgres instead. */
    url: process.env.DATABASE_URL ?? null,
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
    path: 'signals.freshDays',
    value: config.signals.freshDays,
    why: 'After this a signal is history rather than something to act on. Never measured.',
  },
];
