import { getDb } from '@/lib/db';
import { finishRun, landRaw, startRun, type SyncRun, latestRun } from '@/modules/sources';
import { affinity } from './index';
import { AffinityError, AffinityRequestCap, type Query } from './client';
import { AFFINITY_ORIGIN } from './fetch';
import { wholeSeconds } from './history';

/**
 * Only the emails Affinity logged since our newest one (Juan, 16 Oct 2026: "figure out a way around it, like how might we
 * guess how to request the newer emails?"). The history read sweeps every person and then every email, about 3,000
 * requests, because /v2/emails' change filter was never verified. This reader guesses its way to the new ones instead:
 *
 *   1. The watermark: the newest createdAt (else sentAt) among the emails we already hold, less two days' overlap.
 *   2. Ask /v2/emails with filter createdAt>=watermark, then updatedAt>=; the first Affinity accepts is the read.
 *   3. If Affinity refuses both (400), sweep unfiltered but stop at the first page whose every email is older than the
 *      watermark: the answer is newest first if any page is, and a page of only old mail then means the rest is old too.
 *      An oldest-first answer never stops early; the cap ends it and the receipt says the guess failed.
 *
 * At most `cap` requests (99, the history read's own), each email landed as the history read lands it (kind 'email'),
 * so translate takes them the same way. Read-only, as every Affinity read is.
 */

const KIND = 'recent-emails';
export const RECENT_EMAILS_CAP = 99;
const OVERLAP_MS = 2 * 86_400_000;
const LIMIT = 100;

type Email = { id: number; createdAt?: string | null; updatedAt?: string | null; sentAt?: string | null };
type Page = { data?: Email[]; pagination?: { nextUrl?: string | null } };

export interface RecentEmailsDetail extends Record<string, unknown> {
  watermark: string | null;
  how: 'createdAt' | 'updatedAt' | 'sweep' | 'none';
  refused: string[];
  stoppedAtCap?: boolean;
  newestFirst?: boolean | null;
}

async function watermark(): Promise<string | null> {
  const db = await getDb();
  const r = await db.one<{ at: Date | null }>(`select max(coalesce((payload->>'createdAt')::timestamptz, (payload->>'sentAt')::timestamptz)) at
    from sources.raw_record where source = 'affinity' and kind = 'email'`);
  return r?.at ? wholeSeconds(new Date(new Date(r.at).getTime() - OVERLAP_MS).toISOString()) : null;
}

const when = (e: Email) => e.createdAt ?? e.sentAt ?? null;

export async function readRecentEmails(runBy: string | null, opts: { cap?: number; overrides?: Parameters<typeof affinity>[0] } = {}): Promise<SyncRun | null> {
  const cap = Math.min(opts.cap ?? RECENT_EMAILS_CAP, RECENT_EMAILS_CAP);
  const since = await watermark();
  const detail: RecentEmailsDetail = { watermark: since, how: 'none', refused: [] };
  const run = await startRun('affinity', KIND, runBy);
  let requests = 0, records = 0, fresh = 0;
  const client = affinity({ ...opts.overrides, runId: String(run), beforeAttempt: () => {
    if (requests >= cap) throw new AffinityRequestCap('Recent emails request cap reached.');
    requests++;
  } });
  const land = async (items: Email[]) => {
    for (const item of items) {
      if (!Number.isSafeInteger(item.id)) throw new Error('Email response has an invalid record id.');
      records++;
      const changed = item.updatedAt ?? item.createdAt;
      if (await landRaw({ source: 'affinity', kind: 'email', sourceId: String(item.id), sourceUpdatedAt: changed ? new Date(changed) : null, payload: item })) fresh++;
    }
  };
  const done = async (status: 'ok' | 'failed', note: string) => {
    await finishRun(run, { status, requests, records, newRecords: fresh, note, detail });
    return latestRun('affinity', KIND);
  };
  // Every page after the first: the cursor URL, keeping the query it may omit.
  const follow = (next: string, query: Query) => {
    const url = new URL(next, AFFINITY_ORIGIN);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && !url.searchParams.has(k)) url.searchParams.set(k, String(v));
    return url.toString();
  };
  try {
    if (!since) return done('failed', 'No emails held yet to guess from; run the history read once first.');
    for (const field of ['createdAt', 'updatedAt'] as const) {
      const query: Query = { limit: LIMIT, filter: `${field}>=${since}` };
      let page: Page;
      try { page = await client.get<Page>('/v2/emails', query); } catch (err) {
        if (err instanceof AffinityError && err.status === 400) { detail.refused.push(field); continue; }
        throw err;
      }
      // A filter Affinity ignores without saying so answers with old mail too: count it as refused.
      const stamp = (e: Email) => (field === 'createdAt' ? e.createdAt : e.updatedAt) ?? null;
      if ((page.data ?? []).some((e) => { const t = stamp(e); return t != null && t < since; })) { detail.refused.push(`${field} (ignored)`); continue; }
      detail.how = field;
      for (;;) {
        await land(page.data ?? []);
        if (!page.pagination?.nextUrl) return done('ok', `${records} emails since ${since} by ${field}, in ${requests} requests.`);
        page = await client.get<Page>(follow(page.pagination.nextUrl, query), {});
      }
    }
    // No filter accepted: sweep, stopping at the first page of only old mail when the answer runs newest first.
    detail.how = 'sweep';
    const query: Query = { limit: LIMIT };
    let page = await client.get<Page>('/v2/emails', query);
    for (;;) {
      const items = page.data ?? [];
      await land(items);
      const ts = items.map(when).filter((t): t is string => Boolean(t));
      if (ts.length > 1 && detail.newestFirst == null) detail.newestFirst = ts[0]! >= ts[ts.length - 1]!;
      if (detail.newestFirst && ts.length && ts.every((t) => t < since)) return done('ok', `${records} emails swept newest first back to ${since}, in ${requests} requests.`);
      if (!page.pagination?.nextUrl) return done('ok', `${records} emails swept to the end, in ${requests} requests.`);
      page = await client.get<Page>(follow(page.pagination.nextUrl, query), {});
    }
  } catch (err) {
    if (err instanceof AffinityRequestCap) {
      detail.stoppedAtCap = true;
      return done('failed', `Stopped at ${cap} requests (${detail.how}${detail.how === 'sweep' ? `, newest first: ${detail.newestFirst}` : ''}).`);
    }
    return done('failed', err instanceof Error ? err.message : 'Recent emails read failed.');
  }
}
