export type Horizon = 'today' | 'week';
export type ItemStatus = 'open' | 'done' | 'carried' | 'dropped';
export type ExternalSource = 'linear' | 'affinity';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  open: 'Open', done: 'Done', carried: 'Carried', dropped: 'Dropped',
};

export const SOURCE_LABEL: Record<ExternalSource, string> = {
  linear: 'Linear', affinity: 'Affinity',
};

/**
 * One pinned number. The label and the detail are stored with it, so a day rendered in
 * November says what the number meant in September even if the code that produced it has
 * been rewritten since.
 */
export interface Metric {
  key: string;
  label: string;
  value: number;
  /** 'usd' | 'count' | 'ratio' — how to render, pinned with the number. */
  unit: 'usd' | 'count' | 'ratio';
  vehicleSlug: string | null;
  vehicleName: string | null;
  detail: string;
}

export interface Item {
  itemId: string;
  horizon: Horizon;
  title: string;
  detail: string | null;
  ownerName: string | null;
  vehicleName: string | null;
  status: ItemStatus;
  carriedFrom: Date | null;
  sort: number;
}

export interface Action {
  actionId: string;
  rank: number;
  title: string;
  why: string;
  ownerName: string | null;
  vehicleName: string | null;
  blocker: string | null;
  blockedOn: string | null;
  dueOn: Date | null;
  gate: string | null;
}

export interface External {
  externalId: string;
  source: ExternalSource;
  ref: string;
  title: string;
  state: string;
  who: string | null;
  detail: string | null;
  occurredAt: Date;
  url: string | null;
}

export interface Standup {
  day: Date;
  /** Null when nobody has pinned this day yet. */
  capturedAt: Date | null;
  capturedByName: string | null;
  headline: string | null;
  /** True when the numbers below were computed just now rather than read from the pin. */
  live: boolean;
  metrics: Metric[];
  today: Item[];
  week: Item[];
  actions: Action[];
  linear: External[];
  outreach: External[];
  /** What yesterday said, so the first question of the meeting has an answer on screen. */
  previous: { day: Date; items: Item[] } | null;
  nextDay: Date | null;
  prevDay: Date | null;
}
