import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { latestRaw } from '@/modules/sources';
import { discovered, initForMatching, type AffinityList, type AffinityUser } from './discover';
import type { RealInit } from '@/lib/real/init';
import { sliceTargets } from './slice';

/**
 * The inventory (N43, docs/15 §8): what the slice landed, in aggregate.
 *
 * Counts, fill rates and distributions — never a row. It names nobody outside the team: a
 * dropdown's values are listed because they are the vocabulary a stage is written in, and
 * the team's own names are listed because they own the rows; an LP's name, a text field's
 * contents and a note's words are not, anywhere on this page or in its report.
 *
 * Amounts are counted and described, never summed. Nobody has yet said whether a field holds
 * an indication or a signature, and a total of an unknown is how "committed" gets invented
 * (CLAUDE.md, rule 1).
 */

interface RawValue { type: string; data: unknown }
interface RawField { id: string; name: string; type: string; enrichmentSource: string | null; value: RawValue | null }
interface RawEntry {
  id: number;
  type: 'company' | 'person' | 'opportunity';
  listId: number;
  createdAt: string;
  entity: { id: number; fields?: RawField[]; type?: string };
}
interface RawNote {
  id: number;
  content?: { html?: string | null } | null;
  creator?: { firstName?: string | null; lastName?: string | null; type?: string } | null;
  createdAt: string;
  // The bulk read (N49) carries what each note is attached to; the per-entry read did not.
  personsPreview?: { data: Array<{ id: number }> };
  companiesPreview?: { data: Array<{ id: number }> };
  opportunitiesPreview?: { data: Array<{ id: number }> };
}

export interface FieldStat {
  id: string;
  name: string;
  fieldType: string;
  valueType: string;
  filled: number;
  of: number;
  /** Dropdowns: every value, most used first. */
  values?: Array<{ text: string; n: number }>;
  /**
   * A dropdown whose values look like names rather than a vocabulary — an "Organization (LP)"
   * dropdown lists LPs. Counted, never listed.
   */
  withheld?: { distinct: number };
  /** People fields: the team's names (internal users), and how many outside people. */
  team?: Array<{ name: string; n: number }>;
  outside?: number;
  /** Dates. */
  range?: { from: string; to: string; future: number };
  /** Numbers: described, never summed. */
  numbers?: { n: number; min: number; median: number; max: number };
  /** Interactions: how long since. */
  recency?: { d30: number; d90: number; d365: number; older: number };
}

export interface ListInventory {
  list: AffinityList;
  why: 'init' | 'spv';
  vehicleName: string | null;
  entries: number;
  /** The same entity on the list more than once. */
  repeated: number;
  fields: FieldStat[];
}

export interface Inventory {
  at: Date;
  lists: ListInventory[];
  overlap: Array<{ a: string; b: string; kind: string; n: number }>;
  notes: null | {
    notes: number;
    entities: number;
    byYear: Array<{ year: string; n: number }>;
    byAuthor: Array<{ name: string; n: number }>;
    /** Notes that mention a person's or a family's health. Counted, never shown. */
    health: number;
  };
  relationships: null | {
    people: number;
    withTeam: number;
    bands: { regular: number; occasional: number; sporadic: number };
    byTeam: Array<{ name: string; regular: number; occasional: number; sporadic: number }>;
  };
  questions: string[];
}

const DAY = 86_400_000;

const isEmpty = (v: RawValue | null) =>
  !v || v.data === null || v.data === undefined || (Array.isArray(v.data) && v.data.length === 0) || v.data === '';

const personName = (p: { firstName?: string | null; lastName?: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || 'unnamed';

const interactionDate = (d: unknown): Date | null => {
  const x = d as { sentAt?: string; startTime?: string } | null;
  const s = x?.sentAt ?? x?.startTime;
  return s ? new Date(s) : null;
};

const top = (m: Map<string, number>, k = 40) =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([text, n]) => ({ text, n }));

/**
 * Health detail about a person or their family, in a note. Report 4 §6.2: never record
 * inferred or third-party health detail. This finds notes that need a person's care before
 * anything is derived from them; it errs toward flagging, since a miss is the costly error.
 */
// Deliberately absent: "treatment", "condition" and "recovery", which in a fundraising note
// mostly mean tax treatment, closing conditions and fee recovery. "Recovering from surgery"
// is still caught, by "surgery".
const HEALTH = /\b(surger(y|ies)|hospital\w*|illness|sick|diagnos\w*|cancer|chemo\w*|tumou?r|therapy|therapist|pregnan\w*|miscarriage|passed away|died|death|funeral|bereave\w*|recovering|medical|disease|depress\w*|anxiety|mental health|rehab\w*|stroke|heart attack|injur\w*|accident|dementia|alzheimer\w*|hospice|icu)\b/i;

/**
 * Whether a dropdown's values are names rather than a vocabulary. A vocabulary is small and
 * reused; a list of names is large and nearly unique, or sits in a field named for an entity
 * with more values than a yes/no or a short scale. Either test withholds, because listing LPs
 * is the one thing the inventory must not do, and a vocabulary withheld by mistake costs only
 * a look at Affinity.
 */
export function looksLikeNames(field: string, distinct: number, filled: number): boolean {
  const named = /organi[sz]ation(?! type)|company|\bfirm\b|\bname\b/i.test(field) && distinct > 8;
  const unique = distinct > 12 && distinct / Math.max(1, filled) > 0.25;
  return named || unique;
}

export function mentionsHealth(html: string): boolean {
  return HEALTH.test(html.replace(/<[^>]+>/g, ' '));
}

function fieldStats(entries: RawEntry[], now: number): FieldStat[] {
  const byId = new Map<string, { f: RawField; filled: number; vals: RawValue[] }>();
  for (const e of entries) {
    for (const f of e.entity.fields ?? []) {
      const s = byId.get(f.id) ?? { f, filled: 0, vals: [] };
      if (!isEmpty(f.value)) {
        s.filled++;
        s.vals.push(f.value!);
      }
      byId.set(f.id, s);
    }
  }
  const out: FieldStat[] = [];
  for (const { f, filled, vals } of byId.values()) {
    const valueType = vals[0]?.type ?? f.value?.type ?? 'unknown';
    const stat: FieldStat = { id: f.id, name: f.name, fieldType: f.type, valueType, filled, of: entries.length };
    if (/dropdown/.test(valueType)) {
      const m = new Map<string, number>();
      for (const v of vals) {
        for (const x of Array.isArray(v.data) ? v.data : [v.data]) {
          const t = (x as { text?: string } | null)?.text;
          if (t) m.set(t, (m.get(t) ?? 0) + 1);
        }
      }
      if (looksLikeNames(f.name, m.size, filled)) stat.withheld = { distinct: m.size };
      else stat.values = top(m);
    } else if (/^person/.test(valueType)) {
      const team = new Map<string, number>();
      let outside = 0;
      for (const v of vals) {
        for (const p of (Array.isArray(v.data) ? v.data : [v.data]) as Array<{ type?: string; firstName?: string | null; lastName?: string | null }>) {
          if (!p) continue;
          if (p.type === 'internal') team.set(personName(p), (team.get(personName(p)) ?? 0) + 1);
          else outside++;
        }
      }
      stat.team = top(team, 20).map(({ text, n }) => ({ name: text, n }));
      stat.outside = outside;
    } else if (valueType === 'datetime') {
      const ds = vals.map((v) => new Date(String(v.data))).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
      if (ds.length) {
        stat.range = { from: ds[0]!.toISOString().slice(0, 10), to: ds[ds.length - 1]!.toISOString().slice(0, 10), future: ds.filter((d) => d.getTime() > now).length };
      }
    } else if (/number/.test(valueType)) {
      const ns = vals
        .flatMap((v) => (Array.isArray(v.data) ? v.data : [v.data]))
        .map((x) => (typeof x === 'number' ? x : typeof (x as { calculatedValue?: number })?.calculatedValue === 'number' ? (x as { calculatedValue: number }).calculatedValue : NaN))
        .filter((x) => Number.isFinite(x))
        .sort((a, b) => a - b);
      if (ns.length) stat.numbers = { n: ns.length, min: ns[0]!, median: ns[Math.floor(ns.length / 2)]!, max: ns[ns.length - 1]! };
    } else if (valueType === 'interaction') {
      const r = { d30: 0, d90: 0, d365: 0, older: 0 };
      for (const v of vals) {
        const d = interactionDate(v.data);
        if (!d) continue;
        const age = (now - d.getTime()) / DAY;
        if (age <= 30) r.d30++;
        else if (age <= 90) r.d90++;
        else if (age <= 365) r.d365++;
        else r.older++;
      }
      stat.recency = r;
    }
    out.push(stat);
  }
  // List fields first — they are the ones the team keeps — then the rest by how full they are.
  const rank = (s: FieldStat) => (s.fieldType === 'list' ? 0 : s.fieldType === 'relationship-intelligence' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.filled - a.filled || a.name.localeCompare(b.name));
}

export async function inventory(now = Date.now()): Promise<Inventory> {
  const [targets, raw, notesRaw, linksRaw, relsRaw, found, init] = await Promise.all([
    sliceTargets(),
    latestRaw<RawEntry>('affinity', 'list_entry'),
    latestRaw<RawNote>('affinity', 'note'),
    latestRaw<{ entityType: string; entityId: number; noteId: number }>('affinity', 'note_link'),
    latestRaw<{ personId: number; data: Array<{ person1: { id: number; firstName: string | null; lastName: string | null }; person2: { id: number; firstName: string | null; lastName: string | null }; interactionScore: number }> }>('affinity', 'relationship'),
    discovered(),
    initForMatching(),
  ]);
  const entries = raw.map((r) => r.payload);
  const lists: ListInventory[] = [];
  const members = new Map<number, Set<string>>();
  for (const t of targets) {
    const mine = entries.filter((e) => e.listId === t.list.id);
    const ids = mine.map((e) => `${e.type}:${e.entity.id}`);
    members.set(t.list.id, new Set(ids));
    lists.push({
      list: t.list, why: t.why, vehicleName: t.vehicleName, entries: mine.length,
      repeated: ids.length - new Set(ids).size,
      fields: fieldStats(mine, now),
    });
  }

  // The same person or organization on two lists. Across vehicles that is coordination to
  // do, not a conflict to win: another opportunity is good for the LP and for us, as long as
  // the asks are sequenced (Juan, 23 Sep; rule 5 records it and blocks nothing).
  const overlap: Inventory['overlap'] = [];
  for (let i = 0; i < lists.length; i++) {
    for (let j = i + 1; j < lists.length; j++) {
      const a = members.get(lists[i]!.list.id)!;
      const b = members.get(lists[j]!.list.id)!;
      let n = 0;
      for (const x of a) if (b.has(x)) n++;
      if (n > 0) overlap.push({ a: lists[i]!.list.name, b: lists[j]!.list.name, kind: lists[i]!.list.type, n });
    }
  }

  let notes: Inventory['notes'] = null;
  if (notesRaw.length) {
    const byYear = new Map<string, number>();
    const byAuthor = new Map<string, number>();
    let health = 0;
    const about = new Set(linksRaw.map((l) => `${l.payload.entityType}:${l.payload.entityId}`));
    for (const { payload: n } of notesRaw) {
      byYear.set(n.createdAt.slice(0, 4), (byYear.get(n.createdAt.slice(0, 4)) ?? 0) + 1);
      // Only the team is named. Anyone else who wrote a note is counted under one line.
      if (n.creator) {
        const who = n.creator.type === 'internal' ? personName(n.creator) : 'someone outside the team';
        byAuthor.set(who, (byAuthor.get(who) ?? 0) + 1);
      }
      if (mentionsHealth(n.content?.html ?? '')) health++;
      for (const p of n.personsPreview?.data ?? []) about.add(`person:${p.id}`);
      for (const c of n.companiesPreview?.data ?? []) about.add(`company:${c.id}`);
      for (const o of n.opportunitiesPreview?.data ?? []) about.add(`opportunity:${o.id}`);
    }
    notes = {
      notes: notesRaw.length,
      entities: about.size,
      byYear: [...byYear.entries()].sort().map(([year, n]) => ({ year, n })),
      byAuthor: top(byAuthor, 15).map(({ text, n }) => ({ name: text, n })),
      health,
    };
  }

  let relationships: Inventory['relationships'] = null;
  if (relsRaw.length) {
    const team = new Map(found.users.map((u) => [u.id, personName(u)]));
    const byTeam = new Map<string, { regular: number; occasional: number; sporadic: number }>();
    const bands = { regular: 0, occasional: 0, sporadic: 0 };
    let withTeam = 0;
    for (const { payload } of relsRaw) {
      let any = false;
      for (const r of payload.data) {
        const other = r.person1.id === payload.personId ? r.person2 : r.person1;
        const name = team.get(other.id);
        if (!name) continue;
        any = true;
        const band = r.interactionScore >= 0.7 ? 'regular' : r.interactionScore >= 0.4 ? 'occasional' : 'sporadic';
        bands[band]++;
        const t = byTeam.get(name) ?? { regular: 0, occasional: 0, sporadic: 0 };
        t[band]++;
        byTeam.set(name, t);
      }
      if (any) withTeam++;
    }
    relationships = {
      people: relsRaw.length,
      withTeam,
      bands,
      byTeam: [...byTeam.entries()].map(([name, b]) => ({ name, ...b })).sort((a, b) => b.regular + b.occasional - (a.regular + a.occasional)),
    };
  }

  return { at: new Date(now), lists, overlap, notes, relationships, questions: questions(lists, overlap, found.lists, found.users, init) };
}

/** The second round (docs/15 §8): what the data shows that only a person can answer. */
function questions(
  lists: ListInventory[], overlap: Inventory['overlap'], all: AffinityList[], users: AffinityUser[], init: RealInit | null,
): string[] {
  const q: string[] = [];
  // People on the team in Affinity who own or introduced entries, but are not in the init
  // file: the tool cannot attribute their rows, or switch to them, until they are.
  const known = new Set((init?.team ?? []).map((t) => t.name.toLowerCase()));
  for (const t of init?.team ?? []) {
    const u = users.find((x) => x.primaryEmailAddress && [t.affinityEmail, t.email].includes(x.primaryEmailAddress));
    if (u) known.add(personName(u).toLowerCase());
  }
  const roles = new Map<string, Map<string, number>>();
  for (const l of lists) {
    for (const f of l.fields) {
      for (const t of f.team ?? []) {
        if (known.has(t.name.toLowerCase())) continue;
        const m = roles.get(t.name) ?? new Map<string, number>();
        m.set(f.name, (m.get(f.name) ?? 0) + t.n);
        roles.set(t.name, m);
      }
    }
  }
  if (roles.size) {
    const who = [...roles.entries()]
      .map(([name, m]) => ({ name, total: [...m.values()].reduce((a, b) => a + b, 0), m }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(({ name, m }) => {
        const email = users.find((u) => personName(u) === name)?.primaryEmailAddress;
        return `${name}${email ? ` (${email})` : ''} — ${[...m.entries()].map(([field, n]) => `${field} on ${n}`).join(', ')}`;
      });
    q.push(`These people on the team appear in the lists but not in the init file: ${who.join('; ')}. Add them to "team", with the email they use in Affinity, so their rows are attributed to them?`);
  }
  // A do-not-contact mark is a do-not-approach instruction until someone says otherwise, and
  // the route planner has to know before it suggests any path (rule 8).
  for (const l of lists) {
    for (const f of l.fields.filter((x) => /do not (contact|approach)|\bdnc\b/i.test(x.name))) {
      const yes = (f.values ?? []).filter((v) => /^(yes|true|y)$/i.test(v.text.trim())).reduce((a, v) => a + v.n, 0);
      if (yes) {
        q.push(`“${l.list.name}”: ${yes} ${yes === 1 ? 'entry is' : 'entries are'} marked “${f.name}” yes. Treat each as a do-not-approach instruction, so no route to them is ever suggested (rule 8)? Until you say, they will be.`);
      }
    }
  }
  for (const l of lists) {
    const list = l.fields.filter((f) => f.fieldType === 'list');
    const stageish = list.filter((f) => /dropdown/.test(f.valueType)).sort((a, b) => b.filled - a.filled);
    const amounts = list.filter((f) => /number/.test(f.valueType));
    const owners = l.fields.filter((f) => /^person/.test(f.valueType) && (f.team?.length ?? 0) > 0);
    const name = `“${l.list.name}”`;
    if (stageish.length) {
      const s = stageish[0]!;
      q.push(
        `${name}: is “${s.name}” the stage? It is filled on ${s.filled} of ${s.of}, with the values ${(s.values ?? []).map((v) => `“${v.text}” (${v.n})`).join(', ')}. For each value, which rung of the ladder has actually been evidenced — connector willing, target opted in, meeting held, indication given, commitment accepted, cash received — or none?` +
          (stageish.length > 1 ? ` Other dropdowns on the list: ${stageish.slice(1).map((f) => `“${f.name}”`).join(', ')}.` : ''),
      );
    }
    if (amounts.length) {
      q.push(`${name}: ${amounts.map((f) => `“${f.name}” (filled on ${f.filled})`).join(', ')} — does any of these mean signed and countersigned, or only indicated? Until you say, every amount stays soft.`);
    }
    if (owners.length) {
      q.push(`${name}: is “${owners[0]!.name}” who owns the relationship? ${owners[0]!.of - owners[0]!.filled} of ${owners[0]!.of} entries have nobody in it.`);
    }
  }
  for (const l of lists.filter((x) => x.why === 'spv')) {
    q.push(`“${l.list.name}” says SPV and no vehicle claims it. Which vehicle is it, is it 506(b) or 506(c), and should it be added to the init file?`);
  }
  for (const o of overlap) {
    q.push(`${o.n} ${o.kind === 'person' ? 'people are' : 'entries are'} on both “${o.a}” and “${o.b}”. More than one opportunity is good for them and for us; it needs sequencing. Each will be flagged for coordination between the two vehicles' owners — recorded, nothing blocked.`);
  }
  if (!all.some((l) => /rail|crypto/i.test(l.name))) {
    const clues = lists.flatMap((l) => l.fields.filter((f) => /rail|crypto/i.test(f.name) && f.filled > 0).map((f) => `“${f.name}” on “${l.list.name}” (filled on ${f.filled})`));
    q.push(
      `None of the ${all.length} lists the key can see mentions Rails or Crypto. Is PLC Crypto/Rails tracked in Affinity under another name, in a list this key cannot see, or somewhere else?` +
        (clues.length ? ` A clue: ${clues.join('; ')}.` : ''),
    );
  }
  return q;
}

/** The same inventory, as a file in data/<profile>/reports/ for reading outside the app. */
export async function writeReport(inv: Inventory): Promise<string> {
  const dir = join(config.data.root, 'reports');
  await mkdir(join(process.cwd(), dir), { recursive: true });
  const file = join(dir, `inventory-${inv.at.toISOString().slice(0, 10)}.md`);
  const n = (x: number) => x.toLocaleString('en-US');
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const lines: string[] = [
    `# Affinity inventory — ${inv.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Profile: ${config.data.profile}. Aggregates only: no LP is named here, no text field or note is quoted. Amounts are described, never summed.`,
    '',
  ];
  for (const l of inv.lists) {
    lines.push(`## ${l.list.name}`, '', `${l.vehicleName ?? 'No vehicle (says SPV)'} · ${l.list.type} list · ${n(l.entries)} entries${l.repeated ? ` · ${l.repeated} repeated` : ''}`, '');
    lines.push('| Field | Kind | Filled | What is in it |', '|---|---|---|---|');
    for (const f of l.fields) {
      const what = f.withheld ? `${f.withheld.distinct} distinct values that look like names — withheld`
        : f.values ? f.values.map((v) => `${v.text} (${v.n})`).join(', ')
        : f.team ? `team: ${f.team.map((t) => `${t.name} (${t.n})`).join(', ')}${f.outside ? `; ${f.outside} outside people` : ''}`
        : f.range ? `${f.range.from} → ${f.range.to}; ${f.range.future} in the future`
        : f.numbers ? `${n(f.numbers.n)} values; median ${n(f.numbers.median)}, ${n(f.numbers.min)}–${n(f.numbers.max)}; not summed`
        : f.recency ? `≤30d ${f.recency.d30} · ≤90d ${f.recency.d90} · ≤1y ${f.recency.d365} · older ${f.recency.older}`
        : '';
      lines.push(`| ${f.name} | ${f.valueType} (${f.fieldType}) | ${n(f.filled)} of ${n(f.of)} (${pct(f.filled, f.of)}) | ${what.replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  if (inv.overlap.length) {
    lines.push('## On more than one list', '');
    for (const o of inv.overlap) lines.push(`- ${n(o.n)} on both “${o.a}” and “${o.b}”`);
    lines.push('');
  }
  if (inv.notes) {
    lines.push('## Notes', '', `${n(inv.notes.notes)} notes for ${n(inv.notes.entities)} entries. ${n(inv.notes.health)} mention health and are flagged; that detail is never copied into anything derived.`, '');
    lines.push(`By year: ${inv.notes.byYear.map((y) => `${y.year} ${y.n}`).join(' · ')}`, '', `By author: ${inv.notes.byAuthor.map((a) => `${a.name} ${a.n}`).join(' · ')}`, '');
  }
  if (inv.relationships) {
    const r = inv.relationships;
    lines.push('## Relationships to the team', '', `${n(r.withTeam)} of ${n(r.people)} people have an interaction score with someone on the team: ${r.bands.regular} regular, ${r.bands.occasional} occasional, ${r.bands.sporadic} sporadic. These are Affinity's claims and become tier-C edges, which need a person before routing trusts them.`, '');
  }
  lines.push('## Questions, round two', '');
  inv.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  await writeFile(join(process.cwd(), file), lines.join('\n') + '\n');
  return file;
}
