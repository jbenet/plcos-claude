import type { Db } from '../db';
import type { ActivityPoint } from './types';
import { quantity, segment, utcDay } from './model';
import { covered, type Evidence, type Logged } from './backfill';
/** Aggregate in SQL; no names, record fields, paths or query text leave the database. */
export async function databaseActivity(db: Db, log: Logged): Promise<Evidence> {
  const points: ActivityPoint[] = [];
  const cutoff = log.cutoffs.get('affinity') ?? null;
  const requests = await db.query<{day: string; segment: string; requests: number}>(`
    select to_char(at at time zone 'UTC','YYYY-MM-DD') as day,
      case when endpoint like '%/relationships' then 'relationships'
           when endpoint like '/v2/auth/%' then 'authentication'
           else split_part(endpoint,'/',3) end as segment, count(*)::int as requests
    from sources.request_log where source='affinity' and outcome <> 'refused'
      and ($1::timestamptz is null or at < $1::timestamptz)
    group by 1,2`, [cutoff]);
  for (const r of requests) points.push({day: r.day, source:'affinity', segment:segment('affinity',r.segment), requests: Number(r.requests), bytesIn:null, bytesOut:null, records:0, estimated:false});
  const runs = await db.query<{id:string;at:string;kind:string;records:number}>(`
    select id::text, coalesce(finished_at,started_at)::text as at, kind, records
    from sources.sync_run where source='affinity'
      and ($1::timestamptz is null or started_at < $1::timestamptz)`, [cutoff]);
  const average = await payloadMean(db);
  for (const r of runs) {
    const day = utcDay(new Date(r.at).toISOString()); if (!day || covered(log,'affinity',r.at,r.id)) continue;
    points.push({day,source:'affinity',segment:segment('affinity',r.kind),requests:0,bytesIn:quantity(average?.bytes) === null ? null : Math.round(Number(r.records) * average!.bytes!),bytesOut:null,records:quantity(r.records),estimated:true,
      basis:'Sync record count × sampled mean stored JSON payload bytes; repeat transfers, response envelopes and request bytes were not measured.'});
  }
  const imports = await db.query<{at:string;action:string;records:number|null}>(`
    select to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, action,
      case action when 'enrich.imported' then case when jsonb_typeof(detail->'mapped')='number' then (detail->>'mapped')::float8 end
        when 'enrich.prospects' then case when jsonb_typeof(detail->'added')='number' then (detail->>'added')::float8 end
        when 'enrich.portfolio' then case when jsonb_typeof(detail->'rows')='number' then (detail->>'rows')::float8 end
        when 'init.loaded' then case when jsonb_typeof(detail->'people')='number' then (detail->>'people')::float8 end end as records
    from platform.audit_log where action in ('enrich.imported','enrich.prospects','enrich.portfolio','init.loaded')
      and ($1::timestamptz is null or at < $1::timestamptz)`, [log.cutoffs.get('intake') ?? null]);
  for (const r of imports) {
    const day = utcDay(r.at); if (!day) continue;
    points.push({day,source:'intake',segment:'imports',requests:0,bytesIn:null,bytesOut:null,records:quantity(r.records),estimated:true,
      basis:'Import audit count: mapped findings, added prospects, portfolio rows or initialized people; total entries and byte counts may be incomplete.'});
  }
  return {points,origins:[]};
}

/**
 * The mean stored Affinity payload, from a 5% block sample (the full mean read all 430K payloads, 1 s; the sample
 * still 0.2–0.3 s), worked out again only when raw records were added: this evidence is rebuilt after every write
 * (15 Oct 2026). A table too small to sample falls back to the full mean.
 */
const payloadMemo = new WeakMap<Db, { key: string; bytes: number | null }>();
async function payloadMean(db: Db): Promise<{ bytes: number | null }> {
  const key = (await db.one<{ k: string }>(`select coalesce(max(id),0)::text k from sources.raw_record`))!.k;
  const memo = payloadMemo.get(db);
  if (memo?.key === key) return { bytes: memo.bytes };
  const row = await db.one<{bytes:number|null}>(`select coalesce(
      (select avg(octet_length(payload::text)) from sources.raw_record tablesample system (5) repeatable (1) where source='affinity'),
      (select avg(octet_length(payload::text)) from sources.raw_record where source='affinity'))::float8 as bytes`);
  payloadMemo.set(db, { key, bytes: row?.bytes ?? null });
  return { bytes: row?.bytes ?? null };
}

/** Fixed metadata aggregates; these tables do not participate in network.read_revision. */
export async function databaseGeneration(db: Db): Promise<string> {
  const row = await db.one<{generation:string}>(`select
    (select coalesce(max(id),0)::text from sources.request_log) || ':' ||
    (select coalesce(max(id),0)::text from sources.raw_record) || ':' ||
    (select coalesce(max(id),0)::text from platform.audit_log) || ':' ||
    (select coalesce(max(id),0)::text || ':' || coalesce(max(finished_at)::text,'') from sources.sync_run)
    as generation`);
  return row!.generation;
}
