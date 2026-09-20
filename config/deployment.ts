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
];
