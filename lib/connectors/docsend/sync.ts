import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { partiesOf, PUBLIC_MAIL } from '@/lib/calendar-sync';
import type { Db } from '@/lib/db';
import type { ImportProgress } from '@/lib/import-jobs/types';
import {
  applyVehicleMap, markSpaceRead, noteConnectionError, setViewers, spaceReadThrough, upsertSpaces, upsertVisits, viewerEmails, type VisitRow,
} from '@/modules/docsend';
import { connectedClient } from './connection';
import { DocsendError, NotSignedIn, type DocsendClient } from './mcp';
import { DocsendSignInError } from './oauth';

/**
 * Read DocSend's data-room visits into docsend.visit (docs/32-docsend.md §4 E, §5). Read only: list_spaces and
 * list_visits, nothing else (./tools.ts). For each Space the signed-in account sees, visits are read newest first
 * until one is older than the last complete read less `config.docsend.overlapMs`, so a nightly read is a page or
 * two; the first read takes the whole history. Then every viewer address is matched to an LP the way calendar
 * guests are (lib/calendar-sync.ts), our team's own visits are marked so no count includes them, and each visit
 * gets its vehicle from docsend.vehicle_map.
 */

interface McpSpace { id: number; name: string }
interface McpVisit {
  visit_created_at: string; time_spent_viewing_ms?: number | null; link_name?: string | null; document_name?: string | null;
  document_id?: number | null; contact_email?: string | null; contact_name?: string | null; space_id?: number | null; space_name?: string | null;
  page_views?: Array<{ page_number: string | number; time_on_page: number }> | null; percentage_viewed?: number | null;
  unique_pages_viewed?: number | null; total_pages_count?: number | null;
}
interface Page<T> { items: T[]; next: string | null }

const page = <T>(data: unknown, key: string): Page<T> => {
  const d = data as Record<string, unknown> & { pageInfo?: { hasNextPage?: boolean; cursor?: string | null } };
  const items = Array.isArray(d?.[key]) ? d[key] as T[] : [];
  return { items, next: d?.pageInfo?.hasNextPage && d.pageInfo.cursor ? d.pageInfo.cursor : null };
};

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** DocSend gives a visit no id: one is made from where, what, who and when, so reading it again changes nothing. */
export function visitKey(v: Pick<McpVisit, 'space_id' | 'document_id' | 'contact_email' | 'visit_created_at'>): string {
  return createHash('sha256').update([v.space_id ?? '', v.document_id ?? '', (v.contact_email ?? '').trim().toLowerCase(), v.visit_created_at].join('|')).digest('hex').slice(0, 32);
}

export function normalizeVisit(v: McpVisit): VisitRow | null {
  const startedAt = new Date(v.visit_created_at);
  if (!v.visit_created_at || Number.isNaN(startedAt.getTime())) return null;
  const pages = Array.isArray(v.page_views) && v.page_views.length
    ? Object.fromEntries(v.page_views.filter((p) => n(p.time_on_page) !== null).map((p) => [String(p.page_number), p.time_on_page])) : null;
  const ms = n(v.time_spent_viewing_ms);
  return {
    visitId: visitKey(v), startedAt,
    durationSec: ms === null ? null : Math.round(ms / 100) / 10,
    pagesViewed: n(v.unique_pages_viewed), pageCount: n(v.total_pages_count), percentViewed: n(v.percentage_viewed),
    pageSeconds: pages, viewerEmail: v.contact_email?.trim().toLowerCase() || null, viewerName: v.contact_name?.trim() || null,
    linkName: v.link_name ?? null, documentId: n(v.document_id), documentTitle: v.document_name ?? null,
    spaceId: n(v.space_id), spaceName: v.space_name ?? null, raw: v,
  };
}

export interface DocsendSyncResult {
  connected: boolean;
  spaces: number;
  visitsRead: number;
  newVisits: number;
  /** Spaces whose read stopped early (page limit), so the next read starts again from the last complete one. */
  incomplete: number;
  viewers: number;
  matchedViewers: number;
  internalViewers: number;
  mapped: number;
  requests: number;
  /** Why DocSend could not be read (a refused sign-in, DocSend's error); also shown on Settings → Connections. */
  failed: string | null;
}

async function* pages<T>(client: DocsendClient, tool: 'list_spaces' | 'list_visits', key: string, args: Record<string, unknown>, max: number): AsyncGenerator<T[]> {
  let cursor: string | null = null;
  for (let i = 0; i < max; i++) {
    const p: Page<T> = page<T>(await client.call(tool, { ...args, limit: config.docsend.pageSize, ...(cursor ? { cursor } : {}) }), key);
    yield p.items;
    if (!p.next) return;
    cursor = p.next;
  }
  throw new Error(`DocSend: more than ${max} pages`);
}

/** Who each viewer is: an LP on record (by an email claim or Affinity's address), our team, or nobody. */
export async function matchViewers(db: Db): Promise<{ found: Map<string, { entityId: string | null; internal: boolean }>; viewers: number }> {
  const emails = await viewerEmails(db);
  const team = await db.query<{ email: string }>(`select lower(trim(a.address)) email from platform.user_address a
      join platform.app_user u on u.id = a.user_id where u.role <> 'system'
    union select lower(trim(email)) from platform.app_user where coalesce(trim(email), '') <> '' and role <> 'system'`);
  const teamAddresses = new Set(team.map((t) => t.email));
  const teamDomains = new Set(team.map((t) => t.email.split('@')[1] ?? '').filter((dom) => dom && !PUBLIC_MAIL.has(dom)));
  const parties = await partiesOf(emails, db);
  const found = new Map<string, { entityId: string | null; internal: boolean }>();
  for (const e of emails) {
    const internal = teamAddresses.has(e) || teamDomains.has(e.split('@')[1] ?? '');
    found.set(e, { entityId: internal ? null : parties.get(e)?.person ?? null, internal });
  }
  return { found, viewers: emails.length };
}

/**
 * A refused sign-in or a DocSend error ends the read with `failed` set and the job completed, so the nightly run still
 * reaches its backup; Settings → Connections shows why. Anything else (our database) still fails the job.
 */
export async function syncDocsend(db: Db, opts: { progress?: ImportProgress; client?: DocsendClient | null; now?: Date } = {}): Promise<DocsendSyncResult> {
  const r: DocsendSyncResult = { connected: false, spaces: 0, visitsRead: 0, newVisits: 0, incomplete: 0, viewers: 0, matchedViewers: 0, internalViewers: 0, mapped: 0, requests: 0, failed: null };
  try {
    const client = opts.client !== undefined ? opts.client : await connectedClient(db);
    if (!client) return r;
    r.connected = true;
    await read(db, client, r, opts);
    await noteConnectionError(null, db);
  } catch (e) {
    if (!(e instanceof NotSignedIn || e instanceof DocsendError || e instanceof DocsendSignInError)) throw e;
    r.connected = true;
    r.failed = e.message;
    await noteConnectionError(e.message, db);
  }
  return r;
}

async function read(db: Db, client: DocsendClient, r: DocsendSyncResult, opts: { progress?: ImportProgress; now?: Date }): Promise<void> {
  await opts.progress?.('Listing data rooms', 0, null);
  const spaces: McpSpace[] = [];
  for await (const items of pages<McpSpace>(client, 'list_spaces', 'spaces', {}, 20)) spaces.push(...items.filter((s) => typeof s.id === 'number'));
  await upsertSpaces(spaces.map((s) => ({ spaceId: s.id, name: String(s.name ?? '') })), db);
  r.spaces = spaces.length;

  for (const [i, s] of spaces.entries()) {
    await opts.progress?.(`Reading visits: ${i + 1} of ${spaces.length} data rooms`, i, spaces.length);
    const startedAt = opts.now ?? new Date();
    const through = await spaceReadThrough(s.id, db);
    const stopBefore = through ? through.getTime() - config.docsend.overlapMs : null;
    let reachedEnd = false, cursor: string | null = null;
    try {
      for (let p = 0; p < config.docsend.maxPagesPerSpace; p++) {
        const got: Page<McpVisit> = page<McpVisit>(await client.call('list_visits', { space_id: s.id, limit: config.docsend.pageSize, ...(cursor ? { cursor } : {}) }), 'visits');
        const rows = got.items.map(normalizeVisit).filter((v): v is VisitRow => !!v);
        r.visitsRead += rows.length;
        r.newVisits += await upsertVisits(rows, db);
        const older = stopBefore !== null && rows.some((v) => v.startedAt.getTime() < stopBefore);
        if (!got.next || older) { reachedEnd = true; break; }
        cursor = got.next;
      }
    } finally { r.requests = client.stats.requests; }
    if (reachedEnd) await markSpaceRead(s.id, startedAt, db); else r.incomplete++;
  }

  await opts.progress?.('Matching viewers to LPs', spaces.length, spaces.length + 1);
  const { found, viewers } = await matchViewers(db);
  await setViewers(found, db);
  r.viewers = viewers;
  r.matchedViewers = [...found.values()].filter((f) => f.entityId).length;
  r.internalViewers = [...found.values()].filter((f) => f.internal).length;
  r.mapped = await applyVehicleMap(db);
  r.requests = client.stats.requests;
}
