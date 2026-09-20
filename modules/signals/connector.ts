import { fixtureConnector } from '@/lib/connectors/fixture';
import type { Connector, CoreRecord } from '@/lib/connectors/types';

export interface RawSignal {
  source_key: string;
  entity: string;
  kind: string;
  headline: string;
  detail: string;
  source: string;
  source_ref: string;
  observed_at: string;
  confidence: 'high' | 'medium' | 'low';
  threshold_label: string;
  threshold_detail: string;
}

/**
 * The first real use of the Connector seam.
 *
 * It reads `fixtures/signals.json`, but it does so through the same four-method contract
 * that Affinity and EDGAR will implement at L13 — including normalize(), which produces
 * CoreRecords carrying the provenance tuple. When a real source arrives, the ingest code
 * below does not change; only the connector does.
 */
export function signalConnector(): Connector<RawSignal> {
  return fixtureConnector<RawSignal>('signals-fixture', 'signals.json', (raw): CoreRecord[] => [
    {
      kind: 'signal',
      sourceId: raw.source_key,
      fields: {
        entity: raw.entity,
        signalKind: raw.kind,
        headline: raw.headline,
        detail: raw.detail,
        sourceRef: raw.source_ref,
        observedAt: raw.observed_at,
        thresholdLabel: raw.threshold_label,
        thresholdDetail: raw.threshold_detail,
      },
      provenance: {
        source: raw.source,
        asOf: new Date(raw.observed_at),
        confidence: raw.confidence,
        lastVerifiedBy: null,
      },
    },
  ]);
}
