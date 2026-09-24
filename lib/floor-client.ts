import type { LadderRung, PursuitStatus } from '@/modules/strategy/client';

/**
 * The floor's shapes and its vocabulary, with no database in them.
 *
 * `lib/floor.ts` reads eleven modules to build this, which means importing it from a client
 * component drags the Postgres driver into the browser bundle. The five views need the
 * words and the types, not the query — so they live here.
 */

export type Temp = 'hot' | 'warm' | 'cool' | 'cold' | 'unmoved' | 'done';

export const TEMP_LABEL: Record<Temp, string> = {
  hot: 'Moving', warm: 'Recent', cool: 'Slowing', cold: 'Gone quiet',
  unmoved: 'Nothing recorded', done: 'Wired',
};

/** Days since the last evidence record, which is the only thing "hot" can honestly mean. */
export const TEMP_MEANS: Record<Temp, string> = {
  hot: 'Something was recorded in the last 7 days.',
  warm: 'Something was recorded in the last 21 days.',
  cool: 'Nothing for 3 to 6 weeks.',
  cold: 'Nothing for more than 6 weeks.',
  unmoved: 'No dated record on this pursuit at all.',
  done: 'The wire landed. Quiet here is the correct state, not a warning.',
};

export interface FloorItem {
  key: string;
  entityId: string;
  entityName: string;
  vehicleSlug: string;
  vehicleName: string;
  ownerName: string;
  /** The pursuit behind the item, for its LP page. Null for money on the close track with no pursuit. */
  pursuitId: string | null;
  /**
   * Where our effort is with them (N50, docs/17): the pursuit's status, which is what the views
   * lay out by. It is our plan, set by a person or read from Affinity until one is: it never
   * moves the rung, and the rung never moves it. An item with no pursuit reads as Committed
   * (lib/floor.ts says why).
   */
  status: PursuitStatus;
  /** Where the status came from, in words: who set it and when, Affinity's word, or the close track. */
  statusBasis: string;
  /**
   * The rung the status claims and the ladder has not confirmed ("Needs evidence"), or null when
   * the ladder backs it or the status claims nothing. `statusNeedsEvidence` in modules/strategy.
   */
  needsEvidence: LadderRung | null;
  /**
   * The highest rung with an evidence record: the evidence under the status, and what the views
   * that count evidence lay out by. It includes what the close track records — a soft amount, a
   * countersignature, a wire — so it can be ahead of `ladderRung`. Null means none yet.
   */
  rung: LadderRung | null;
  /**
   * The highest rung the ladder itself has confirmed, through a STAGE ticket: the pursuit's
   * rung, as the LP page shows it. Null with no pursuit, or nothing confirmed yet. "Needs
   * evidence" is judged on this one, so the floor and the LP page agree.
   */
  ladderRung: LadderRung | null;
  rungIndex: number;
  nextRung: LadderRung | null;
  /** Soft and hard are separate tracks and are never added together anywhere. */
  track: 'soft' | 'hard' | null;
  amount: number | null;
  probability: number | null;
  cashReceived: boolean;
  /** Why this item is the size it is drawn at — or why it has no size. */
  sizeBasis: string;
  temp: Temp;
  tempBasis: string;
  lastMoveAt: Date | null;
  daysSinceMove: number | null;
  /** Something stops this today. Rendered as a tag, never as a colour alone. */
  blocked: string | null;
  /** Something dated is about to happen to it. */
  urgent: string | null;
  urgentAt: Date | null;
  conflict: boolean;
  restricted: boolean;
  openTicket: string | null;
  headline: string | null;
  /** Every rung with an evidence record, in order. The path this item actually walked. */
  path: LadderRung[];
  /** Dates against those rungs, so a flow can be drawn over time rather than asserted. */
  walkedAt: Array<{ rung: LadderRung; at: Date }>;
  /** Nothing recorded for longer than three weeks. Never a wired item or a passed one. */
  stalled: boolean;
}

export interface FloorAgents {
  running: number;
  awaitingAcceptance: number;
  refused: number;
  acceptedToday: number;
  breaker: { frozen: boolean; statement: string };
  queue: Array<{ label: string; state: 'running' | 'awaiting' | 'refused' | 'accepted'; who: string; at: Date }>;
  /** The enrichment queue is work too, and it competes for the same people. */
  humanQueued: number;
  agentQueued: number;
  humanWip: number;
  agentWip: number;
}

export interface Alarm {
  key: string;
  severity: 'stop' | 'soon' | 'note';
  label: string;
  detail: string;
  entityName: string | null;
  vehicleName: string | null;
  at: Date | null;
}

export interface Dated {
  key: string;
  at: Date;
  label: string;
  kind: 'meeting' | 'expiry' | 'followup' | 'close' | 'seat';
  entityName: string | null;
  vehicleName: string | null;
  ownerName: string | null;
}

export interface FloorState {
  scopeSlug: string | null;
  scopeName: string;
  vehicles: Array<{ slug: string; name: string; kind: string }>;
  items: FloorItem[];
  agents: FloorAgents;
  alarms: Alarm[];
  /** Everything with a date on it in the next fortnight. Undated work is not in here. */
  schedule: Dated[];
  /** Per vehicle, per track. Two numbers that are never added to each other. */
  money: Array<{ slug: string; name: string; hard: number; soft: number; items: number }>;
  asOf: Date;
  coverage: {
    corpus: string;
    notInspected: string[];
  };
}

