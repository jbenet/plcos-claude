/**
 * Strategic value (issue 0120, Juan, 28 Sep 2026): how useful an LP would be to this vehicle beyond
 * the check — for an SPV, to its one company; for a fund, to the fund as a whole. A small derived
 * lens beside the score, never part of it: "this lets me pick potentially smaller checks but that
 * would be worth a lot for the co."
 *
 * Pure rules, no data access, so the properties and the browser can use them (exported through
 * client.ts). The inputs are what the records already hold:
 *
 *   1. A person's grade: the fit assessment's "Beyond capital" dimension for this LP and vehicle.
 *      It wins, as a person's SPV setting does.
 *   2. Research facts (W1) and the public profile whose text ties the LP to the vehicle's field, or
 *      to the SPV's company by name: roles and board seats (operating), investments (portfolio),
 *      stated interests (expertise). The SPV stance's own evidence is research text too.
 *   3. The sourcing judgement: a prospect row's `strategic` flag and its reason.
 *   4. The vehicle's W5 strategy: affinity read high, or an ask of advice, introductions or co-investing.
 *
 * Two signals, or a tie to the company itself, read high; one reads some. With none, an explicit
 * judgement against (sourced and not marked strategic, a strategy reading affinity low) reads none;
 * otherwise unknown. Unknown is not none (rule 7): nothing on file either way.
 */

export type StrategicLevel = 'high' | 'some' | 'none' | 'unknown';
export const STRATEGIC_LEVELS: StrategicLevel[] = ['high', 'some', 'none', 'unknown'];
export const STRATEGIC_LABEL: Record<StrategicLevel, string> = { high: 'high', some: 'some', none: 'none', unknown: 'unknown' };

/** A vehicle's field: the words that tie research text to it, and for an SPV its company's name. */
export interface StrategicDomain { match: string[]; label: string; terms: string[] }
export interface StrategicScope { company: string | null; label: string | null; terms: string[] }

/** One piece of research text about the LP: a fact's field and value, a profile, or the SPV evidence. */
export interface StrategicText { field: string; value: string; asOf: string | null }

export type StrategicGrade = 'strong' | 'good' | 'neutral' | 'weak' | 'blocker';
export interface StrategicInputs {
  /** The fit assessment's "Beyond capital" dimension for this LP and vehicle, when someone graded it. */
  assessed?: { grade: StrategicGrade; finding: string; certainty: string; asOf: string | null } | null;
  /** The prospect row this pursuit was sourced from. `researched`: its status was decided (Sourcing or Passed). */
  prospect?: { strategic: boolean; reason: string; researched: boolean } | null;
  /** The vehicle's W5 strategy for this LP. */
  strategy?: { affinity?: { level?: string | null; basis?: string | null } | null; askShape?: string | null } | null;
  texts: StrategicText[];
}

export interface StrategicMark {
  level: StrategicLevel;
  /** Whose word: a person's grade, derived from the records, or nothing on file. */
  basis: 'assessed' | 'derived' | 'none';
  /** The reasons, strongest first, each one line; the first is the "why". At most three are kept. */
  reasons: string[];
  /** How many signals counted toward the level; the order within a level. */
  points: number;
}

export const UNKNOWN_MARK: StrategicMark = { level: 'unknown', basis: 'none', reasons: [], points: 0 };

/** Which facts say what. Firm-scope facts are not separated in the claims table; the words decide. */
type Kind = 'operating' | 'portfolio' | 'expertise';
const FIELD_KIND: Record<string, Kind> = {
  role: 'operating', prior_role: 'operating', board: 'operating', affiliation: 'operating',
  investment: 'portfolio', fund_gp: 'portfolio', fund_lp: 'portfolio', exit: 'portfolio', spv: 'portfolio',
  interest: 'expertise', statement: 'expertise', education: 'expertise', philanthropy: 'expertise', profile: 'expertise',
};
/** The claim fields worth reading, as the import stores them. */
export const STRATEGIC_FIELDS = Object.keys(FIELD_KIND).filter((f) => f !== 'spv' && f !== 'profile');
const KIND_WORDS: Record<Kind, (label: string) => string> = {
  operating: (l) => `Works in ${l}`,
  portfolio: (l) => `Has backed ${l}`,
  expertise: (l) => `Stated interest in ${l}`,
};
const ASKS: Record<string, string> = {
  advice: 'the strategy’s ask is their advice', 'intro to others': 'the strategy’s ask is introductions',
  'co-invest': 'the strategy reads them as a co-investor in our field',
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A term matches at a word start; a trailing * lets it run on ("neuro*" is neuroscience, neurotech). */
export function termPattern(term: string): string {
  const t = term.trim().toLowerCase();
  return t.endsWith('*') ? `(?:^|[^a-z0-9])${esc(t.slice(0, -1))}` : `(?:^|[^a-z0-9])${esc(t)}(?:[^a-z0-9]|$)`;
}
export function mentions(text: string, terms: string[]): string | null {
  for (const term of terms) if (term.trim() && new RegExp(termPattern(term), 'i').test(text)) return term.replace(/\*$/, '');
  return null;
}

/** An SPV's company, from the vehicle's name: "SPV — Cortex" and "Cortex SPV" are Cortex. */
export function spvCompany(name: string): string | null {
  const c = name.replace(/\([^)]*\)/g, ' ').replace(/\bSPV\b/gi, ' ').replace(/[—–-]/g, ' ').replace(/\s+/g, ' ').trim();
  return c.length >= 3 ? c : null;
}

/** The vehicle's field: the first domain whose match word is in its slug or name; an SPV adds its company. */
export function strategicScope(vehicle: { slug: string; name: string; kind: string }, domains: StrategicDomain[]): StrategicScope {
  const text = `${vehicle.slug} ${vehicle.name}`.toLowerCase().replace(/[-_]/g, ' ');
  const domain = domains.find((d) => d.match.some((m) => text.includes(m.toLowerCase()))) ?? null;
  return { company: vehicle.kind === 'spv' ? spvCompany(vehicle.name) : null, label: domain?.label ?? null, terms: domain?.terms ?? [] };
}

const cut = (s: string, n = 140) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const dated = (s: string, asOf: string | null) => (asOf ? `${s} (${asOf})` : s);

/** The level, whose word it is, and why. Pure: the same inputs always give the same mark. */
export function strategicMark(scope: StrategicScope, x: StrategicInputs): StrategicMark {
  const reasons: Array<{ at: number; text: string }> = [];
  let points = 0;
  // Research text: a tie to the SPV's company counts double; otherwise one point per kind of tie.
  const company = scope.company ? [scope.company] : [];
  const tied = company.length ? x.texts.find((t) => mentions(t.value, company)) : undefined;
  if (tied) { points += 2; reasons.push({ at: 0, text: dated(`Research ties them to ${scope.company}: ${cut(tied.value)}`, tied.asOf) }); }
  if (scope.terms.length && scope.label) {
    const seen = new Set<Kind>();
    for (const t of x.texts) {
      const kind = FIELD_KIND[t.field];
      if (!kind || seen.has(kind) || t === tied || !mentions(t.value, scope.terms)) continue;
      seen.add(kind);
      points += 1;
      reasons.push({ at: 1, text: dated(`${KIND_WORDS[kind](scope.label)}: ${cut(t.value)}`, t.asOf) });
    }
  }
  if (x.prospect?.strategic) { points += 1; reasons.push({ at: 2, text: `Marked strategic when sourced: ${cut(x.prospect.reason)}` }); }
  const affinity = x.strategy?.affinity?.level;
  if (affinity === 'high') { points += 1; reasons.push({ at: 3, text: `The strategy reads their affinity high${x.strategy?.affinity?.basis ? `: ${cut(x.strategy.affinity.basis)}` : ''}` }); }
  const ask = x.strategy?.askShape ? ASKS[x.strategy.askShape] : undefined;
  if (ask) { points += 1; reasons.push({ at: 4, text: ask[0]!.toUpperCase() + ask.slice(1) }); }

  // What someone judged against: counted only when nothing speaks for them.
  const against: string[] = [];
  if (x.prospect && !x.prospect.strategic && x.prospect.researched) against.push(`Sourced and not marked strategic: ${cut(x.prospect.reason)}`);
  if (affinity === 'low') against.push(`The strategy reads their affinity low${x.strategy?.affinity?.basis ? `: ${cut(x.strategy.affinity.basis)}` : ''}`);

  const derived = reasons.sort((a, b) => a.at - b.at).map((r) => r.text);
  const level: StrategicLevel = points >= 2 ? 'high' : points === 1 ? 'some' : against.length ? 'none' : 'unknown';

  // A person's grade wins; what the records say stays beneath it.
  if (x.assessed && x.assessed.grade) {
    const g = x.assessed.grade;
    const graded: StrategicLevel = g === 'strong' ? 'high' : g === 'good' ? 'some' : 'none';
    const why = dated(`Graded ${g} in Fit & standing, beyond capital${x.assessed.certainty === 'guess' ? ' (a guess)' : ''}: ${cut(x.assessed.finding)}`, x.assessed.asOf);
    return { level: graded, basis: 'assessed', reasons: [why, ...derived].slice(0, 3), points };
  }
  if (level === 'unknown') return UNKNOWN_MARK;
  return { level, basis: 'derived', reasons: (level === 'none' ? against : derived).slice(0, 3), points };
}

/** High, then some, then unknown, then none; more signals first within a level. */
const LEVEL_ORDER: Record<StrategicLevel, number> = { high: 3, some: 2, unknown: 1, none: 0 };
export const strategicOrder = (m: Pick<StrategicMark, 'level' | 'points'>) => LEVEL_ORDER[m.level] * 100 + Math.min(m.points, 99);
