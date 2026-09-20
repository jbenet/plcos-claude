export type SignalKind =
  | 'personnel_change' | 'allocation_announced' | 'mandate_change'
  | 'filing' | 'public_statement' | 'event_attendance' | 'fund_close';

export type Disposition = 'new' | 'claimed' | 'acted' | 'dismissed';

export const KIND_LABEL: Record<SignalKind, string> = {
  personnel_change: 'Personnel change',
  allocation_announced: 'Allocation announced',
  mandate_change: 'Mandate change',
  filing: 'Filing',
  public_statement: 'Public statement',
  event_attendance: 'Event attendance',
  fund_close: 'Fund close',
};

export interface Signal {
  signalId: string;
  entityId: string | null;
  entityName: string | null;
  kind: SignalKind;
  headline: string;
  detail: string | null;
  source: string;
  sourceRef: string | null;
  observedAt: Date;
  confidence: 'high' | 'medium' | 'low';
  /** The rule that made this a signal rather than noise. */
  thresholdLabel: string;
  thresholdDetail: string;
  disposition: Disposition;
  claimedByName: string | null;
  note: string | null;
  /** False once it is past config.signals.freshDays. History, not a queue item. */
  fresh: boolean;
}
