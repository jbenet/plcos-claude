import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import type { Candidate } from './candidates';
import type { Path, Tier } from './connect';
import type { Strategy } from './strategy';
import type { Triage } from './triage';

/**
 * W11, the connector plan (docs/19, iteration 3): for everyone who could make an introduction —
 * an LP who has committed, a warm LP who has met us — the prospects W3 found next to them, best
 * first, and the few to ask about this quarter. Deterministic, from the files; nothing is sent.
 *
 * - **The guard's limit.** At most `config.guard.asksPerConnectorPerQuarter` asks per connector
 *   (a GUESS in config); the rest wait for a later quarter.
 * - **Rule 8.** A prospect under a blanket do-not-approach instruction is left out of every plan,
 *   and one restricted through a connector is left out of that connector's.
 * - **Rule 6.** A C or D tie is a clue: the ask is "do you know them?" before it is "would you
 *   introduce us?", and a person confirms the tie before it routes.
 * - **One LP's decision is never told to another** (W5 v1.1): a plan names the prospect, never
 *   where they stand with us.
 * - **A soft commitment asks after signing.** The introduction rides on the connector's own
 *   commitment, so a connector whose money is soft is asked once they have signed.
 */

export interface ConnectorPlan {
  connector: { key: string; name: string; status: string; owner: string; money: string | null; met: number };
  prospects: Array<{ key: string; name: string; status: string; lane: string | null; list: string | null; tier: Tier; kind: Path['kind']; basis: string }>;
  /** This quarter's asks: the best prospects, up to the guard's limit. */
  asks: string[];
  when: 'now' | 'after they sign';
  /** Ties a person has to confirm before any of these asks routes. */
  toConfirm: number;
}

const TIER: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3 };
const STATUS: Record<string, number> = { discussing: 0, selected: 1, connecting: 2 };
const LANE: Record<string, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
const LIST: Record<string, number> = { 'this year': 0, '2027': 1, 'not now': 3 };

const lines = (s: string) => s.split('\n').filter(Boolean);

export async function connectorPlans(dir: string): Promise<ConnectorPlan[]> {
  const cands = lines(await readFile(join(dir, 'candidates.jsonl'), 'utf8')).map((l) => JSON.parse(l) as Candidate);
  const paths = lines(await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Path);
  const triage = new Map(lines(await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Triage).map((t) => [t.key, t]));
  const strategies = new Map<string, Strategy>();
  for (const f of (await readdir(join(dir, 'strategy')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try { const s = JSON.parse(await readFile(join(dir, 'strategy', f), 'utf8')) as Strategy; strategies.set(s.key, s); } catch { /* the checker reports it */ }
  }
  const byKey = new Map(cands.map((c) => [c.key, c]));
  const status = (c: Candidate) => c.pursuits[0]?.status ?? '?';
  // Their read, from our notes' latest reading (N55): interested, or very.
  const warmRead = (c: Candidate) => ['interested', 'very_interested'].includes(c.notes.find((n) => n.read)?.read ?? '');
  const isConnector = (c: Candidate) => status(c) === 'committed' || (status(c) === 'discussing' && c.contact.meetings > 0 && warmRead(c));
  const blanket = (c: Candidate) => (c.restrictions ?? []).some((r) => r.scope === 'blanket');
  const throughThem = (c: Candidate, via: Candidate) => (c.restrictions ?? []).some((r) => r.scope === 'connector' && r.connector === via.name);

  const out: ConnectorPlan[] = [];
  for (const k of cands.filter(isConnector)) {
    const near = new Map<string, ConnectorPlan['prospects'][number]>();
    for (const p of paths) {
      if (p.other.type !== 'lp' || p.other.key !== k.key || p.lp === k.key) continue;
      const c = byKey.get(p.lp);
      // Someone who has met us already needs no introduction; one would read as if we'd forgotten them (W5, iteration 3).
      if (!c || status(c) === 'committed' || c.contact.meetings > 0 || blanket(c) || throughThem(c, k)) continue;
      const prev = near.get(c.key);
      if (prev && TIER[prev.tier] <= TIER[p.tier]) continue;
      near.set(c.key, { key: c.key, name: c.name, status: status(c), lane: triage.get(c.key)?.lane ?? null, list: strategies.get(c.key)?.list ?? null, tier: p.tier, kind: p.kind, basis: p.basis });
    }
    if (!near.size) continue;
    const prospects = [...near.values()].sort((a, b) => (LIST[a.list ?? ''] ?? 2) - (LIST[b.list ?? ''] ?? 2)
      || TIER[a.tier] - TIER[b.tier] || (LANE[a.lane ?? ''] ?? 2) - (LANE[b.lane ?? ''] ?? 2) || (STATUS[a.status] ?? 3) - (STATUS[b.status] ?? 3));
    const asks = prospects.slice(0, config.guard.asksPerConnectorPerQuarter).map((p) => p.key);
    const soft = k.money && !k.money.signedOn && k.money.track !== 'hard' && !(k.money.wired > 0);
    out.push({
      connector: { key: k.key, name: k.name, status: status(k), owner: k.pursuits[0]?.owner ?? '', money: k.money ? (k.money.track === k.money.state ? k.money.track : `${k.money.track}, ${k.money.state}`) : null, met: k.contact.meetings },
      prospects, asks, when: status(k) === 'committed' && soft ? 'after they sign' : 'now',
      toConfirm: prospects.filter((p) => asks.includes(p.key) && (p.tier === 'C' || p.tier === 'D')).length,
    });
  }
  return out.sort((a, b) => b.prospects.length - a.prospects.length);
}
