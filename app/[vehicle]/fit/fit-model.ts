import type { PursuitStatus } from '@/modules/strategy/client';

/** The fit page's groups and rows, shared by the server page and its client list (issues 0073, 0096). */
export type Group = 'strong' | 'good' | 'possible' | 'weak' | 'unknown' | 'gate' | 'missing';
export const ORDER: Group[] = ['strong', 'good', 'possible', 'weak', 'unknown', 'gate', 'missing'];
export const GROUP_LABEL: Record<Group, string> = {
  strong: 'Strong fit', good: 'Good fit', possible: 'Possible fit', weak: 'Weak fit',
  unknown: 'Fit not known', gate: 'Fails a gate', missing: 'No reading yet',
};
export const GROUP_FLAG: Record<Group, string> = {
  strong: 'f-ok', good: 'f-ok', possible: 'f-ev', weak: 'f-mute', unknown: 'f-mute', gate: 'f-block', missing: 'f-mute',
};
/**
 * What each group means for the week, in the language of work rather than of state. Five
 * strong fits and five unknowns are the same count and completely different jobs.
 */
export const WORK: Record<Group, string> = {
  strong: 'Ask. The constraint is calendar, not qualification.',
  good: 'Worth the next step: close the one gap the reading names.',
  possible: 'Find the one fact that would settle it before spending an ask.',
  weak: 'Park it. Time here is time not spent on a firm that could say yes.',
  unknown: 'The reading could not tell. Research before planning an ask.',
  gate: 'Correct the record or drop them. No relationship work moves a gate.',
  missing: 'Nobody has read them against this vehicle yet: a gap in our work, not a judgement.',
};

export interface FitRow {
  key: string; entityId: string; name: string;
  vehicleId: string; vehicleName: string; vehicleSlug: string;
  pursuitId: string | null; status: PursuitStatus | null; owner: string;
  score: number | null; rank: number | null; group: Group; kind: 'assessed' | 'provisional' | 'missing';
  why: string | null;
  capacity: string | null; affinity: string | null; propensity: string | null; decide: string | null;
  gates: { pass: number; open: number; fail: number; total: number } | null;
  /** ISO date of the reading or assessment. */
  date: string | null;
  known: number | null; dims: string | null;
  /** What the side pane shows for the selected row: the reading's bases, gates and proposal. */
  detail: {
    bases: Array<{ label: string; value: string | null; basis: string | null }>;
    gateList: Array<{ gate: string; answer: 'yes' | 'no' | 'unknown'; basis: string | null }>;
    angle: string | null; next: string | null; nextStep: string | null; toFind: string[];
    by: string | null; confidence: string | null;
  };
}

export interface FitSection { group: Group | null; count: number; rows: FitRow[] }
