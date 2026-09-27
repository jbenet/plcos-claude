/**
 * Issue 0097: rank options by the utility they create, not by how cheaply they create it.
 * Three scores, each a labelled GUESS with its basis, and one combined figure:
 *
 *   reach     LPs the option touches (a move's estimate; one for an LP action)
 *   capital   incremental capital this raise (moveScore / lpEffortScore, unchanged)
 *   presence  0–5, how much the option lifts how LPs see us beyond this raise: brand, reputation,
 *             reasons to take the next call. A move may estimate it; otherwise its kind's default.
 *
 *   utility   = capital + presence × presencePointValue       (capital-equivalent, GUESS)
 *
 * Capital per team hour stays beside it as the efficiency, and cash and days as constraints. Pure,
 * with no database, Node or config imports, so the browser can use the same families; the caller
 * passes config.strategyRanking.
 */
export interface UtilityRules { presencePointValue: number; presenceDefaults: Partial<Record<MoveFamily, number>> }

export interface PresenceEstimate { value: number; basis: string; label: 'GUESS' }

/** The kinds of work named in 0082, beyond advancing one LP. */
export const MOVE_FAMILIES = [
  { id: 'conversion', label: 'Convert and close', test: /intro|syndicat|close|co-?invest|convert|follow/i },
  { id: 'materials', label: 'Materials', test: /material|deck|memo|pack|data ?room/i },
  { id: 'presence', label: 'Public presence', test: /presence|video|writ|post|blog|talk|press|podcast|market/i },
  { id: 'events', label: 'Events', test: /event|host|attend|conference|dinner|roundtable/i },
  { id: 'sourcing', label: 'Source and enrich', test: /sourc|enrich|research|list|cohort/i },
] as const;
export type MoveFamily = typeof MOVE_FAMILIES[number]['id'] | 'other';
export const moveFamily = (category: string): MoveFamily => MOVE_FAMILIES.find(f => f.test.test(category))?.id ?? 'other';

/** A move's own presence estimate, or its kind's configured default, said as such. */
export function presenceFor(rules: UtilityRules, category: string, own?: PresenceEstimate | null): PresenceEstimate & { source: 'move' | 'default' } {
  if (own) return { ...own, source: 'move' };
  const family = moveFamily(category);
  const value = rules.presenceDefaults[family] ?? 0;
  return { value, label: 'GUESS', source: 'default',
    basis: `Not estimated for this move; the default for ${family === 'other' ? 'uncategorised moves' : `${MOVE_FAMILIES.find(f => f.id === family)!.label.toLowerCase()} moves`} (config, GUESS).` };
}

export interface Utility { reach: number; capital: number; presence: number; presenceValue: number; utility: number }
export function utilityOf(rules: UtilityRules, input: { reach: number; capital: number; presence: number }): Utility {
  const presenceValue = input.presence * rules.presencePointValue;
  return { ...input, presenceValue, utility: input.capital + presenceValue };
}
