import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { parseJsonc } from '@/lib/jsonc';
import { readInit, validate, type RealInit } from '@/lib/real/init';
import { finishRun, landRaw, latestRaw, latestRun, startRun, type SyncRun } from '@/modules/sources';
import { affinity } from './index';

/**
 * List discovery (N41, docs/15): every list the key can see, each list's fields, and the
 * account's users, landed raw. It reads no list entries — nothing about a single LP — so it
 * is cheap (one request per list, plus a few) and safe to run first.
 *
 * What it is for: checking the init file's list names against what Affinity actually calls
 * its lists, finding the SPV lists, and showing which fields exist before anyone decides
 * which of them means stage, owner or amount.
 */

export interface AffinityList {
  id: number;
  name: string;
  creatorId: number;
  ownerId: number;
  isPublic: boolean;
  type: 'company' | 'opportunity' | 'person';
  createdAt: string;
}

export interface AffinityField {
  listId: number;
  id: string;
  name: string;
  type: 'enriched' | 'global' | 'list' | 'relationship-intelligence';
  enrichmentSource: string | null;
  valueType: string;
  createdAt: string | null;
}

export interface AffinityUser {
  id: number;
  firstName: string;
  lastName: string | null;
  primaryEmailAddress: string | null;
  emailAddresses?: string[];
  status?: string;
}

const SOURCE = 'affinity';

export async function discoverLists(runBy: string | null): Promise<SyncRun | null> {
  const run = await startRun(SOURCE, 'discover', runBy);
  let pages = 0;
  let records = 0;
  let fresh = 0;
  const land = async (kind: string, sourceId: string, payload: unknown) => {
    records++;
    if (await landRaw({ source: SOURCE, kind, sourceId, sourceUpdatedAt: null, payload })) fresh++;
  };
  const notes: string[] = [];
  try {
    const client = affinity();
    const lists: AffinityList[] = [];
    for await (const page of client.pages<AffinityList>('/v2/lists', { limit: 100 })) {
      pages++;
      for (const l of page) {
        lists.push(l);
        await land('list', String(l.id), l);
      }
    }
    let fields = 0;
    for (const l of lists) {
      for await (const page of client.pages<Omit<AffinityField, 'listId'>>(`/v2/lists/${l.id}/fields`, { limit: 100 })) {
        pages++;
        for (const f of page) {
          fields++;
          await land('list_field', `${l.id}:${f.id}`, { listId: l.id, ...f });
        }
      }
    }
    notes.push(`${lists.length} lists`, `${fields} fields`);
    try {
      let users = 0;
      for await (const page of client.pages<AffinityUser>('/v2/users', { limit: 100 })) {
        pages++;
        for (const u of page) {
          users++;
          await land('user', String(u.id), u);
        }
      }
      notes.push(`${users} users`);
    } catch (err) {
      // A BETA endpoint. Lists without users is still worth having.
      notes.push(`users unavailable (${err instanceof Error ? err.message : 'unknown'})`);
    }
    await finishRun(run, { status: 'ok', requests: pages, records, newRecords: fresh, note: notes.join(' · ') });
  } catch (err) {
    notes.push(err instanceof Error ? err.message : 'unknown error');
    await finishRun(run, { status: 'failed', requests: pages, records, newRecords: fresh, note: notes.join(' · ') });
  }
  return latestRun(SOURCE, 'discover');
}

/** What discovery last landed, newest version of each record. */
export async function discovered() {
  const [lists, fields, users, run] = await Promise.all([
    latestRaw<AffinityList>(SOURCE, 'list'),
    latestRaw<AffinityField>(SOURCE, 'list_field'),
    latestRaw<AffinityUser>(SOURCE, 'user'),
    latestRun(SOURCE, 'discover'),
  ]);
  return {
    run,
    lists: lists.map((l) => l.payload).sort((a, b) => a.name.localeCompare(b.name)),
    fields: fields.map((f) => f.payload),
    users: users.map((u) => u.payload),
  };
}

/**
 * The init file this profile's matching is checked against. Real: data/real/init.jsonc.
 * Demo: a fixture written the way people write list names, so there is something to match.
 */
export async function initForMatching(): Promise<RealInit | null> {
  if (config.data.profile === 'real') return (await readInit()).init;
  const text = await readFile(join(process.cwd(), 'fixtures', 'affinity', 'init.demo.jsonc'), 'utf8');
  return validate(parseJsonc(text)).init;
}
