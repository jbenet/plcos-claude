/**
 * Seam 4 of 5 — Connector<TRaw>.
 *
 * No connector is built before L13 (CLAUDE.md, "Do not build"). The contract exists from
 * L1 because it is what everything that touches external data is written against, and
 * because the three invariants below are cheap now and expensive to retrofit:
 *
 *  1. Everything lands raw first. Normalization is a separate, replayable step.
 *  2. The idempotency key is (source, source_id, source_updated_at). Re-delivery is free.
 *  3. onWebhook returns invalidations, never data. One code path for signed and unsigned.
 */

export interface Batch<TRaw> {
  records: TRaw[];
  /** Opaque, source-defined. Resume from here; never reconstruct it from record fields. */
  cursor: string | null;
  fetchedAt: Date;
}

export interface Watermark {
  /** Use the source's own change clock. For Affinity that is createdAt/updatedAt, never sentAt. */
  since: Date | null;
  cursor: string | null;
}

export interface Invalidation {
  source: string;
  sourceId: string;
  reason: 'webhook' | 'poll' | 'manual';
}

export interface CoreRecord {
  kind: string;
  sourceId: string;
  fields: Record<string, unknown>;
  /** The provenance tuple. A field that cannot carry one cannot be claimed downstream. */
  provenance: Provenance;
}

export interface Provenance {
  source: string;
  asOf: Date;
  confidence: 'high' | 'medium' | 'low';
  lastVerifiedBy: string | null;
}

export interface Connector<TRaw> {
  readonly source: string;
  readonly capabilities: {
    backfill: boolean;
    poll: boolean;
    webhook: 'signed' | 'unsigned' | 'none';
    bulkShare: boolean;
  };
  backfill(cursor?: string): AsyncIterable<Batch<TRaw>>;
  poll(watermark: Watermark): AsyncIterable<Batch<TRaw>>;
  onWebhook(req: Request): Promise<Invalidation[]>;
  normalize(raw: TRaw): CoreRecord[];
}

/**
 * What a surface must be able to say about a corpus it searched. An empty result list
 * reads as "no route exists" while only justifying "no route in the material available",
 * so the disclosure is part of the contract rather than a nicety.
 */
export interface Coverage {
  corpus: string;
  from: Date | null;
  to: Date | null;
  recordCount: number | null;
  /** Sources deliberately not inspected, and why. Rendered, not logged. */
  notInspected: Array<{ source: string; why: string }>;
}
