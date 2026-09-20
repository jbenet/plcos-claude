import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import type { Disposition, Signal, SignalKind } from './types';

type Row = {
  signal_id: string; entity_id: string | null; entity_name: string | null;
  kind: SignalKind; headline: string; detail: string | null; source: string;
  source_ref: string | null; observed_at: Date | string;
  confidence: 'high' | 'medium' | 'low'; threshold_label: string;
  threshold_detail: string; disposition: Disposition;
  claimed_by_name: string | null; note: string | null;
};

const SELECT = `
  select s.signal_id, s.entity_id, e.display_name as entity_name, s.kind, s.headline,
         s.detail, s.source, s.source_ref, s.observed_at, s.confidence, s.threshold_label,
         s.threshold_detail, s.disposition, u.name as claimed_by_name, s.note
    from signals.signal s
    left join identity.entity e on e.entity_id = s.entity_id
    left join platform.app_user u on u.id = s.claimed_by`;

const DAY = 86_400_000;

const toSignal = (r: Row): Signal => {
  const observedAt = new Date(r.observed_at);
  return {
    signalId: r.signal_id, entityId: r.entity_id, entityName: r.entity_name,
    kind: r.kind, headline: r.headline, detail: r.detail, source: r.source,
    sourceRef: r.source_ref, observedAt, confidence: r.confidence,
    thresholdLabel: r.threshold_label, thresholdDetail: r.threshold_detail,
    disposition: r.disposition, claimedByName: r.claimed_by_name, note: r.note,
    fresh: Date.now() - observedAt.getTime() <= config.signals.freshDays * DAY,
  };
};

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Above the confidence floor, fresh, and nobody has dealt with it yet. */
export async function actionableSignals(limit = 8): Promise<Signal[]> {
  const db = await getDb();
  const rows = await db.query<Row>(
    `${SELECT} where s.disposition = 'new' order by s.observed_at desc limit $1`,
    [limit * 2],
  );
  const floor = RANK[config.signals.minConfidence];
  return rows.map(toSignal).filter((s) => s.fresh && RANK[s.confidence] >= floor).slice(0, limit);
}

/** Everything, including what the thresholds held back — so the floor is visible. */
export async function allSignals(): Promise<Signal[]> {
  const db = await getDb();
  return (await db.query<Row>(`${SELECT} order by s.observed_at desc`)).map(toSignal);
}

export async function signalsFor(entityId: string): Promise<Signal[]> {
  const db = await getDb();
  return (
    await db.query<Row>(`${SELECT} where s.entity_id = $1 order by s.observed_at desc`, [entityId])
  ).map(toSignal);
}

export async function heldBack(): Promise<Signal[]> {
  const floor = RANK[config.signals.minConfidence];
  return (await allSignals()).filter((s) => RANK[s.confidence] < floor || !s.fresh);
}

export async function setDisposition(
  actorId: string, signalId: string, disposition: Disposition, note: string | null,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `update signals.signal
          set disposition = $2::signals.disposition,
              claimed_by = $3, claimed_at = now(), note = $4
        where signal_id = $1`,
      [signalId, disposition, actorId, note],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'signal', $3, $4)`,
      [actorId, `signal.${disposition}`, signalId, JSON.stringify({ note })],
    );
  });
}

/**
 * Pull from the connector and write anything new. Idempotent on `source_key`, which is
 * the fixture's stand-in for (source, source_id, source_updated_at).
 */
export async function ingestSignals(): Promise<{ read: number; inserted: number }> {
  const { signalConnector } = await import('./connector');
  const db = await getDb();
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const byName = new Map(entities.map((e) => [e.display_name, e.entity_id]));

  const connector = signalConnector();
  let read = 0;
  let inserted = 0;

  for await (const batch of connector.backfill()) {
    for (const raw of batch.records) {
      read += 1;
      for (const record of connector.normalize(raw)) {
        const f = record.fields as Record<string, string>;
        const rows = await db.query<{ signal_id: string }>(
          `insert into signals.signal
             (entity_id, kind, headline, detail, source, source_ref, observed_at, confidence,
              threshold_label, threshold_detail, source_key)
           values ($1,$2::signals.signal_kind,$3,$4,$5,$6,$7,$8::research.confidence,$9,$10,$11)
           on conflict (source_key) do nothing
           returning signal_id`,
          [
            byName.get(f['entity'] ?? '') ?? null, f['signalKind'], f['headline'], f['detail'],
            record.provenance.source, f['sourceRef'], record.provenance.asOf,
            record.provenance.confidence, f['thresholdLabel'], f['thresholdDetail'],
            record.sourceId,
          ],
        );
        if (rows.length > 0) inserted += 1;
      }
    }
  }

  return { read, inserted };
}
