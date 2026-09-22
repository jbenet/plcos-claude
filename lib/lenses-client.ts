/**
 * Five more readings of the same records, with no database in them.
 *
 * The first ten views answer where work is, who holds it and what it costs. These answer
 * the four questions that survive all of that and one nobody had asked yet: **who can move
 * whom, what single piece of work would release several moves, what we do not know, when
 * anybody last actually spoke to them, and what is dated in the fortnight either side of
 * today.**
 */

export type LinkState = 'confirmed' | 'unconfirmed' | 'restricted';

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  confirmed: 'Permission or evidence on file',
  unconfirmed: 'Not confirmed — a clue, not a route',
  restricted: 'A restriction stands in the way',
};

export interface NetNode {
  id: string;
  name: string;
  /** owner = us, advocate = someone who could carry an ask, target = the money. */
  role: 'owner' | 'advocate' | 'target';
  note: string;
  vehicleName: string | null;
  /** Targets only: the potential cheque, for the size of the dot. */
  amount: number | null;
  actions: number;
}

export interface NetLink {
  from: string;
  to: string;
  state: LinkState;
  /** A–D on the underlying edge, or null when the link came from an ask rather than an edge. */
  tier: string | null;
  why: string;
  /** 0–1. Recorded judgement, never a computed sentiment. */
  weight: number;
}

export interface NetPath {
  label: string;
  owner: string;
  advocate: string;
  target: string;
  state: LinkState;
  why: string;
}

export interface Network {
  nodes: NetNode[];
  links: NetLink[];
  paths: NetPath[];
  note: string;
}

export interface Dependent {
  key: string;
  label: string;
  vehicleName: string;
  amount: number | null;
  urgent: boolean;
  blocked: boolean;
}

export interface Prerequisite {
  key: string;
  /** What the piece of work is. */
  label: string;
  /** Which family it belongs to, for grouping. */
  family: 'approval' | 'answer' | 'material' | 'restriction' | 'conflict' | 'budget' | 'goodwill';
  owner: string | null;
  state: 'waiting' | 'review' | 'blocked' | 'working';
  /** What it would release. */
  dependents: Dependent[];
  /** Why this blocks them, in one sentence. */
  because: string;
  /** Where to go and do something about it. */
  href: string;
}

export interface Leverage {
  prerequisites: Prerequisite[];
  totals: { prerequisites: number; dependents: number; inReview: number };
  note: string;
}

export type CellMark = 'recorded' | 'unconfirmed' | 'restricted' | 'missing';

export interface CoverageField {
  key: string;
  label: string;
  means: string;
}

export const COVERAGE_FIELDS: CoverageField[] = [
  { key: 'check', label: 'Check', means: 'A potential figure. Theirs, or a published band — never invented.' },
  { key: 'interest', label: 'Interest', means: 'An explicit recorded assessment. A stage is not an assessment.' },
  { key: 'access', label: 'Access', means: 'At least one route whose weakest hop is confirmed.' },
  { key: 'exchange', label: 'Exchange', means: 'A dated conversation with them. Our own notes are not an exchange.' },
  { key: 'action', label: 'Action', means: 'An open next move with somebody’s name on it.' },
  { key: 'entry', label: 'Entry', means: 'A dated record of arriving at the rung it sits on.' },
];

export interface CoverageRow {
  key: string;
  entityId: string;
  name: string;
  vehicleName: string;
  ownerName: string;
  amount: number | null;
  cells: Record<string, { mark: CellMark; note: string }>;
  recorded: number;
}

export interface Coverage {
  rows: CoverageRow[];
  totals: Array<{ key: string; recorded: number; of: number }>;
  note: string;
}

export interface RadarDot {
  key: string;
  entityId: string;
  name: string;
  vehicleName: string;
  ownerName: string;
  amount: number | null;
  /** Days since a dated exchange with them, or null when there has never been one. */
  days: number | null;
  temp: string;
  blocked: boolean;
  urgent: boolean;
}

export interface Radar {
  dots: RadarDot[];
  offRadar: RadarDot[];
  bands: Array<{ label: string; count: number }>;
  asOf: Date;
  note: string;
}

export type Track = 'exchange' | 'due' | 'run';

export const TRACK_LABEL: Record<Track, string> = {
  exchange: 'Exchanges', due: 'Work due', run: 'Run updates',
};

export interface StripCell {
  /** Days from today. Negative is the past. */
  offset: number;
  count: number;
  tone: 'plain' | 'urgent' | 'blocked' | 'done';
  labels: string[];
}

export interface StripLane {
  vehicleName: string;
  pursuits: number;
  open: number;
  tracks: Record<Track, StripCell[]>;
  /** Outside the window, and the one that matters: things with no date at all. */
  overflow: Record<Track, { earlier: number; later: number; undated: number }>;
}

export interface Strip {
  lanes: StripLane[];
  days: number;
  back: number;
  asOf: Date;
  note: string;
}

export interface Lenses {
  network: Network;
  leverage: Leverage;
  coverage: Coverage;
  radar: Radar;
  strip: Strip;
}
