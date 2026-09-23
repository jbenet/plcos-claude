import { config } from '@/config/deployment';
import { finishRun, landRaw, latestRun, progressRun, startRun, type SyncRun } from '@/modules/sources';
import { AffinityError, AffinityRefused, type Query } from './client';
import { discovered, initForMatching, type AffinityList } from './discover';
import { affinity } from './index';
import { matchLists, spvCandidates } from './match';

/**
 * The first slice (N42, docs/15): what is on the lists we care about, landed raw.
 *
 * Which lists: the ones the init file names, and the ones that say SPV. What is read for each:
 *   - every entry, with its field values — for all of them;
 *   - relationship strengths to our team for each person — only on lists a vehicle claims.
 *
 * Notes are not read here any more. They come from the bulk read (N49, notes.ts): every note in
 * the account, a hundred to a request, where this read them one entry at a time.
 *
 * Two phases, because the cost is in the second. Entries come a hundred to a request, so
 * reading them is cheap, and it is how the number of people becomes known. Relationships are a
 * request per person: that part is estimated first, and a run whose estimate is over
 * `config.affinity.sliceCeiling` holds until somebody approves that estimate — an approval of
 * a number, not of whatever the run turns out to cost.
 *
 * Nothing here translates anything. A stage is still a string in a payload, an amount still a
 * number nobody has said the meaning of (CLAUDE.md, rules 1, 2 and 6).
 */

export interface SliceTarget {
  list: AffinityList;
  vehicleSlug: string | null;
  vehicleName: string | null;
  why: 'init' | 'spv';
  relationships: boolean;
}

const SOURCE = 'affinity';
const ALL_FIELDS: Query = { limit: 100, fieldTypes: ['enriched', 'global', 'list', 'relationship-intelligence'] };

export async function sliceTargets(): Promise<SliceTarget[]> {
  const [{ lists }, init] = await Promise.all([discovered(), initForMatching()]);
  if (!init) return [];
  const matches = matchLists(init, lists);
  const out: SliceTarget[] = [];
  const seen = new Set<number>();
  for (const m of matches) {
    if (!m.list || seen.has(m.list.id)) continue;
    const v = init.vehicles.find((x) => x.slug === m.vehicleSlug)!;
    seen.add(m.list.id);
    out.push({
      list: m.list, vehicleSlug: v.slug, vehicleName: v.name, why: 'init',
      relationships: m.list.type === 'person',
    });
  }
  for (const l of spvCandidates(lists, matches)) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ list: l, vehicleSlug: null, vehicleName: null, why: 'spv', relationships: false });
  }
  return out;
}

interface Entry {
  id: number;
  type: 'company' | 'person' | 'opportunity';
  listId: number;
  entity: { id: number };
}
export interface SliceOptions {
  /** A held run's estimate that a person approved. The run proceeds only within it. */
  approvedUpTo?: number;
  /** Entries only: relationship strengths wait for another run. */
  skipRelationships?: boolean;
  /** For the property harness. */
  ceiling?: number;
  overrides?: Parameters<typeof affinity>[0];
}

export async function runSlice(runBy: string | null, opts: SliceOptions = {}): Promise<SyncRun | null> {
  const ceiling = opts.ceiling ?? config.affinity.sliceCeiling;
  const run = await startRun(SOURCE, 'slice', runBy);
  let pages = 0;
  let records = 0;
  let fresh = 0;
  const detail: Record<string, unknown> = { ceiling };
  const gaps: string[] = [];
  const land = async (kind: string, sourceId: string, updatedAt: string | null, payload: unknown) => {
    records++;
    if (await landRaw({ source: SOURCE, kind, sourceId, sourceUpdatedAt: updatedAt ? new Date(updatedAt) : null, payload })) fresh++;
    if (records % 25 === 0) await progressRun(run, { requests: pages, records, newRecords: fresh, note: `${records} records so far` });
  };
  // The first fifty gaps are kept by name; past that a count is what anyone can act on.
  const finish = (status: 'ok' | 'failed' | 'held', note: string) =>
    finishRun(run, { status, requests: pages, records, newRecords: fresh, note, detail: { ...detail, gapCount: gaps.length, gaps: gaps.slice(0, 50) } });

  try {
    const client = affinity(opts.overrides);
    const targets = await sliceTargets();
    detail.lists = targets.map((t) => ({ id: t.list.id, why: t.why, vehicle: t.vehicleSlug, relationships: t.relationships }));
    if (targets.length === 0) {
      await finish('failed', 'No lists to read. Run discovery, and name the lists in the init file.');
      return latestRun(SOURCE, 'slice');
    }

    // Phase 1: entries, a hundred at a time.
    const wantRelationships = new Set<number>();
    const perList: Record<string, number> = {};
    for (const t of targets) {
      let n = 0;
      try {
        for await (const page of client.pages<Entry>(`/v2/lists/${t.list.id}/list-entries`, ALL_FIELDS)) {
          pages++;
          for (const e of page) {
            n++;
            await land('list_entry', `${t.list.id}:${e.id}`, null, e);
            if (t.relationships && !opts.skipRelationships && e.type === 'person') wantRelationships.add(e.entity.id);
          }
        }
      } catch (err) {
        if (err instanceof AffinityRefused) throw err;
        gaps.push(`entries on list ${t.list.id}: ${err instanceof AffinityError ? err.status : '?'}`);
      }
      perList[String(t.list.id)] = n;
    }
    detail.entries = perList;

    // Phase 2, estimated first: one request per person for their relationships.
    const estimate = wantRelationships.size;
    detail.estimate = estimate;
    detail.relationshipsFor = wantRelationships.size;
    const entryCount = Object.values(perList).reduce((a, b) => a + b, 0);
    const summary = `${entryCount} entries on ${targets.length} lists`;
    const allowed = opts.approvedUpTo ?? ceiling;
    const month = client.budget().perMonth;
    if (month && month !== 'none') detail.orgRemaining = month.remaining;
    if (estimate > allowed) {
      await finish('held', `${summary}. Relationships held: about ${estimate} requests, over the ${allowed} allowed without a go-ahead.`);
      return latestRun(SOURCE, 'slice');
    }

    let relationships = 0;
    for (const personId of wantRelationships) {
      try {
        // The first page is the strongest hundred; routing never needs the hundred-and-first.
        const page = await client.get<{ data?: unknown[] }>(`/v2/persons/${personId}/relationships`, { limit: 100 });
        pages++;
        relationships++;
        await land('relationship', String(personId), null, { personId, data: page.data ?? [] });
      } catch (err) {
        if (err instanceof AffinityRefused) throw err;
        gaps.push(`relationships for person ${personId}: ${err instanceof AffinityError ? err.status : '?'}`);
      }
    }
    detail.relationships = relationships;
    await finish('ok', `${summary} · ${relationships} relationship sets${gaps.length ? ` · ${gaps.length} gaps` : ''}`);
  } catch (err) {
    await finish('failed', err instanceof Error ? err.message : 'unknown error');
  }
  return latestRun(SOURCE, 'slice');
}

type G = typeof globalThis & { __affinitySlice?: Promise<unknown> | null };
const g = globalThis as G;

/**
 * A slice can take minutes, so it runs in this server's process while the page watches. One
 * at a time: a second press while one is running changes nothing.
 */
export function startSlice(runBy: string | null, opts: SliceOptions = {}): 'started' | 'already running' {
  if (g.__affinitySlice) return 'already running';
  g.__affinitySlice = runSlice(runBy, opts).finally(() => {
    g.__affinitySlice = null;
  });
  return 'started';
}

export const sliceRunning = () => Boolean(g.__affinitySlice);

/**
 * How many notes the account holds, from one request that returns none of them (N48). It
 * prices the bulk read (notes.ts) before anyone approves it: one request per hundred notes.
 */
export async function countNotes(runBy: string | null): Promise<SyncRun | null> {
  const run = await startRun(SOURCE, 'count-notes', runBy);
  try {
    const page = await affinity().get<{ pagination?: { totalCount?: number } }>('/v2/notes', { limit: 0, totalCount: 'true' });
    const total = page.pagination?.totalCount ?? null;
    await finishRun(run, {
      status: total === null ? 'failed' : 'ok', requests: 1, records: 0, newRecords: 0,
      note: total === null ? 'Affinity did not return a count.' : `${total} notes in the account`,
      detail: { total, bulkRequests: total === null ? null : Math.ceil(total / 100) },
    });
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 1, records: 0, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error' });
  }
  return latestRun(SOURCE, 'count-notes');
}
