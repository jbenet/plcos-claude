/**
 * The enrichment catalogue's types, constants and scoring — with no database in sight.
 *
 * Split from `enrichment.ts` so the table can re-rank in the browser as somebody moves the
 * weights. A scoring rule that only runs on the server is a scoring rule nobody plays with,
 * and playing with it is how anyone finds out whether they believe it.
 */
export type MethodKind =
  | 'buy' | 'integrate' | 'query' | 'ask' | 'observe' | 'interview' | 'infer';
export type MethodStatus = 'available' | 'blocked' | 'in_use' | 'rejected';

export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  buy: 'Buy', integrate: 'Integrate', query: 'Query', ask: 'Ask',
  observe: 'Observe', interview: 'Interview', infer: 'Infer',
};

export const METHOD_KIND_MEANS: Record<MethodKind, string> = {
  buy: 'A dataset or a subscription. Costs money once and covers the whole universe.',
  integrate: 'A service we query programmatically. Costs engineering, then costs nothing.',
  query: 'A search somebody runs, by hand or with a model. Cheap, slow, and only as good as the reader.',
  ask: 'A direct question to somebody who would know. The highest-yield method and the one that spends goodwill.',
  observe: 'Something public, watched over time. Free, and produces clues rather than facts.',
  interview: 'A question put in a meeting or a first email. Free, and only available once.',
  infer: 'Derived from data we already hold. Free, instant, and never better than tier C.',
};

export const STATUS_LABEL: Record<MethodStatus, string> = {
  available: 'Available', blocked: 'Blocked', in_use: 'In use', rejected: 'Rejected',
};

/**
 * What the ranking is weighted by, and what the reader can move.
 *
 * These are on the page rather than in the code because every one of them is a judgement
 * about this team at this moment — a person-day is scarce here and would not be at a firm
 * with twenty analysts, and the AI bias is a bet that an agent-runnable search is worth
 * more than its cost suggests because it is *repeatable*. Numbers somebody can argue with
 * are numbers somebody will argue with, which is the point.
 */
export interface ScoreParams {
  /** Cost points for one person-day. The scarcest thing on the list. */
  humanDayCost: number;
  /** Cost points for one hour of model time. Cheap, and not free: somebody reads it. */
  aiHourCost: number;
  /** Dollars per cost point, so money and time land in the same unit. */
  dollarsPerPoint: number;
  /** Multiplier on anything an agent can run. A bet on repeatability, not on magic. */
  aiBias: number;
  /** How many human-run methods to have in flight at once. */
  humanWip: number;
  /** How many agent-run ones. Larger, because they wait rather than work. */
  aiWip: number;
}

export const DEFAULT_PARAMS: ScoreParams = {
  humanDayCost: 10,      // GUESS
  aiHourCost: 0.5,       // GUESS
  dollarsPerPoint: 2000, // GUESS
  aiBias: 1.4,           // GUESS
  humanWip: 5,           // GUESS
  aiWip: 12,             // GUESS
};

/** What a tier is worth. A discovery clue is not a third of a filing, and it is not zero. */
export const TIER_VALUE: Record<string, number> = { A: 1, B: 0.8, C: 0.5, D: 0.3 };

export type Verdict = 'do_next' | 'queued' | 'hold' | 'blocked' | 'rejected';

export const VERDICT_LABEL: Record<Verdict, string> = {
  do_next: 'Do next', queued: 'In the queue', hold: 'Hold',
  blocked: 'Blocked', rejected: 'Rejected',
};

export interface Score {
  /** What it would close, tier-weighted. */
  value: number;
  /** Money, human time and model time, in one unit. */
  cost: number;
  costParts: { dollars: number; human: number; ai: number };
  /** value ÷ cost, with the AI bias applied. The column the table sorts by. */
  priority: number;
  verdict: Verdict;
  why: string;
}

export interface Method {
  methodId: string;
  kind: MethodKind;
  name: string;
  detail: string;
  yields: string[];
  producesTier: string;
  costUsd: number | null;
  costBasis: string | null;
  effortDays: number;
  latencyDays: number | null;
  coverage: string;
  status: MethodStatus;
  blockedBy: string | null;
  limits: string | null;
  certainty: string;
  source: string | null;
  asOf: Date;
  humanDays: number;
  aiHours: number;
  automatable: boolean;
  selected: boolean;
  selectedByName: string | null;
  /** Derived: how many open gaps in the current universe this method would touch. */
  fills: number;
  /** Derived, with the parameters the reader chose. */
  score: Score;
}

export interface Gap {
  /** The dimension or gate code. */
  code: string;
  label: string;
  /** 'dimension' | 'gate' */
  kind: 'dimension' | 'gate';
  /** How many assessed targets have this open. */
  count: number;
  /** Named targets, for the per-target view. */
  entities: string[];
  /** Why it is a gap: guessed, inferred, or unanswered. */
  why: string;
}


/**
 * Score, rank, and say what to do about each one.
 *
 * Value is what it would close, weighted by how good the evidence can be — a method that
 * fills four gaps at tier D is worth less than one that fills two at tier A, and a single
 * number that ignored the tier would rank the bulk source first every time.
 *
 * Cost puts dollars, person-days and model-hours in one unit, because **time is not free
 * and the two kinds of time are not the same**. The verdict then reads off the rank, the
 * readiness, and how much is already in flight.
 */
export function scoreMethods<T extends Omit<Method, 'score'>>(
  methods: T[], params: ScoreParams,
): Array<T & { score: Score }> {
  const scored = methods.map((m) => {
    const tier = TIER_VALUE[m.producesTier] ?? 0.3;
    const value = m.fills * tier;

    const dollars = (m.costUsd ?? 0) / params.dollarsPerPoint;
    const human = m.humanDays * params.humanDayCost;
    const ai = m.aiHours * params.aiHourCost;
    /**
     * Nothing is free.
     *
     * Even a question asked inside a meeting you were already having costs the decision to
     * ask it and the minutes spent writing the answer down. Without a floor, anything
     * recorded as zero divides by nothing and lands at the top with a number nobody can
     * read — which is how a ranking stops being read at all.
     */
    const cost = Math.max(0.25, dollars + human + ai);

    const bias = m.automatable ? params.aiBias : 1;
    const priority = (value / cost) * bias;

    return { ...m, score: { value, cost, costParts: { dollars, human, ai }, priority,
      verdict: 'hold' as Verdict, why: '' } };
  });

  // Rank once, then assign verdicts against the work-in-progress limits.
  const runnable = scored
    .filter((m) => m.status === 'available' || m.status === 'in_use')
    .sort((a, b) => b.score.priority - a.score.priority);

  let humanSlots = params.humanWip - runnable.filter((m) => m.selected && !m.automatable).length;
  let aiSlots = params.aiWip - runnable.filter((m) => m.selected && m.automatable).length;

  for (const m of scored) {
    if (m.status === 'rejected') {
      m.score.verdict = 'rejected';
      m.score.why = m.blockedBy ?? 'Recorded as a method we will not use.';
      continue;
    }
    if (m.status === 'blocked') {
      m.score.verdict = 'blocked';
      m.score.why = m.blockedBy ?? 'Something stops this today.';
      continue;
    }
    if (m.selected) {
      m.score.verdict = 'queued';
      m.score.why = `Chosen${m.selectedByName ? ` by ${m.selectedByName}` : ''}. `
        + `Counts against the ${m.automatable ? 'agent' : 'human'} limit.`;
      continue;
    }
    if (m.fills === 0) {
      m.score.verdict = 'hold';
      m.score.why = 'Closes nothing that is currently open. Useful later, not now.';
      continue;
    }
    const slots = m.automatable ? aiSlots : humanSlots;
    if (slots > 0) {
      m.score.verdict = 'do_next';
      m.score.why = m.automatable
        ? 'An agent can run it, it closes open gaps, and there is room in the agent queue.'
        : 'Closes open gaps at a cost worth paying, and there is room in the human queue.';
      if (m.automatable) aiSlots -= 1; else humanSlots -= 1;
    } else {
      m.score.verdict = 'hold';
      m.score.why = `The ${m.automatable ? 'agent' : 'human'} queue is full. `
        + 'Finishing what is running beats starting this.';
    }
  }

  return scored.sort((a, b) => b.score.priority - a.score.priority);
}

