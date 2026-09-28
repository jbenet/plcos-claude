import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { readLayout } from '@/config/ports';
import { httpsTransport, linearClient, type LinearTransport } from './client';
import { fixtureTransport } from './fixture';
import { linearKey } from './key';
import { pullLinear } from './pull';
import { readReplicas, TABLE } from './replica';
import { scopeReplicas } from './scope';
import { recordActivity } from '@/lib/activity/log';
import { translateLinear } from './translate';

/**
 * Sync Linear: pull what changed into the raw replica, then translate it into the `linear` schema
 * (docs/24-linear.md). Runs as the `linear` import job, started by a person's click on Developer →
 * Linear. The real workspace is read only by the live server, which alone holds the key and alone
 * writes the real database; the demo reads an invented workspace through the same client.
 */

export const rawDir = (root: string = config.data.root): string => join(root, 'linear', 'raw');

/** The live server, or a Postgres rehearsal of it. Never a preview copy or a dev checkout. */
export function linearLiveServer(): boolean {
  return config.data.profile === 'real'
    && ((!config.data.copyTakenAt && readLayout().role === 'live') || Boolean(config.db.url && process.env.POSTGRES_REHEARSAL === '1'));
}

export const LINEAR_REFUSAL = {
  notLive: 'Sync Linear from Developer → Linear on the live server; a copy or a dev checkout does not read Linear.',
  noKey: 'No Linear key reached this server. Store it with npm run linear:store, then restart the live server (npm run dev:real) and allow the Keychain to hand it over.',
} as const;

/** Which Linear this server reads, or why it reads none. */
export function linearSource(): { transport: LinearTransport; key: string } | { refused: string } {
  if (config.data.profile === 'demo') return { transport: fixtureTransport(), key: 'demo-fixture' };
  if (!linearLiveServer()) return { refused: LINEAR_REFUSAL.notLive };
  const key = linearKey();
  return key ? { transport: httpsTransport(), key } : { refused: LINEAR_REFUSAL.noKey };
}

export type Progress = (phase: string, done?: number, total?: number | null) => Promise<void>;

export interface SyncResult {
  requests: number; records: number; files: number; inserted: number; updated: number; unchanged: number;
  incremental: number; complete: number;
}

export async function syncLinear(db: Db, actor: string, opts: { full?: boolean; progress?: Progress; source?: { transport: LinearTransport; key: string }; root?: string; runId?: string } = {}): Promise<SyncResult> {
  const src = opts.source ?? linearSource();
  if ('refused' in src) throw new Error(src.refused);
  const progress = opts.progress ?? (async () => {});
  const dir = rawDir(opts.root);
  const scoped = scopeReplicas(await readReplicas(dir),config.linear.teams);
  const referencedUserIds = scoped.flatMap(r => r.records.flatMap(row => r.entity === 'users' ? [row.id] : ['lead_id','assignee_id','creator_id','user_id'].flatMap(col => typeof row[col] === 'string' ? [row[col] as string] : [])));
  const client = linearClient({ referencedUserIds, teams:config.linear.teams, activityRoot:opts.root, transport: src.transport, key: src.key, limits: config.linear, runId: opts.runId });
  try {
    await progress('Reading Linear', 0, 3);
    const manifest = await pullLinear(client, dir, { full: opts.full, pageSize: config.linear.pageSize, overlapMs: config.linear.overlapMs,
      onEntity: (e) => progress(`Reading Linear: ${e}`, 0, 3) });
    await progress('Translating the replica', 1, 3);
    const counts = await translateLinear(db, actor, await readReplicas(dir), { batch: config.linear.translateBatch,
      onBatch: (done, total) => progress(`Translating the replica: ${done} of ${total} records`, 1, 3) });
    await progress('Recording the sync', 2, 3);
    const detail = `${manifest.complete ? 'Read-only sync' : 'Partial sync'} · ${manifest.records} records in ${manifest.requests} requests · ${counts.inserted} new, ${counts.updated} changed`;
    await db.query(`insert into platform.source_sync (source, label, status, last_sync_at, detail) values ('linear','Linear',$1::platform.sync_status,now(),$2)
      on conflict (source) do update set status = excluded.status, last_sync_at = excluded.last_sync_at, detail = excluded.detail`,
      [manifest.complete ? 'ok' : 'stale', detail]);
    await db.query(`insert into platform.audit_log (actor_id, action, subject_type, detail) values ($1,'linear.synced','linear',$2::jsonb)`,
      [actor, JSON.stringify({ requests: manifest.requests, records: manifest.records, complete: manifest.complete, since: manifest.since, ...counts })]);
    if (!manifest.complete) throw new Error('Linear stopped before every entity was read; what was read is kept.');
    return { requests: manifest.requests, records: manifest.records, ...counts, incremental: manifest.since ? 1 : 0, complete: 1 };
  } catch (err) {
    await db.query(`insert into platform.source_sync (source, label, status, detail) values ('linear','Linear','failed',$1)
      on conflict (source) do update set status = 'failed', detail = excluded.detail`,
      ['The last sync stopped. What was read before it is kept; sync again from Developer → Linear.']).catch(() => {});
    // Fixed words only: a lower-level message could carry a record.
    throw new Error(err instanceof Error && Object.values(LINEAR_REFUSAL).includes(err.message as never) ? err.message : 'Linear sync stopped.');
  }
}

/** Local purge and replay. The import worker serializes this with normal Linear syncs. */
export async function rebuildLinear(db: Db, actor: string | null, opts: { root?: string; teams?: readonly string[]; progress?: Progress; runId?: string } = {}) {
  if (config.data.profile !== 'demo' && !linearLiveServer()) throw new Error(LINEAR_REFUSAL.notLive);
  const teams = opts.teams ?? config.linear.teams;
  const dir = rawDir(opts.root);
  await opts.progress?.('Filtering the saved Linear replica',0,3);
  const {purgeRawReplicas} = await import('./purge');
  const purged = await purgeRawReplicas(dir,teams);
  const replicas = await readReplicas(dir);
  await opts.progress?.('Rebuilding Linear tables',1,3);
  // Truncate and replay commit together; readers never see a half-rebuilt schema.
  const counts = await db.transaction(async tx => {
    await tx.exec(`truncate table ${[...Object.values(TABLE),'replica'].map(t => `linear.${t}`).join(',')}`);
    const nested: Db = {...tx,kind:db.kind, query:tx.query.bind(tx),one:tx.one.bind(tx),exec:tx.exec.bind(tx),
      transaction: async fn => fn(tx),close:async () => {}};
    return translateLinear(nested,actor,replicas,{batch:config.linear.translateBatch,teams});
  });
  const result = {requests:0,records:replicas.reduce((n,r) => n+r.records.length,0),...counts,...purged};
  await db.query(`insert into platform.audit_log (actor_id,action,subject_type,detail) values ($1,'linear.rebuilt','linear',$2::jsonb)`,[actor,JSON.stringify(result)]);
  await recordActivity({source:'linear',segment:'rebuild',runId:opts.runId,requests:0,bytesIn:0,bytesOut:0,records:result.records},opts.root);
  await opts.progress?.('Linear rebuilt from the filtered replica',3,3);
  return result;
}
