import type { LadderRung } from '@/modules/strategy/client';

/**
 * The second projection's shapes and vocabulary, with no database in them.
 *
 * The floor answers "what is happening". This one answers the questions you ask before
 * anything is happening: **where is the ground, what is on it, what can we do next, and
 * what does doing it cost.** Same discipline about the words — every number carries the
 * basis it came from, and anything nobody recorded is drawn as unknown rather than absent.
 */

/** How much we actually know about a name. The fog, stated. */
export type Explored = 'scored' | 'researched' | 'named';

export const EXPLORED_LABEL: Record<Explored, string> = {
  scored: 'Scored on the rubric',
  researched: 'Researched, not scored',
  named: 'A name and nothing else',
};

export type Holding = 'wired' | 'ours' | 'contested' | 'restricted' | 'open';

export const HOLDING_LABEL: Record<Holding, string> = {
  wired: 'Cash received',
  ours: 'We are working it',
  contested: 'Two vehicles want it',
  restricted: 'Do not approach',
  open: 'Nobody is working it',
};

export interface Territory {
  entityId: string;
  name: string;
  segment: string;
  /** 0–1 each, or null where nobody has scored that dimension. */
  capacity: number | null;
  affinity: number | null;
  propensity: number | null;
  timeToDecision: number | null;
  band: string;
  scoreBasis: string;
  cheque: number | null;
  chequeBasis: string;
  holding: Holding;
  explored: Explored;
  ownerName: string | null;
  rung: LadderRung | null;
  /** Relationship edges we have recorded that touch this name. */
  edges: number;
  vehicleName: string | null;
}

export interface Station {
  key: string;
  label: string;
  requires: string;
  /** Sitting at this station now. */
  wip: number;
  /** Records added at this station in the last 30 days. */
  in30: number;
  /** Items that left this station for the next one in the last 30 days. */
  out30: number;
  /** Median days between arriving here and leaving, over everything that has left. */
  dwell: number | null;
  blocked: number;
  /** The approval kind that gates the step out of this station, if any. */
  gate: string | null;
  gateOpen: number;
  gateNote: string;
}

export interface Move {
  key: string;
  family: string;
  label: string;
  requires: string;
  /** How many items this move is available on right now. */
  available: number;
  /** How many it is blocked on, and why. */
  blocked: number;
  blockedWhy: string | null;
  gate: string | null;
  cost: string;
  payoff: string;
  /** Who can run it: a person, an agent, or either. */
  runner: 'human' | 'agent' | 'either';
}

export type CellState = 'open' | 'spent' | 'blocked' | 'locked' | 'done';

export const CELL_LABEL: Record<CellState, string> = {
  open: 'Available now',
  spent: 'Used this quarter',
  blocked: 'Blocked',
  locked: 'Not yet — the rung below is missing',
  done: 'Done',
};

export const CELL_GLYPH: Record<CellState, string> = {
  open: '○', spent: '◑', blocked: '✕', locked: '·', done: '●',
};

export interface Lever {
  key: string;
  label: string;
  means: string;
}

export const LEVERS: Lever[] = [
  { key: 'route', label: 'Route', means: 'A warm path to them that our records support.' },
  { key: 'ask', label: 'Ask', means: 'An introduction ask, against this quarter’s allowance.' },
  { key: 'meet', label: 'Meet', means: 'A meeting that has happened or is on the calendar.' },
  { key: 'material', label: 'Material', means: 'Something we are allowed to send them for this wrap.' },
  { key: 'answer', label: 'Answer', means: 'Their objections, answered from the library.' },
  { key: 'structure', label: 'Structure', means: 'An instrument that fits how they actually give.' },
  { key: 'number', label: 'Number', means: 'A figure from them — the thing that makes it real.' },
  { key: 'close', label: 'Close', means: 'Countersignature, then the wire.' },
];

export interface BoardRow {
  entityId: string;
  name: string;
  vehicleName: string;
  ownerName: string;
  stake: number | null;
  cells: Record<string, { state: CellState; note: string }>;
}

export interface Resource {
  key: string;
  label: string;
  used: number;
  cap: number | null;
  unit: string;
  /** Where the cap came from — often a guess, and it says so. */
  basis: string;
  tone: 'ok' | 'tight' | 'over' | 'unknown';
  detail: string;
}

export interface BoardState {
  territories: Territory[];
  stations: Station[];
  moves: Move[];
  rows: BoardRow[];
  resources: Resource[];
  /** Per-connector goodwill, which is the resource people forget is finite. */
  goodwill: Array<{ name: string; used: number; cap: number; basis: string }>;
  fog: { scored: number; researched: number; named: number; note: string };
}
