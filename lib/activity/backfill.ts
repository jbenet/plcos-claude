import { config } from '../../config/deployment';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { foldRuns } from '../workflows/ledger';
import { host, quantity, segment, utcDay } from './model';
import { runKey } from './log';
import type { ActivityPoint, ActivitySource, OriginCount } from './types';

type Obj = Record<string, any>; // Private source documents are narrowed at every output boundary.
export type Evidence = { points: ActivityPoint[]; origins: OriginCount[] };
export type Logged = Evidence & { cutoffs: Map<string, string>; runs: Set<string> };
export async function names(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
export async function contents(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; }
}
async function json(path: string): Promise<Obj | null> { try { return JSON.parse(await contents(path)); } catch { return null; } }
async function size(path: string): Promise<number | null> { try { return (await stat(path)).size; } catch { return null; } }
export async function readLog(root: string): Promise<Logged> {
  const out: Logged = { points: [], origins: [], cutoffs: new Map(), runs: new Set() }, ids = new Set<string>();
  for (const f of await names(join(root, 'activity'))) {
    if (!/^\d{4}-\d\d-\d\d\.jsonl$/.test(f)) continue;
    const lines = (await contents(join(root, 'activity', f))).split('\n'); lines.pop();
    for (const line of lines) { try {
      const r = JSON.parse(line), day = utcDay(r.at);
      if (!day || !['affinity','warehouse','dakota','intake','search','fetch','sec','agents'].includes(r.source) || typeof r.id !== 'string' || ids.has(r.id)) continue;
      ids.add(r.id);
      const key = r.source;
      if (!out.cutoffs.has(key) || r.at < out.cutoffs.get(key)!) out.cutoffs.set(key, r.at);
      if (typeof r.run === 'string' && /^[a-f0-9]{64}$/.test(r.run)) out.runs.add(`${r.source}:${r.run}`);
      out.points.push({ day, source: r.source, segment: segment(r.source, r.segment), requests: quantity(r.requests), bytesIn: quantity(r.bytesIn), bytesOut: quantity(r.bytesOut), records: quantity(r.records), estimated: r.estimated === true,
        ...(r.estimated ? { basis: r.source === 'agents' ? `GUESS: UTF-8 bytes = tokens × ${config.activity.bytesPerToken}; input includes cache and output includes reasoning.` : r.source === 'warehouse' ? 'CLI attempts and JSON/SQL UTF-8 payload bytes; not measured network traffic.' : 'Estimated from recorded counts or payload sizes; not measured network traffic.' } : {}) });
      const origin = host(r.origin);
      if (origin && ['search','fetch','sec'].includes(r.source) && quantity(r.requests) !== null) out.origins.push({ day, origin, requests: r.requests, estimated: r.estimated === true });
    } catch { /* Torn/malformed lines cannot become counts or leak text. */ } }
  }
  return out;
}
export function covered(log: Logged, source: ActivitySource, at: string, id?: string): boolean {
  if (id) return log.runs.has(`${source}:${runKey(id)}`);
  // Historical producers without stable execution IDs switch over at instrumentation time.
  return Boolean(log.cutoffs.get(source) && at >= log.cutoffs.get(source)!);
}
export async function backfill(root: string, log: Logged): Promise<Evidence> {
  const points: ActivityPoint[] = [], origins: OriginCount[] = [];
  const add = (source: ActivitySource, at: unknown, values: Partial<ActivityPoint>, basis: string, id?: string) => {
    const day = utcDay(at); if (!day || (values.segment !== 'files' && covered(log, source, String(at), id))) return;
    points.push({ day, source, segment: null, requests: null, bytesIn: null, bytesOut: null, records: null, estimated: true, ...values, basis });
  };
  const manifests = await names(join(root, 'dakota/raw'));
  const dakotaManifests: Array<{ runId: string | null; at: number; requests: number | null }> = [];
  const rememberDakota = (m: Obj) => {
    if (utcDay(m.at)) dakotaManifests.push({ runId: typeof m.runId === 'string' ? m.runId : null,
      at: Date.parse(m.at), requests: quantity(m.requests) });
  };
  for (const f of manifests.filter(f => f.endsWith('.manifest.json'))) {
    const m = await json(join(root, 'dakota/raw', f)); if (!m || !utcDay(m.at)) continue;
    rememberDakota(m);
    const stamp = f.replace('.manifest.json', '');
    add('dakota', m.at, { requests: quantity(m.requests), bytesIn: 0, bytesOut: null, records: 0, estimated: false }, 'Manifest request total is recorded; outbound bytes were not recorded.', m.runId);
    for (const kind of ['account','contact']) if (m.modules?.[kind]) add('dakota', m.at,
      { segment: kind, requests: 0, bytesIn: await size(join(root, 'dakota/raw', kind, `${stamp}.jsonl`)), bytesOut: 0, records: quantity(m.modules[kind].written) },
      'Manifest written count; saved JSONL bytes approximate response bytes, excluding protocol overhead.', m.runId);
  }
  for (const f of (await names(join(root, 'dakota'))).filter(f => /^test-.*\.json$/.test(f))) {
    const m = await json(join(root, 'dakota', f)); if (m) {
      rememberDakota(m);
      add('dakota', m.at, { requests: quantity(m.requests), records: 0 }, 'Recorded test requests; inventory count is not records pulled.', m.runId);
    }
  }
  let warehousePages = 0;
  const warehouse = await json(join(root, 'enrich/warehouse/graph-manifest.json'));
  if (warehouse) {
    const seen = new Set<string>();
    for (const p of Array.isArray(warehouse.inputPages) ? warehouse.inputPages : []) {
      if (typeof p.queryHash !== 'string' || !/^(?:[a-f0-9]{24}|[a-f0-9]{64})$/.test(p.queryHash) || seen.has(p.queryHash)) continue;
      seen.add(p.queryHash);
      if (utcDay(p.retrievedAt ?? warehouse.asOf)) warehousePages++;
      add('warehouse', p.retrievedAt ?? warehouse.asOf, { segment: 'graph', requests: 1, bytesIn: await size(join(root, 'enrich/warehouse/pages', `${p.queryHash}.json`)), records: quantity(p.rows) },
        'One request per unique cached query page; resume may reuse pages. File bytes approximate response bytes. Rows are recorded.');
    }
  }
  for (const f of (await names(join(root, 'enrich/raw'))).filter(f => f.endsWith('.json'))) {
    const r = await json(join(root, 'enrich/raw', f)); if (!r || !utcDay(r.researched?.at)) continue;
    const at = r.researched.at, day = utcDay(at)!;
    if (Array.isArray(r.queries)) add('search', at, { segment: 'queries', requests: r.queries.length, bytesOut: Buffer.byteLength(JSON.stringify(r.queries), 'utf8'), records: r.queries.length }, 'One request per saved query; serialized query bytes approximate outbound payload. Retries and result counts unrecorded. Search provider host unknown.');
    const urls = new Set<string>();
    const take = (v: unknown) => { if (typeof v === 'string' && host(v)) { try { const u = new URL(v); u.hash = ''; urls.add(u.href); } catch {} } };
    for (const fact of Array.isArray(r.facts) ? r.facts : []) take(fact?.source?.url);
    for (const link of Array.isArray(r.identity?.links) ? r.identity.links : []) take(link?.url);
    for (const connection of Array.isArray(r.connections) ? r.connections : []) take(connection?.source);
    for (const signal of Array.isArray(r.profile?.signals) ? r.profile.signals : []) take(signal?.source);
    for (const url of urls) {
      const origin = host(url)!, source = origin === 'sec.gov' || origin.endsWith('.sec.gov') ? 'sec' : 'fetch';
      if (covered(log, source, at)) continue;
      add(source, at, { requests: 1, records: 1 }, 'One fetch per distinct cited URL within a finding; citation may come from search. Research date used; W1c refetches and retries unknown.');
      origins.push({ day, origin, requests: 1, estimated: true });
    }
  }
  // Intake is physical files; import audit rows are separate writes, not another file pull.
  async function intake(dir: string): Promise<void> {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await intake(path);
      else if (entry.isFile()) { const s = await stat(path); add('intake', s.mtime.toISOString(), { segment: 'files', requests: 0, bytesIn: s.size, bytesOut: 0, records: 1 }, 'File size measured; modification date stands in for intake date. One record per file.'); }
    }
  }
  await intake(join(root, 'intake'));
  const ledger = foldRuns(await contents(join(root, 'workflows/runs.jsonl')));
  const usableRuns = ledger.runs.filter(run => !run.conflict && run.start);
  const representedDakota = new Set(dakotaManifests.flatMap(m => m.runId ? [m.runId] : []));
  const descriptorOf = (r: NonNullable<(typeof usableRuns)[number]['start']>) => `${r.workflow ?? ''} ${r.operation} ${r.protocol.version ?? ''}`;
  const dakotaRequests = (method: string | undefined): number | null => {
    const match = /script: (\d+) Dakota requests/.exec(method ?? '');
    return match ? quantity(Number(match[1])) : null;
  };
  // GUESS: old producers normally wrote the manifest immediately before finishing.
  // Require a unique, count-matched run within one minute; a shared day is no identity.
  const candidates = dakotaManifests.filter(m => !m.runId).map(m => ({ m, runs: usableRuns.filter(run => {
    const r = run.finish;
    if (!r?.endedAt || !r.startedAt || !/dakota/i.test(descriptorOf(r)) || m.requests === null
      || dakotaRequests(r.usage?.method) !== m.requests) return false;
    const untilEnd = Date.parse(r.endedAt) - m.at;
    return m.at >= Date.parse(r.startedAt) && untilEnd >= 0 && untilEnd <= config.activity.legacyMatchWindowMs;
  }) }));
  for (const candidate of candidates) if (candidate.runs.length === 1) {
    const id = candidate.runs[0]!.runId;
    // Competing manifests or overlapping executions remain an explicit estimate.
    if (!representedDakota.has(id) && candidates.filter(c => c.runs.some(r => r.runId === id)).length === 1) representedDakota.add(id);
  }
  const representedWarehouse = new Set<string>();
  if (warehousePages && warehouse) {
    if (typeof warehouse.runId === 'string') representedWarehouse.add(warehouse.runId);
    else if (utcDay(warehouse.asOf)) {
      // asOf is the graph extraction's start, not the oldest page reused by --resume.
      const at = Date.parse(warehouse.asOf);
      const graphRuns = usableRuns.filter(run => {
        const r = run.finish;
        return r?.startedAt && r.endedAt && /\bwgraph\b|warehouse[-_ ]graph/i.test(descriptorOf(r))
          && Date.parse(r.startedAt) <= at && at <= Date.parse(r.endedAt);
      });
      if (graphRuns.length === 1) representedWarehouse.add(graphRuns[0]!.runId);
    }
  }
  const estimates = new Map<string, Obj>();
  for (const line of (await contents(join(root, 'workflows/usage-estimates.jsonl'))).split('\n')) { try { const r = JSON.parse(line); if (typeof r.runId === 'string') estimates.set(r.runId, r); } catch {} }
  for (const run of ledger.runs) {
    if (run.conflict) continue;
    const r = run.finish ?? run.start; if (!r) continue;
    const at = r.endedAt ?? r.startedAt;
    if (r.source !== 'script' && r.source !== 'app') {
      const u = r.usage, e = estimates.get(run.runId);
      const input = quantity(u?.input) ?? quantity(e?.input), output = quantity(u?.output) ?? quantity(e?.output);
      add('agents', at, { segment: segment('agents', r.workflow), requests: null, bytesIn: output === null ? null : output * config.activity.bytesPerToken, bytesOut: input === null ? null : input * config.activity.bytesPerToken, records: quantity(r.counts.written) },
        `GUESS: UTF-8 bytes = tokens × ${config.activity.bytesPerToken}; input includes cache and output includes reasoning. Run end date (start if unfinished); requests unknown.`, run.runId);
    }
    const descriptor = `${r.workflow ?? ''} ${r.operation} ${r.protocol.version ?? ''}`;
    if (/warehouse|polaris|wgraph|winv/i.test(descriptor) && !representedWarehouse.has(run.runId)) add('warehouse', at, { records: quantity(r.counts.written) }, 'Workflow ledger fallback; no unambiguous graph-manifest match. Written entries only; query requests, rows and bytes unrecorded. Possible overlap is unresolved.', run.runId);
    if (/dakota/i.test(descriptor) && !representedDakota.has(run.runId)) {
      add('dakota', at, { requests: dakotaRequests(r.usage?.method), records: quantity(r.counts.written) }, 'Workflow ledger fallback; no unambiguous manifest match. Request count from recorded usage method; bytes unrecorded. Possible overlap is unresolved.', run.runId);
    }
  }
  return { points, origins };
}
