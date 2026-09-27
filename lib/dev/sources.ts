import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import type { RunView } from '@/lib/workflows/view';

/**
 * The read-only sources Developer → Status lists beside Affinity (issue 0099): Dakota, PL Polaris,
 * the PL Data Warehouse, and Linear (docs/24-linear.md), which this server syncs itself. Neither is read by this server over a network: Dakota lands in a
 * local replica through a workflow (scripts/dakota-sync.ts), Polaris through workflows querying
 * BigQuery with the local MCP Toolbox. So this reads what they left behind — counts and times only.
 * Never a Dakota field value: the manifests carry counts, and the database is asked for counts.
 */

export type SourceState = 'ok' | 'partial' | 'not_attached' | 'failed';
export interface ExtraSource {
  key: 'dakota' | 'polaris' | 'linear';
  label: string;
  access: string;
  state: SourceState;
  /** Short facts, each a count or a date, never a record. */
  facts: string[];
  lastAt: Date | null;
  lastWhat: string | null;
  note: string;
}

const n = (x: number) => x.toLocaleString('en-GB');
async function count(sql: string): Promise<number | null> {
  try {
    const db = await getDb();
    const rows = await db.query<{ n: string | number }>(sql);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

interface Manifest { at: string; requests?: number; modules?: Record<string, { expected?: number; written?: number; error?: string }> }

/** Dakota: the replica's manifests, the database's counts, and the last import in the audit log. */
export async function dakotaStatus(): Promise<ExtraSource> {
  const raw = join(process.cwd(), config.data.root, 'dakota', 'raw');
  const manifests: Manifest[] = [];
  let folder = true;
  try {
    for (const f of (await readdir(raw)).filter((x) => /^[-\dTZ]+\.manifest\.json$/.test(x)).sort()) {
      try {
        const m = JSON.parse(await readFile(join(raw, f), 'utf8')) as Manifest;
        if (Number.isFinite(Date.parse(m.at))) manifests.push({ at: m.at, requests: m.requests, modules: m.modules });
      } catch { /* an unreadable manifest is not a pull */ }
    }
  } catch {
    folder = false;
  }
  const [accounts, contacts, entities, last] = await Promise.all([
    count('select count(*) as n from dakota.account'),
    count('select count(*) as n from dakota.contact'),
    count("select count(*) as n from identity.source_record where source = 'dakota'"),
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.query<{ at: Date | string; action: string; detail: Record<string, unknown> }>(
          "select at, action, detail from platform.audit_log where action like 'dakota.%' order by at desc limit 1",
        );
        return rows[0] ?? null;
      } catch { return null; }
    })(),
  ]);
  const latest = manifests.at(-1);
  const complete = [...manifests].reverse().find((m) => m.modules && Object.values(m.modules).every((x) => !x.error && x.written === x.expected));
  const pulled = complete?.modules ?? {};
  const failedLast = latest && latest !== complete;
  const facts = [
    complete ? `Last complete pull: ${Object.entries(pulled).map(([k, v]) => `${n(v.written ?? 0)} ${k}s`).join(', ')}` : null,
    accounts || contacts ? `In the database: ${n(accounts ?? 0)} accounts, ${n(contacts ?? 0)} contacts${entities ? `, ${n(entities)} linked records` : ''}` : null,
    last ? `Last import ${new Date(last.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${['sourced', 'merged', 'claims'].filter((k) => typeof last.detail?.[k] === 'number').map((k) => `${n(last.detail[k] as number)} ${k}`).join(', ') || 'recorded'}` : null,
  ].filter((x): x is string => Boolean(x));
  const state: SourceState = !folder && !accounts ? 'not_attached' : failedLast ? 'partial' : complete ? 'ok' : manifests.length ? 'failed' : 'not_attached';
  return {
    key: 'dakota', label: 'Dakota Marketplace', access: 'Read-only · local replica, pulled by a workflow',
    state, facts: facts.length ? facts : [config.data.profile === 'demo' ? 'The demo has no Dakota replica' : 'No replica in this data folder'],
    lastAt: complete ? new Date(complete.at) : latest ? new Date(latest.at) : null,
    lastWhat: failedLast ? 'the latest pull stopped early; the one before is complete' : complete ? 'last complete pull' : null,
    note: 'Counts only. Dakota records stay in the replica and the database, and never leave them (docs/20-dakota.md).',
  };
}

const WAREHOUSE = /warehouse|polaris|wgraph|winv/i;

/** Polaris: what the warehouse workflows recorded, the graph they left, and the records it added. */
export async function polarisStatus(runs: RunView[]): Promise<ExtraSource> {
  const reads = runs.filter((r) => WAREHOUSE.test(`${r.workflow} ${r.operation} ${r.version ?? ''}`));
  const lastRun = reads.find((r) => r.startedAt) ?? null;
  let graph: { asOf: string; pages: number; rows: number } | null = null;
  try {
    const m = JSON.parse(await readFile(join(process.cwd(), config.data.root, 'enrich', 'warehouse', 'graph-manifest.json'), 'utf8')) as {
      asOf?: string; inputPages?: Array<{ rows?: number }>;
    };
    if (m.asOf && Number.isFinite(Date.parse(m.asOf))) {
      graph = { asOf: m.asOf, pages: m.inputPages?.length ?? 0, rows: (m.inputPages ?? []).reduce((s, p) => s + (p.rows ?? 0), 0) };
    }
  } catch { /* no graph read here */ }
  const records = await count("select count(*) as n from identity.source_record where source = 'warehouse'");
  const facts = [
    reads.length ? `${reads.length} workflow run${reads.length === 1 ? '' : 's'} read it${lastRun ? `, the last ${lastRun.outcome === 'succeeded' ? 'succeeded' : `ended ${lastRun.outcome}`}` : ''}` : null,
    graph ? `Graph read: ${n(graph.pages)} query pages, ${n(graph.rows)} rows` : null,
    records ? `${n(records)} people and organisations in the database came from it` : null,
  ].filter((x): x is string => Boolean(x));
  const when = [lastRun?.startedAt ?? null, graph ? new Date(graph.asOf) : null].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    key: 'polaris', label: 'PL Data Warehouse (Polaris)', access: 'Read-only · BigQuery through the local MCP Toolbox, SELECT only, bytes capped',
    state: facts.length ? (lastRun && ['failed', 'unavailable', 'refused'].includes(lastRun.outcome) ? 'partial' : 'ok') : 'not_attached',
    facts: facts.length ? facts : [config.data.profile === 'demo' ? 'The demo does not read the warehouse' : 'No warehouse read recorded here'],
    lastAt: when, lastWhat: when ? 'last read' : null,
    note: 'This server never queries it: workflows do, as pl-polaris (npm run polaris:connect), and write what they read under plcos-data/real.',
  };
}

/** Linear: this server syncs it (Developer → Linear); the manifests and the replica's counts say how far. */
export async function linearStatus(): Promise<ExtraSource> {
  const { rawDir } = await import('@/lib/connectors/linear/sync');
  const { readManifests } = await import('@/lib/connectors/linear/replica');
  const { linearKeyPresent } = await import('@/lib/connectors/linear/key');
  const manifests = await readManifests(rawDir());
  const [issues, projects, teams] = await Promise.all([
    count('select count(*) as n from linear.issue where archived_at is null'),
    count('select count(*) as n from linear.project where archived_at is null'),
    count('select count(*) as n from linear.team where archived_at is null'),
  ]);
  const latest = manifests.at(-1);
  const complete = [...manifests].reverse().find((m) => m.complete);
  const facts = [
    issues || projects ? `In the database: ${n(issues ?? 0)} issues, ${n(projects ?? 0)} projects, ${n(teams ?? 0)} teams` : null,
    complete ? `Last complete sync: ${n(complete.records)} records in ${n(complete.requests)} requests${complete.since ? ', changes only' : ', everything'}` : null,
    latest?.budget?.requestsLeft != null && latest.budget.requestsLimit ? `Hourly budget after the last sync: ${n(latest.budget.requestsLeft)} of ${n(latest.budget.requestsLimit)} requests left` : null,
  ].filter((x): x is string => Boolean(x));
  const demo = config.data.profile === 'demo';
  const failedLast = Boolean(latest && latest !== complete);
  const state: SourceState = !latest ? 'not_attached' : failedLast ? (complete ? 'partial' : 'failed') : 'ok';
  return {
    key: 'linear', label: 'Linear',
    access: demo ? 'Read-only · an invented workspace, read through the real client' : 'Read-only · GraphQL queries only, synced by this server',
    state,
    facts: facts.length ? facts : [demo ? 'Not synced yet: Sync Linear on Developer → Linear' : linearKeyPresent() ? 'Key present; not synced yet' : 'Not synced here: no key, or not the live server'],
    lastAt: complete ? new Date(complete.at) : latest ? new Date(latest.at) : null,
    lastWhat: failedLast ? 'the latest sync stopped early' : complete ? 'last complete sync' : null,
    note: 'Counts only. Queries only: the client refuses any mutation (docs/24-linear.md).',
  };
}
