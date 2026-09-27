import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import type { Touchpoint } from '@/modules/meetings';
import type { Candidate } from './candidates';
import { hasAddress } from './schema';
import { massMailing, triage, type Triage } from './triage';

export interface TriageExport extends Triage {
  /** Stable vehicle slug, also the W5 strategy folder and draft filename suffix. */
  vehicle: string;
  vehicleName: string;
  status: Candidate['pursuits'][number]['status'];
  owner: string | null;
  lanes: Array<Triage['lane'] | NonNullable<Triage['first']>>;
  asOf: string;
  touches: Array<{
    date: string;
    /** Shared meetings and unknown directions stay null; do not invent a sender. */
    direction: 'in' | 'out' | null;
    channel: 'email' | 'meeting' | 'note' | 'other';
    subject: string | null;
    team: string[];
    snippet: string | null;
  }>;
  daysSinceLastInbound: number | null;
  daysSinceLastOutbound: number | null;
  massMailing: boolean;
}

export interface TriagePair { pursuitId: string; vehicle: string; owner: string | null }
export interface InteractionText { subject: string | null; snippet: string | null }
type Team = Array<{ handle: string; name: string }>;
type Entry = { entity: { fields?: Array<{ value: { type: string; data: unknown } | null }> } };

/** Redact before truncating: partial addresses/numbers must not survive a length limit. */
export function triageText(value: string | null | undefined): string | null {
  if (!value) return null;
  let text = value.normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^\s<>"(),;:]+@[^\s<>"(),;:]+/gu, '[email redacted]')
    .replace(/(?:\+?\p{Nd}[\p{Nd}\s().\-/]{5,}\p{Nd})(?:\s*(?:ext\.?|x|#)\s*\p{Nd}+)?/giu,
      (run) => /^\d{4}-\d{2}-\d{2}$/.test(run) && !Number.isNaN(Date.parse(run)) ? run
        : [...run.matchAll(/\p{Nd}/gu)].length >= 7 ? '[phone redacted]' : run)
    .replace(/\s+/g, ' ').trim();
  // Street addresses are not needed to draft either. Withhold rather than guess their bounds.
  if (hasAddress(text)) text = '[address redacted]';
  return text || null;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const refOf = (t: Touchpoint) => t.sourceRef?.match(/^(interaction:[a-z-]+:[0-9]+):/)?.[1] ?? null;
const ownTouches = (touches: Touchpoint[], now: Date) => touches.filter((t) =>
  !t.viaOrganization && t.channel !== 'research' && t.on && t.on.getTime() <= now.getTime())
  .sort((a, b) => b.on!.getTime() - a.on!.getTime() || compare(a.touchpointId, b.touchpointId));

function candidatesByPair(candidates: Candidate[]): Map<string, Candidate> {
  const byPair = new Map<string, Candidate>();
  for (const c of candidates) for (const p of [...c.pursuits].sort((a, b) => compare(a.pursuitId, b.pursuitId))) {
    const key = JSON.stringify([c.key, p.vehicle]);
    if (!byPair.has(key)) byPair.set(key, { ...c, pursuits: [p] });
  }
  return byPair;
}

/** Every pursuit is classified with the same W9 rules, without letting the first hide the rest. */
export async function triageExportRows(
  dir: string, candidates: Candidate[], touches: Map<string, Touchpoint[]>, pairs: TriagePair[],
  details: Map<string, InteractionText>, team: Team, now = new Date(),
): Promise<TriageExport[]> {
  const pairById = new Map(pairs.map((p) => [p.pursuitId, p]));
  const candidateByPair = candidatesByPair(candidates);
  const input = [...candidateByPair.values()];
  const rows = await triage(dir, now, input);
  const handles = new Map<string, Set<string>>();
  for (const u of team) for (const label of [u.name, u.handle]) {
    const matches = handles.get(label) ?? new Set<string>(); matches.add(u.handle); handles.set(label, matches);
  }
  const handle = (label: string) => {
    const matches = handles.get(label);
    const h = matches?.size === 1 ? [...matches][0]! : null;
    return h && triageText(h) === h ? h : null;
  };
  const contactByKey = new Map<string, Pick<TriageExport, 'touches' | 'daysSinceLastInbound' | 'daysSinceLastOutbound'>>();
  for (const c of candidates) {
    const held = ownTouches(touches.get(c.key) ?? [], now);
    const days = (direction: 'theirs' | 'ours') => {
      const last = held.find((t) => t.direction === direction);
      return last ? Math.floor((now.getTime() - last.on!.getTime()) / 86_400_000) : null;
    };
    contactByKey.set(c.key, {
      touches: held.slice(0, 5).map((t) => {
        const detail = details.get(refOf(t) ?? '');
        return {
          date: t.on!.toISOString().slice(0, 10),
          direction: t.direction === 'ours' ? 'out' : t.direction === 'theirs' ? 'in' : null,
          channel: t.sourceRef?.startsWith('note:') ? 'note' : t.channel === 'email' ? 'email'
            : t.channel === 'meeting' || t.channel === 'call' ? 'meeting' : 'other',
          subject: triageText(detail?.subject),
          team: [...new Set([t.ownerName, ...t.attendees].map(handle).filter((h): h is string => !!h))].sort(compare),
          // A stored summary is allowed; tags, generated reasons and note readings are not snippets.
          snippet: triageText(detail?.snippet ?? t.summary)?.slice(0, 280) ?? null,
        };
      }),
      daysSinceLastInbound: days('theirs'), daysSinceLastOutbound: days('ours'),
    });
  }
  return rows.map((r): TriageExport => {
    const c = candidateByPair.get(JSON.stringify([r.key, r.vehicle]))!;
    const p = c.pursuits[0]!;
    const pair = pairById.get(p.pursuitId);
    if (!pair) throw new Error('Triage export is missing a pursuit mapping.');
    if (!/^[a-z][a-z0-9-]*$/.test(pair.vehicle) || triageText(pair.vehicle) !== pair.vehicle) {
      throw new Error('Triage export requires a safe vehicle slug without contact details.');
    }
    return {
      ...r, name: triageText(r.name) ?? '[redacted]', reasons: r.reasons.map((s) => triageText(s) ?? '[redacted]'),
      vehicle: pair.vehicle, vehicleName: triageText(p.vehicle) ?? '[redacted]', status: p.status,
      owner: pair.owner && triageText(pair.owner) === pair.owner ? pair.owner : null,
      lanes: r.first ? [r.lane, r.first] : [r.lane], asOf: now.toISOString(),
      ...contactByKey.get(c.key)!, massMailing: massMailing(c),
    };
  }).sort((a, b) => compare(a.key, b.key) || compare(a.vehicle, b.vehicle));
}

/** Bulk local reads only; raw interaction fields already loaded by researchSet are reused. */
export async function makeTriageExport(
  dir: string, candidates: Candidate[], touches: Map<string, Touchpoint[]>, entries: Entry[], team: Team,
): Promise<TriageExport[]> {
  if (!candidates.length) return [];
  const now = new Date();
  const wanted = new Set([...touches.values()].flatMap((ts) => ownTouches(ts, now).slice(0, 5).map(refOf)).filter((r): r is string => !!r));
  const details = new Map<string, InteractionText>();
  const text = (v: unknown) => typeof v === 'string' ? v : null;
  for (const e of entries) for (const f of e.entity.fields ?? []) {
    if (f.value?.type !== 'interaction' || !f.value.data || typeof f.value.data !== 'object') continue;
    const d = f.value.data as Record<string, unknown>;
    const ref = `interaction:${d.type}:${d.id}`;
    if (!wanted.has(ref)) continue;
    const candidate = { subject: text(d.subject) ?? text(d.title), snippet: text(d.snippet) };
    // Duplicate interaction copies can differ. Pick deterministically, preferring recorded text.
    const previous = details.get(ref);
    const choose = (a: string | null, b: string | null) => [a, b].filter((v): v is string => !!v).sort(compare)[0] ?? null;
    details.set(ref, { subject: choose(previous?.subject ?? null, candidate.subject), snippet: choose(previous?.snippet ?? null, candidate.snippet) });
  }
  const db = await getDb();
  const [pairs, meetings] = await Promise.all([
    db.query<TriagePair>(`select p.pursuit_id::text as "pursuitId", v.slug as vehicle,
        case when u.active then u.handle else null end as owner
      from strategy.active_pursuit p join platform.vehicle v on v.id=p.vehicle_id
      join platform.app_user u on u.id=p.owner_id where p.pursuit_id=any($1::uuid[])`,
    [candidates.flatMap((c) => c.pursuits.map((p) => p.pursuitId))]),
    db.query<{ id: string; subject: string | null; snippet: string | null }>(
      `select distinct on (source_id) source_id as id, payload->>'title' as subject, payload->>'snippet' as snippet
       from sources.raw_record where source='affinity' and kind='meeting' and source_id=any($1::text[])
       order by source_id, fetched_at desc, sources.raw_record.id desc`,
      [[...wanted].filter((r) => r.startsWith('interaction:meeting:')).map((r) => r.slice('interaction:meeting:'.length))]),
  ]);
  for (const m of meetings) {
    const ref = `interaction:meeting:${m.id}`, old = details.get(ref);
    details.set(ref, { subject: m.subject ?? old?.subject ?? null, snippet: m.snippet ?? old?.snippet ?? null });
  }
  return triageExportRows(dir, candidates, touches, pairs, details, team, now);
}

/** Atomic replacement keeps a failed export and symlinks from producing a partial/leaked file. */
export async function writeTriageExport(dir: string, rows: TriageExport[]): Promise<void> {
  if (config.data.profile === 'real' && resolve(dir) !== resolve(config.data.root, 'enrich')) {
    throw new Error('Real triage exports must stay in data/real/enrich.');
  }
  await mkdir(dir, { recursive: true });
  if (config.data.profile === 'real' && await realpath(dir) !== join(await realpath(config.data.root), 'enrich')) {
    throw new Error('Real triage exports cannot follow an enrich directory outside the data root.');
  }
  const temp = join(dir, `.triage-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, rows.length ? rows.map((r) => JSON.stringify(r)).join('\n') + '\n' : '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, join(dir, 'triage.jsonl'));
  } finally { await rm(temp, { force: true }); }
}

/** File-only W9 reruns preserve the exported records; a newly eligible pair needs a fresh export. */
export async function refreshTriageExport(dir: string, now = new Date()): Promise<TriageExport[]> {
  const candidates = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).split('\n').filter(Boolean).map((s) => JSON.parse(s) as Candidate);
  const previous = (await readFile(join(dir, 'triage.jsonl'), 'utf8')).split('\n').filter(Boolean).map((s) => JSON.parse(s) as TriageExport);
  const byPair = new Map(previous.map((r) => [JSON.stringify([r.key, r.vehicleName]), r]));
  const classified = await triage(dir, now, [...candidatesByPair(candidates).values()]);
  const rows = classified.map((r) => {
    const old = byPair.get(JSON.stringify([r.key, r.vehicle]));
    if (!old || !Array.isArray(old.touches)) throw new Error('Run Export the research set before refreshing W9; touch records are missing.');
    return { ...old, lane: r.lane, first: r.first, reasons: r.reasons.map((s) => triageText(s) ?? '[redacted]'),
      senior: r.senior, researched: r.researched, waitedDays: r.waitedDays,
      lanes: r.first ? [r.lane, r.first] : [r.lane] } satisfies TriageExport;
  }).sort((a, b) => compare(a.key, b.key) || compare(a.vehicle, b.vehicle));
  await writeTriageExport(dir, rows);
  return rows;
}
