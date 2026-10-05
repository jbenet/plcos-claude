import { signInKind, signInProviderOn, type SignInKind } from './sign-in';

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
export type AuthKind = SignInKind;
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
 * The port this server answers on. The launcher sets PORT (scripts/serve.ts) and Next sets it once
 * it listens; a script serves nothing and has none. Digits only, since it goes into cookie names.
 */
const PORT = process.env.PORT?.replace(/\D/g, '') || null;

/**
 * A preview (npm run preview, docs/COLLAB.md): the real profile served in a dev worktree from a
 * copy of the real data, taken at this time. The launcher sets it; the breadcrumb bar shows it,
 * and the Affinity key is never read while it is set. A bad value fails loudly, like a bad profile.
 */
function copyTakenAt(): string | null {
  const v = process.env.PREVIEW_COPY_AT?.trim();
  if (!v || PROFILE !== 'real') return null;
  if (Number.isNaN(Date.parse(v))) throw new Error(`PREVIEW_COPY_AT must be the time the copy was taken, not "${v}".`);
  return v;
}

/**
 * On the Mac the real profile is this machine only, so a connection string pointing somewhere else
 * is refused rather than quietly obeyed. A deployed server with its own sign-in (LabOS, rev 3; or
 * Google on Railway, docs/deploy/railway.md §3) uses the database it was given, over TLS verified by
 * lib/db/postgres.ts.
 */
function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim() || null;
  if (process.env.POSTGRES_REHEARSAL === '1' && !url) throw new Error('Postgres rehearsal requires DATABASE_URL.');
  if (url && PROFILE === 'real' && !signInProviderOn()) {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.search || parsed.hash) {
      throw new Error('DATABASE_URL is set in the real profile: only local Postgres is approved (docs/21-postgres.md).');
    }
  }
  return url;
}

export const config = {
  identity: { compactSeparationThreshold: 25 }, // GUESS: compact proven all-different candidate groups above this size.
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
    port: PORT,
    /** When this server's copy of the real data was taken; null unless it is a preview. */
    copyTakenAt: copyTakenAt(),
    /**
     * Cookies belong to a host, not a port, so every server on this machine — live, preview and
     * demo, and Juan's iPad reaching any of them by IP — would share who you are and which
     * vehicle you had open. The name carries the port. Local storage is per port already.
     */
    cookiePrefix: `${PROFILE === 'real' ? 'capitalos_real_' : 'capitalos_'}${PORT ? `${PORT}_` : ''}`,
  },
  responsiveness: {
    resolutionMs: 10, // GUESS — enough resolution to detect the 50 ms synchronous-slice target.
    reportIntervalMs: 60_000, // GUESS — one small local activity record per minute.
    alertP99Ms: 200, // Requested responsiveness budget; histogram lag is not HTTP request latency.
  },
  activity: {
    bytesPerToken: 4, // GUESS — token usage is a payload-size estimate, never measured network bytes.
    legacyMatchWindowMs: 60_000, // GUESS — legacy Dakota manifests were written immediately before ledger finish.
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
  /**
   * Linear, read-only (Juan, 27 Sep 2026; docs/24-linear.md). The client sends GraphQL queries
   * from its own allowlist and refuses any mutation. Linear allows 2,500 requests and 3,000,000
   * complexity points an hour for a personal key (read from its headers, 27 Sep); a full sync of
   * the workspace took about forty requests.
   */
  linear: {
    /** Only these Linear team keys may be requested or retained. */
    teams: ['PLC'] as string[],
    readOnly: true,
    pageSize: 100, // GUESS — Linear allows up to 250 a page; 100 keeps each answer's complexity small.
    minIntervalMs: 200, // GUESS — polite spacing; the hourly budget is the binding limit.
    /** Stop and wait for the reset when fewer than this many requests are left in the hour. */
    minRequestsLeft: 100, // GUESS
    /** The same for complexity points. */
    minComplexityLeft: 50_000, // GUESS
    /** A wait longer than this fails the sync instead of holding a job open. */
    maxWaitMs: 120_000, // GUESS
    /** An incremental sync asks for changes since the last complete one, less this overlap. */
    overlapMs: 10 * 60_000, // GUESS — covers clock skew and edits made while the last pull ran.
    /** Records written per database transaction during translation. */
    translateBatch: 200, // GUESS — same bound as Dakota's.
  },
  /**
   * Email drafts moved into each person's own Gmail (Juan, 2 Oct 2026; docs/25-email-drafts.md), through
   * mailguard since 3 Oct 2026 (docs/25 §12): each person's key reaches only their own mailbox, and only
   * a drafts-only key is accepted. Nothing sends. The demo always uses the fake mailguard in
   * lib/connectors/mailguard/fake.ts.
   */
  email: {
    provider: 'mailguard' as 'mailguard' | 'off',
    mailguard: {
      /** Mailguard's origin, e.g. https://mail.example.com. An address in the live server’s environment wins (scripts/with-mailguard-token.sh). */
      url: null as string | null,
      /** Whose key the Keychain item plcos-claude / mailguard-token is. A key pasted in Preferences wins over it. */
      keychainTokenFor: 'juan',
    },
    /** Each file or picture. GUESS: a deck or a one-pager is a few MB. */
    maxAttachmentBytes: 10 * 1024 * 1024,
    /** All of a draft's files together. GUESS: Gmail's limit is 25 MB a message, and base64 adds a third. */
    maxTotalBytes: 18 * 1024 * 1024,
    maxAttachments: 10, // GUESS
    /** Bytes by hash, outside the database and git. S3 later. */
    attachmentsDir: `data/${PROFILE}/email/attachments`,
  },
  /**
   * MCP access (docs/26-mcp.md): /api/mcp, authenticated by a per-person token made in Preferences.
   * Read tools and draft-only write tools; nothing sends, accepts or moves money.
   */
  mcp: {
    enabled: true as boolean,
    callsPerMinute: 60, // GUESS — a chatty agent session; a loop over every LP trips it.
    defaultCallsPerDay: 2000, // GUESS — a working day of agent reads, per token.
    maxCallsPerDay: 20000, // GUESS — the most a person may grant one token.
    tokenDays: 90, // GUESS — a quarter, then make a new one.
    maxRequestBytes: 256 * 1024, // GUESS — a draft's text is ~20 KB; nothing needs more.
    maxResponseBytes: 60_000, // GUESS — ~15K tokens of an agent's context per call.
    maxRows: 100, // GUESS — rows in one list answer before paging.
  },
  /**
   * Cloud pull and push through the app's own API (docs/deploy/railway.md §6–§7; Juan, 4 Oct 2026: no
   * public database port). A snapshot is pg_dump of this server's own database, one at a time; a push is
   * one finished W1, W1c or W5 output, validated by the importer's own checks.
   */
  sync: {
    maxPushBytes: 20 * 1024 * 1024, // GUESS — a finding is 10–30 KB; a 200-LP batch fits with room.
    maxPushFiles: 500, // GUESS — the largest batch a worker writes, with its review file.
  },
  /**
   * Workflows the app runs itself (docs/28-cloud-workflows.md). Off unless an Admin turns on
   * Settings → Connections → "Cloud workflows"; these are the bounds of one run, written into its envelope.
   */
  cloudWorkflows: {
    w1c: {
      model: 'claude-haiku-4-5', // The fact-checker agent's model (.claude/agents/fact-checker.md): the check is mechanical.
      maxFindings: 25, // GUESS — one batch; the Mac's fact-checker took 20–30 findings a part.
      maxTokens: 600_000, // GUESS — about 20K input a finding (facts plus excerpts of its pages) with room.
      maxSeconds: 1800, // GUESS — 30 minutes; pages are read one at a time.
      maxOutputTokensPerFinding: 4000, // GUESS — a review row is 1–2K tokens of JSON.
    },
    pages: {
      maxBytes: 3 * 1024 * 1024, // GUESS — a long firm page is under 1 MB of HTML.
      maxChars: 40_000, // GUESS — the page text given to the model, per page.
      timeoutMs: 20_000,
      maxRedirects: 3,
      secIntervalMs: 1100, // SEC's fair-access policy: at most one request a second from us (W1 1.48).
      hostIntervalMs: 500, // GUESS — no bursts at any one site.
    },
  },
  /**
   * The outreach API for the mail desk (docs/27-outreach-api.md): /api/outreach/*, authenticated by an MCP
   * token that carries the outreach scope ('outreach:read', and 'outreach:write' apart). Same envelope, rate
   * limits and audit as MCP. Nothing here sends: the desk sends through MailGuard and records the send
   * against an approved SEND ticket.
   */
  outreach: {
    enabled: true as boolean,
    /**
     * Browser origins allowed to call the API across sites (CORS). Empty: none — a device app or a server
     * sends no Origin and needs no entry. Exact origins only ("https://desk.example.com"), never a wildcard.
     * A browser client also needs a short-lived token, not a device token (docs/27 §6); it is not built.
     */
    corsOrigins: [] as string[],
    /** Rows in a queue answer when the call names no limit (docs/27 §4). GUESS — a page a person reads at once. */
    defaultQueueRows: 25,
    /** The most rows one queue answer may ask for; page with nextCursor past it. GUESS — juanmail asked for 500 (5 Oct 2026). */
    maxQueueRows: 500,
    /** How long top_connectors plans routes before it answers with what it inspected (rule 7). GUESS. */
    connectorsBudgetMs: 15_000,
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
    dir: PROFILE === 'real' || signInProviderOn() ? `data/${PROFILE}/issues` : 'issues',
  },
  auth: {
    /** config/sign-in.ts: labos with LABOS_ME_URL, google on a deployed server, local on the Mac. */
    provider: signInKind() as AuthKind,
    /** How long a Google sign-in lasts, unless Settings → Connections says otherwise. */
    sessionDays: 30, // GUESS — MailGuard's default; a month between sign-ins.
    /** The OAuth state cookie's life: the round trip to Google's consent screen. */
    stateSeconds: 600,
    /** Re-read the stored settings this often, so another process's change arrives. */
    settingsTtlMs: 30_000, // GUESS — short enough that a Replace is felt at once, long enough to cost nothing.
  },
  guard: {
    /**
     * Juan, 4 Oct 2026 (the mail desk): the cap "may be too small; raise it or don't enforce it until it's
     * needed". 'advisory' reports it, without blocking an ask or a send; 'enforce' blocks as before.
     * TODO(docs/27 §4): if it comes back as a block, count per vehicle (an SPV invite and a fund ask to the
     * same person are different asks), not across every vehicle as asksToEntitySince does now.
     */
    askLimit: 'advisory' as 'advisory' | 'enforce',
    /**
     * Fund before SPV (Juan, 4 Oct 2026: "we have to pitch SPVs as we go"): an open fund discussion with an
     * LP is flagged when an SPV is pitched to them, and never holds the SPV. The overlap is still recorded,
     * with a dated follow-up (rule 5).
     */
    fundFirst: 'advisory' as 'advisory' | 'enforce',
    asksPerRelationshipPerQuarter: 1,
    asksPerConnectorPerQuarter: 3, // GUESS — v3 gave a 1–5 range and labelled it unverified.
    conflictWindowDays: 14, // GUESS — v3's default, never tested against our own calendar.
  },
  scoring: {
    weights: { capacity: 0.25, affinity: 0.3, propensity: 0.25, timeToDecision: 0.2 },
  },
  strategyRanking: {
    actionTeamHours: 2, // GUESS — preparation and review for one LP action; not elapsed decision time.
    actionValueFraction: 0.1, // GUESS — marginal share of modeled LP value unlocked by one action.
    // GUESS — planning estimates, never calibrated commitment probabilities.
    likelihood: { high: 0.6, medium: 0.3, low: 0.1 },
    decisionDays: { weeks: 21, '1–2 months': 45, 'a quarter or more': 120 },
    routeWeight: { A: 1, B: 0.8, C: 0.45, D: 0.2 },
    stalledDays: 21, // GUESS — inactivity warning, not evidence of a decline.
    staleDays: 30, // GUESS — refresh strategy and route evidence after this age.
    // GUESS — separate points for evidence work when a monetary score is unavailable.
    evidenceWork: { restriction: 100, overdue: 40, soft: 30, staleStrategy: 20, staleRoute: 15, noOwner: 10, missingResearch: 5, missingStrategy: 5 },
    conversionPriorWeight: 5, // GUESS — damp sparse observed transitions with a neutral prior.
    // Issue 0097: options rank by utility created = capital + presence × this. GUESS — the
    // capital-equivalent of one point (of 5) of lasting presence: how LPs see us in later calls and
    // the next vehicle. Not this raise's capital, and never added to it in a headline.
    presencePointValue: 10000,
    introBatch: 20, // GUESS — introductions or replies one team can chase in a week (0097's "10–20").
    // GUESS — presence (0–5) of a move that has no estimate of its own, by kind of work.
    presenceDefaults: { presence: 3, events: 2, materials: 1, conversion: 0, sourcing: 0, other: 0 },
  },
  agents: {
    correctionBudgetHoursPerWeek: 12, // GUESS — v3 said 10–15 h/week; circuit-breaker threshold.
  },
  dakota: {
    translationBatchRecords: 200, // GUESS — hard maximum source rows per transaction.
    translationBatchWorkMs: 100, // GUESS — yield the connection sooner when per-record work grows.
    perVehicleCap: 150, // GUESS — maximum rule-sourced candidates per vehicle, including prior passes.
    minimumTicketUsd: 500_000, // Juan's sourcing rule, 27 Sep 2026.
    claimConfidence: 'medium', // GUESS — vendor claim, tier C, never verified evidence.
    identityConfidence: 0.8, // GUESS — corroborated identifier match.
    possibleConfidence: 0.25, // GUESS — a name alone never merges.
    fitWeights: { topic: 2, flag: 1 }, // GUESS — transparent relative ranking, not a probability.
    theses: {
      neurotech: ['venture', 'healthcare', 'health care', 'life sciences', 'neurotech', 'deep tech'],
      rails: ['cryptocurrency', 'crypto', 'digital assets', 'fintech', 'blockchain'],
      'prime-intellect': ['artificial intelligence', 'ai'],
      'persona-ai': ['robotics', 'artificial intelligence', 'ai'],
      netholabs: ['neurotech', 'neuroscience'],
    } as Record<string, string[]>,
  },
  /**
   * Strategic value (issue 0120): the words that tie research text to a vehicle's field. The first
   * entry whose `match` is in the vehicle's slug or name applies; an SPV also matches its company's
   * name, read from the vehicle's name. Every list is a GUESS from the vehicles' public descriptions,
   * not from what has proved useful; `*` lets a word run on (neuro* is neuroscience, neurotech). Words
   * that also mean something else ("neural" in AI, "health") are left out on purpose.
   */
  strategic: {
    domains: [
      { match: ['netho'], label: 'neurotech', terms: ['neuro*', 'brain', 'bci', 'brain-computer', 'connectom*', 'whole-brain', 'neuromodulation'] },
      { match: ['prime intellect'], label: 'AI and compute', terms: ['artificial intelligence', 'ai', 'machine learning', 'llm*', 'gpu*', 'compute', 'deep learning'] },
      { match: ['persona'], label: 'robotics', terms: ['robot*', 'humanoid*', 'automation', 'manufactur*'] },
      // Demo: SPV — Cortex is an invented neurotech company.
      { match: ['cortex'], label: 'neurotech', terms: ['neuro*', 'brain', 'bci', 'brain-computer', 'neuromodulation'] },
      { match: ['crypto', 'rails'], label: 'crypto', terms: ['crypto*', 'blockchain', 'web3', 'bitcoin', 'ethereum', 'defi', 'stablecoin*', 'digital asset*', 'filecoin'] },
      { match: ['neuro'], label: 'neurotech', terms: ['neuro*', 'brain', 'bci', 'brain-computer', 'neuromodulation', 'psychiatr*', 'mental health'] },
    ] as Array<{ match: string[]; label: string; terms: string[] }>,
  },
  identityResolution: {
    batchSize: 50, // GUESS — bound each maintenance read and CPU slice below interactive latency.
    pauseMs: 50, // GUESS — leave an actual idle interval between slices on the live server.
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
      /** A family office's or principal's investable assets. Small-band thresholds are GUESSES. */
      family_office: [[5e6, '<$25K'], [10e6, '$25–50K'], [100e6, '$50–250K'], [500e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A foundation's or endowment's assets. */
      foundation: [[250e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A wealth manager, multi-family office or adviser that places clients' money in funds: its assets under management. */
      wealth_manager: [[1e9, '$250K–1M'], [10e9, '$1–5M'], [Infinity, '$5–25M']],
      /** A fund of funds or a fund's LP programme: the fund's size. */
      fund_of_funds: [[100e6, '$1–5M'], [500e6, '$1–5M'], [Infinity, '$5–25M']],
      /** A person's net worth. Small-band thresholds are GUESSES, including strategic angels. */
      individual: [[2e6, '<$25K'], [5e6, '$25–50K'], [25e6, '$50–250K'], [100e6, '$250K–1M'], [1e9, '$1–5M'], [Infinity, '$5–25M']],
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

  /** Investment introductions: ordinal warmth, never confidence or permission to send. */
  routeWarmth: {
    version: 'warmth-3',
    priors: {
      proximity: 0, acquaintance: 1, repeated_contact: 2, worked_together: 3,
      family: 4.5, close_friend: 4, recent_contact: 2.5,
      joint_investment: 3, cofounder: 4, frequent_coinvestment: 5, investor_founder: 4.5,
    }, // GUESS — uncalibrated strength priors; evidence tier is independent.
    currentMonths: 12, // GUESS
    historicalMonths: 36, // GUESS
    agePenalty: { current: 0, ageing: 0.25, historical: 0.75, unknown: 0.5 }, // GUESS
    frequentDeals: 3, // GUESS — distinct personally attributed deals, not repeated mentions.
    frequentDealMonths: 36, // GUESS
    repeatedContacts: 2, // GUESS — distinct dated interactions.
    colleagueOverlapMonths: 24, // GUESS — long service in our own organization.
    strongFirstHop: 3, // GUESS — folding compares evidence tier and warmth; no human review gate.
  },

  routePolicy: {
    maxOrganizationMembers: 8, // GUESS — conservative fan-out limit in a sparsely covered graph, not actual headcount.
    maxOrganizationHeadcount: 500, // GUESS — public employee upper bound where recorded.
    organizationPenaltyScale: 50, // GUESS — half the score at this organization size.
  },

  /** SCORE2: relative investment-route strength, never a calibrated probability or consent. */
  routeScoring: {
    version: 'score-3',
    weights: { lastHop: 70, introducer: 10, history: 15, access: 5 }, // GUESS — target relationship dominates.
    tierConfidence: { A: 1, B: 0.85, C: 0.5, D: 0.25 }, // GUESS — uncertainty, not an information gate.
    confidenceFloor: 0.6, // GUESS — confidence discounts strength without lexicographic tier sorting.
    introducer: { investor: 1, plFounder: 0.8, coinvestor: 0.7 }, // GUESS
    history: { raisedFrom: 1, investorFounder: 0.9, repeatedContact: 0.5 }, // GUESS
    bands: { strong: 60, warm: 35 }, // GUESS — uncalibrated thresholds out of 100.
    routesPerIntroducer: 3, // GUESS — one to three prefixes per last intermediary; no cap on intermediaries.
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
    rehearsal: process.env.POSTGRES_REHEARSAL === '1',
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
