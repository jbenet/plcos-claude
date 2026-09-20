export type PeriodKind = 'sprint' | 'holiday' | 'dead_zone' | 'milestone';

export interface Period {
  periodId: string;
  kind: PeriodKind;
  label: string;
  detail: string | null;
  startsOn: Date;
  endsOn: Date;
  vehicleName: string | null;
  suppressUrgency: boolean;
}

/** One column in the sprint strip. */
export interface Week {
  startsOn: Date;
  label: string;
  isCurrent: boolean;
  /** Periods overlapping this week, in order of significance. */
  periods: Period[];
  /** True when three or more of the five working days sit inside a suppressed period. */
  dead: boolean;
  /** How many of the five working days are lost to a suppressed period. */
  lostDays: number;
  milestone: Period | null;
}

export interface UrgencyState {
  suppressed: boolean;
  /** The words the HUD is allowed to use today. */
  reason: string | null;
  until: Date | null;
}
