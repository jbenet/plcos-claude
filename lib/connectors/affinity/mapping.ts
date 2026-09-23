import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '@/config/deployment';
import { parseJsonc } from '@/lib/jsonc';
import {
  IMPLIED, PASSED_BY_LABEL, REASONS, STATUSES,
  type Implied, type OutcomeReason, type PassedBy, type PursuitStatus,
} from '@/modules/strategy';
import type { FieldStat, Inventory, ListInventory } from './inventory';
import { normName } from './match';

/**
 * How Affinity's lists are read into this tool (N46, docs/16). One file, kept beside the init
 * file in data/<profile>/ because it names lists and their vocabulary, and re-read by every
 * translation — so fixing a mapping is an edit and a re-run, never a re-fetch.
 *
 * For each list: whether it is the pipeline a vehicle works from or history to keep; which
 * fields say where an entry is, tried in order; what each of their values means as our status
 * (N50, docs/17) — with who ended it and why where it ended, and what the word says happened;
 * and which fields hold the amounts, the owner, the introducer and a do-not-contact mark.
 *
 * The first version is proposed from the words themselves (Juan asked for a proposal, 23 Sep).
 * Every list says `reviewed: false` until a person says otherwise, and the pages say so beside
 * everything translated from it. A value the proposer could not place stays null — a question,
 * not a guess — and regenerating keeps every edit.
 */

export const MAPPING_PATH = join(config.data.root, 'mapping.jsonc');

export interface ValueMap {
  /** Our status. Null: the word says nothing about where the effort is. */
  status?: PursuitStatus | null;
  /** When it passed: who ended it, and why. */
  passedBy?: PassedBy;
  reason?: OutcomeReason;
  /** What the word says happened, undated: claims beside the log and the ladder. */
  implies?: Implied[];
  /** "On Hold": the status stays, and this becomes its next step. */
  next?: string;
  /** Not an LP at all — an introducer filed on the list, say. Not translated into a pursuit. */
  skip?: boolean;
}

export interface StatusSource {
  field: string;
  values: Record<string, ValueMap | null>;
}

export interface ListMapping {
  reviewed: boolean;
  /** "pipeline": translated into pursuits. "history": kept raw, not translated. */
  role: 'pipeline' | 'history';
  /** The fields that say where an entry is, tried in order. */
  status: StatusSource[];
  /** Read from a file written before N50, in stages; re-proposed unless someone reviewed it. */
  legacy?: boolean;
  commitment: string | null;
  /** A soft circle kept as a range (min, max), where a list records one. */
  softRange: [string, string] | null;
  checkSize: string | null;
  aum: string | null;
  owner: string | null;
  introducer: string | null;
  doNotContact: string | null;
  passReason: string | null;
}

export interface MappingReport {
  path: string;
  exists: boolean;
  text: string | null;
  lists: Record<string, ListMapping>;
  problems: string[];
  /** Values across all stage fields, and how many have a meaning. */
  values: number;
  mapped: number;
}

const STATUS_IDS = new Set<string>(STATUSES.map((s) => s.id));
const IMPLIED_IDS = new Set<string>(IMPLIED.map((x) => x.id));

/**
 * N46's stages, as statuses (N50). A file written in stages is re-proposed where nobody has
 * reviewed it; a list somebody marked reviewed keeps its meanings, converted by this table.
 */
const LEGACY_STAGE: Record<string, { status: PursuitStatus; implies?: Implied[] }> = {
  research: { status: 'sourcing' },
  targeted: { status: 'sourcing' },
  contacted: { status: 'selected', implies: ['reached_out'] },
  responded: { status: 'discussing', implies: ['replied'] },
  scheduling: { status: 'discussing', implies: ['replied', 'meeting_agreed'] },
  first_meeting: { status: 'discussing', implies: ['met'] },
  follow_up: { status: 'discussing', implies: ['met', 'met_twice'] },
  diligence: { status: 'discussing', implies: ['met', 'diligence'] },
  docs_out: { status: 'discussing', implies: ['met', 'docs_sent'] },
  soft_commit: { status: 'committed', implies: ['soft'] },
  signed: { status: 'committed', implies: ['soft', 'signed'] },
  funded: { status: 'committed', implies: ['soft', 'signed', 'wired'] },
};

function fromLegacy(x: Record<string, unknown>): ValueMap {
  if (x.skip === true) return { skip: true };
  const st = typeof x.stage === 'string' ? LEGACY_STAGE[x.stage] : undefined;
  const outcome = x.outcome as string | undefined;
  const reason = typeof x.reason === 'string' && (REASONS as readonly string[]).includes(x.reason) ? (x.reason as OutcomeReason) : undefined;
  if (outcome === 'passed' || outcome === 'lost') {
    return {
      status: 'passed', passedBy: outcome === 'lost' && reason === 'no_response' ? 'quiet' : 'them', reason: reason ?? 'other',
      ...(st?.implies ? { implies: st.implies } : {}),
    };
  }
  return { status: st?.status ?? null, ...(st?.implies ? { implies: st.implies } : {}), ...(outcome === 'paused' ? { next: 'On hold' } : {}) };
}

export function reasonOf(value: string): OutcomeReason | undefined {
  const v = value.toLowerCase();
  if (/thesis|strategy|robotics|hardware|outside mandate|mandate/.test(v)) return /mandate|robotics|hardware/.test(v) ? 'mandate' : 'thesis';
  if (/timing|could not move|close date/.test(v)) return 'timing';
  if (/valuation|price|expensive|entry/.test(v)) return 'valuation';
  if (/no response|went dark|ghost/.test(v)) return 'no_response';
  if (/structure|fees|carry/.test(v)) return 'structure';
  if (/concentration|existing position|conflict/.test(v)) return 'concentration';
  if (/diligence|traction|market/.test(v)) return 'diligence';
  if (/other/.test(v)) return 'other';
  return undefined;
}

/** What a status word seems to mean. A proposal for a person to review, never a fact. */
export function proposeValue(value: string): ValueMap | null {
  const v = value.toLowerCase().trim();
  if (/introducer|non.?lp|not an lp/.test(v)) return { skip: true };
  if (/on hold|paused/.test(v)) {
    const inner = proposeValue(v.replace(/on hold|paused/, '').replace(/^[\s\-–—:]+/, '').replace(/[\s\-–—:]+$/, ''));
    // On its own, "On Hold" was the team's do-not-contact (Juan, 23 Sep): we stopped.
    if (!inner || inner.skip) return { status: 'passed', passedBy: 'us', reason: 'do_not_contact' };
    return { ...inner, next: 'On hold' };
  }
  if (/\blost\b/.test(v)) {
    // Silence is not a pass (N53): no reply keeps them Selected, and the log shows the wait.
    if (/no response|went dark|ghost/.test(v)) return { status: 'selected', implies: ['reached_out'] };
    return { status: 'passed', passedBy: 'them', reason: reasonOf(v) ?? 'other' };
  }
  if (/pass|declin|not interested/.test(v)) return { status: 'passed', passedBy: 'them', reason: reasonOf(v) ?? 'other' };
  if (/wired|funded|cash|received/.test(v)) return { status: 'committed', implies: ['soft', 'signed', 'wired'] };
  if (/signed|countersign|closed won|\bcommitted\b/.test(v)) return { status: 'committed', implies: ['soft', 'signed'] };
  if (/soft|verbal|circle/.test(v)) return { status: 'committed', implies: ['soft'] };
  if (/docs out|documents sent|docs sent/.test(v)) return { status: 'discussing', implies: ['met', 'docs_sent'] };
  if (/diligence|\bdd\b/.test(v)) return { status: 'discussing', implies: ['met', 'diligence'] };
  if (/(2\+|two|second|follow).*meeting|meetings/.test(v)) return { status: 'discussing', implies: ['met', 'met_twice'] };
  if (/meeting|call complete|\bmet\b/.test(v)) return { status: 'discussing', implies: ['met'] };
  if (/schedul|ready for/.test(v)) return { status: 'discussing', implies: ['replied', 'meeting_agreed'] };
  if (/respond|interested|discussion|replied/.test(v)) return { status: 'discussing', implies: ['replied'] };
  // "In progress" says we are working it, not that they answered.
  if (/contacted|reached out|intro made|introduced|sent|in progress/.test(v)) return { status: 'selected', implies: ['reached_out'] };
  // On an outreach list, "not started" is chosen and not yet approached.
  if (/not started|to contact|to reach out/.test(v)) return { status: 'selected' };
  if (/target|enriched|qualified|research|to do|prospect/.test(v)) return { status: 'sourcing' };
  if (/^new$/.test(v)) return { status: 'new' };
  return null;
}

const listFields = (l: ListInventory) => l.fields.filter((f) => f.fieldType === 'list');
const pick = (fs: FieldStat[], re: RegExp) => fs.filter((f) => re.test(f.name)).sort((a, b) => b.filled - a.filled)[0]?.name ?? null;

/** A first mapping for a list, from its fields' names and values. */
export function proposeList(l: ListInventory, role: ListMapping['role']): ListMapping {
  const list = listFields(l);
  const dropdowns = list.filter((f) => /dropdown/.test(f.valueType) && f.values?.length);
  // The fields that say where an entry is: a stage or status, most-filled first, with the
  // named ones ("Deal Stage", "Pipeline Status") before a bare "Status".
  const stageish = dropdowns
    .filter((f) => /stage|status/i.test(f.name) && !/time in/i.test(f.name))
    .sort((a, b) => Number(/^status$/i.test(a.name)) - Number(/^status$/i.test(b.name)) || b.filled - a.filled);
  const numbers = list.filter((f) => /number/.test(f.valueType));
  const people = l.fields.filter((f) => /^person/.test(f.valueType) && (f.team?.length ?? 0) > 0);
  const min = pick(numbers, /soft commit min|min(imum)? (soft|commit)/i);
  const max = pick(numbers, /soft commit max|max(imum)? (soft|commit)/i);
  return {
    reviewed: false,
    role,
    status: stageish.map((f) => ({
      field: f.name,
      values: Object.fromEntries((f.values ?? []).map((v) => [v.text, proposeValue(v.text)])),
    })),
    commitment: pick(numbers, /committed amount|^commitment|fund i commitment|^amount( \(usd\))?$|amount invested/i),
    softRange: min && max ? [min, max] : null,
    checkSize: pick(numbers, /check size/i),
    aum: pick(numbers, /\baum\b/i),
    owner: (people.find((f) => /^owner$/i.test(f.name)) ?? people.find((f) => /owner/i.test(f.name) && !/gp/i.test(f.name)) ?? people.sort((a, b) => b.filled - a.filled)[0])?.name ?? null,
    introducer: pick(l.fields, /source of introduction|introduced by|introducer/i),
    doNotContact: pick(list, /do not (contact|approach)|\bdnc\b/i),
    passReason: pick(dropdowns, /pass reason|reason/i),
  };
}

const j = (x: unknown) => JSON.stringify(x);

function block(l: ListInventory, m: ListMapping, counts: Map<string, number>): string {
  const out: string[] = [];
  out.push(`    ${j(l.list.name)}: {`);
  out.push(`      // ${l.vehicleName ?? 'No vehicle'} · ${l.entries} entries. Proposed by Claude; set reviewed to true once it reads right.`);
  out.push(`      "reviewed": ${j(m.reviewed)},`);
  out.push(`      // "pipeline" becomes pursuits for the vehicle; "history" is kept raw and not translated.`);
  out.push(`      "role": ${j(m.role)},`);
  out.push(`      // Where each entry is: the first of these fields with a value wins. For each value:`);
  out.push(`      //   status   ${STATUSES.map((s) => s.id).join(', ')} — or null, unplaced`);
  out.push(`      //   passedBy ${Object.keys(PASSED_BY_LABEL).join(', ')}, and reason (${REASONS.join(', ')}), where it passed`);
  out.push(`      //   implies  what the word says happened, undated (${IMPLIED.map((x) => x.id).join(', ')})`);
  out.push(`      //   next     "On hold" and the like: kept as the status's next step`);
  out.push(`      "status": [`);
  m.status.forEach((src, i) => {
    out.push(`        {`);
    out.push(`          "field": ${j(src.field)},`);
    out.push(`          "values": {`);
    const entries = Object.entries(src.values);
    const width = Math.max(0, ...entries.map(([k]) => j(k).length)) + 1;
    entries.forEach(([k, v], n) => {
      const comma = n < entries.length - 1 ? ',' : '';
      const count = counts.get(`${src.field}\u0000${k}`);
      out.push(`            ${(j(k) + ':').padEnd(width + 1)} ${j(v)}${comma}${count !== undefined ? `  // ${count}` : ''}`);
    });
    out.push(`          }`);
    out.push(`        }${i < m.status.length - 1 ? ',' : ''}`);
  });
  out.push(`      ],`);
  out.push(`      // The commitment: soft, always, until the close room has a countersignature. A word that`);
  out.push(`      // implies "signed" marks it as ready to harden; it does not harden it (rule 1). An entry`);
  out.push(`      // with an amount here is Committed, unless it passed.`);
  out.push(`      "commitment": ${j(m.commitment)},`);
  out.push(`      // A soft circle recorded as a range, [min field, max field], if the list keeps one.`);
  out.push(`      "softRange": ${j(m.softRange)},`);
  out.push(`      // Their typical check for a fund like ours: a guess or their own answer.`);
  out.push(`      "checkSize": ${j(m.checkSize)},`);
  out.push(`      // Their AUM: a claim, like one read on a website, to verify before anything relies on it.`);
  out.push(`      "aum": ${j(m.aum)},`);
  out.push(`      "owner": ${j(m.owner)},`);
  out.push(`      // Who introduced them. Becomes a relationship that needs a person's review (tier C).`);
  out.push(`      "introducer": ${j(m.introducer)},`);
  out.push(`      // Every "yes" here becomes a do-not-approach instruction (rule 8).`);
  out.push(`      "doNotContact": ${j(m.doNotContact)},`);
  out.push(`      // Why they passed, where the list records it separately from the status.`);
  out.push(`      "passReason": ${j(m.passReason)}`);
  out.push(`    }`);
  return out.join('\n');
}

/** The file, for these lists: every edit in `prior` kept, the rest proposed. */
export function mappingFile(inv: Inventory, prior: Record<string, ListMapping> = {}, roles: Record<number, ListMapping['role']> = {}): string {
  const find = (name: string) => Object.entries(prior).find(([k]) => normName(k) === normName(name))?.[1];
  const lists = inv.lists.filter((l) => l.entries > 0 && l.why === 'init');
  const blocks = lists.map((l) => {
    const proposed = proposeList(l, roles[l.list.id] ?? 'pipeline');
    const kept = find(l.list.name);
    // A list written in stages (before N50) that nobody reviewed is proposed afresh; its
    // meanings were the proposer's, not a person's. A reviewed one keeps them, converted.
    const keepValues = kept && (kept.reviewed || !kept.legacy);
    const m: ListMapping = kept
      ? {
          reviewed: kept.reviewed,
          role: kept.role,
          // A value that appeared since the last edit is proposed; every value already there
          // keeps what a person wrote, null included. A status field that appeared is added last.
          status: [
            ...kept.status.map((src) => {
              const fresh = proposed.status.find((p) => p.field === src.field);
              return { field: src.field, values: keepValues ? { ...(fresh?.values ?? {}), ...src.values } : { ...src.values, ...(fresh?.values ?? {}) } };
            }),
            ...proposed.status.filter((p) => !kept.status.some((k) => k.field === p.field)),
          ],
          // A chosen field stays chosen. An empty choice takes a field that has appeared since —
          // so writing null to stop reading a field lasts only until one is proposed again.
          commitment: kept.commitment ?? proposed.commitment,
          softRange: kept.softRange ?? proposed.softRange,
          checkSize: kept.checkSize ?? proposed.checkSize,
          aum: kept.aum ?? proposed.aum,
          owner: kept.owner ?? proposed.owner,
          introducer: kept.introducer ?? proposed.introducer,
          doNotContact: kept.doNotContact ?? proposed.doNotContact,
          passReason: kept.passReason ?? proposed.passReason,
        }
      : proposed;
    const counts = new Map<string, number>();
    for (const f of l.fields) for (const v of f.values ?? []) counts.set(`${f.name}\u0000${v.text}`, v.n);
    return block(l, m, counts);
  });
  return [
    `// How Affinity's lists are read into this tool (docs/16). Written ${inv.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `// in data/${config.data.profile}/, because it names lists and their vocabulary.`,
    '//',
    '// Proposed from the words themselves, and marked reviewed: false until someone says it is right.',
    '// Edit anything; every translation re-reads this file, and regenerating keeps your edits.',
    '{',
    '  "lists": {',
    blocks.join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

export async function readMapping(inv?: Inventory, path = MAPPING_PATH): Promise<MappingReport> {
  const report: MappingReport = { path, exists: false, text: null, lists: {}, problems: [], values: 0, mapped: 0 };
  let text: string;
  try {
    text = await readFile(join(process.cwd(), path), 'utf8');
  } catch {
    return report;
  }
  report.exists = true;
  report.text = text;
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (err) {
    report.problems.push(`Not valid JSON: ${(err as Error).message}`);
    return report;
  }
  const lists = ((raw as { lists?: unknown }).lists ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, m] of Object.entries(lists)) {
    const known = inv?.lists.find((l) => normName(l.list.name) === normName(name));
    if (inv && !known) report.problems.push(`"${name}" is not a list the slice read.`);
    const fields = new Set(known?.fields.map((f) => f.name) ?? []);
    const field = (key: string): string | null => {
      const v = m[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') { report.problems.push(`"${name}".${key} must be a field name or null.`); return null; }
      if (known && !fields.has(v)) report.problems.push(`"${name}".${key}: no field called "${v}" on that list.`);
      return v;
    };
    const status: StatusSource[] = [];
    let legacy = false;
    const sources = (Array.isArray(m.status) ? m.status : Array.isArray(m.stage) ? m.stage : []) as Array<{ field?: unknown; values?: Record<string, unknown> }>;
    for (const src of sources) {
      const f = typeof src.field === 'string' ? src.field : null;
      if (!f) { report.problems.push(`"${name}".status: each entry needs a "field".`); continue; }
      if (known && !fields.has(f)) report.problems.push(`"${name}".status: no field called "${f}" on that list.`);
      const values: Record<string, ValueMap | null> = {};
      for (const [value, vm] of Object.entries(src.values ?? {})) {
        report.values++;
        if (vm === null) { values[value] = null; continue; }
        let x = vm as Record<string, unknown>;
        // Written in stages, before N50: read as statuses.
        if ('stage' in x || 'outcome' in x) {
          legacy = true;
          x = fromLegacy(x) as Record<string, unknown>;
        }
        const bad: string[] = [];
        if (x.status !== undefined && x.status !== null && !STATUS_IDS.has(String(x.status))) bad.push(`status "${String(x.status)}"`);
        if (x.passedBy !== undefined && !(String(x.passedBy) in PASSED_BY_LABEL)) bad.push(`passedBy "${String(x.passedBy)}"`);
        if (x.reason !== undefined && !(REASONS as readonly string[]).includes(String(x.reason))) bad.push(`reason "${String(x.reason)}"`);
        const implies = Array.isArray(x.implies) ? (x.implies as unknown[]).map(String) : [];
        for (const i of implies) if (!IMPLIED_IDS.has(i)) bad.push(`implies "${i}"`);
        if (x.status === 'passed' && !x.passedBy) bad.push('passed with no passedBy');
        if (bad.length) {
          report.problems.push(`"${name}" · ${f} · "${value}": ${bad.join(', ')} is not one this tool has.`);
          values[value] = null;
          continue;
        }
        values[value] = {
          ...(x.status !== undefined ? { status: x.status as PursuitStatus | null } : {}),
          ...(x.passedBy !== undefined ? { passedBy: x.passedBy as PassedBy } : {}),
          ...(x.reason !== undefined ? { reason: x.reason as OutcomeReason } : {}),
          ...(implies.length ? { implies: implies as Implied[] } : {}),
          ...(typeof x.next === 'string' && x.next.trim() ? { next: x.next.trim() } : {}),
          ...(x.skip === true ? { skip: true } : {}),
        };
        if (x.skip === true || x.status) report.mapped++;
      }
      status.push({ field: f, values });
    }
    const range = m.softRange;
    report.lists[name] = {
      reviewed: m.reviewed === true,
      role: m.role === 'history' ? 'history' : 'pipeline',
      status,
      ...(legacy ? { legacy: true } : {}),
      commitment: field('commitment'),
      softRange: Array.isArray(range) && range.length === 2 && range.every((x) => typeof x === 'string') ? [range[0] as string, range[1] as string] : null,
      checkSize: field('checkSize'), aum: field('aum'), owner: field('owner'),
      introducer: field('introducer'), doNotContact: field('doNotContact'), passReason: field('passReason'),
    };
  }
  return report;
}

export async function writeMapping(inv: Inventory, roles: Record<number, ListMapping['role']>, path = MAPPING_PATH): Promise<string> {
  const prior = await readMapping(undefined, path);
  const abs = join(process.cwd(), path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, mappingFile(inv, prior.lists, roles));
  return path;
}

/**
 * Where one entry is, under a list's mapping: the first status field whose value has a meaning.
 * A word that only says "on hold" gives a next step and no status, so the fields after it are
 * still read for the status. If no field places the entry, the first word found is still
 * returned — unplaced — so the page can say which word needs a meaning, rather than reporting
 * the entry as blank.
 */
export function placeEntry(m: ListMapping, valueOf: (field: string) => string | null): {
  said: string | null; map: ValueMap | null; field: string | null;
} {
  let first: { said: string; field: string } | null = null;
  let next: string | undefined;
  for (const src of m.status) {
    const said = valueOf(src.field);
    if (said === null) continue;
    const map = src.values[said] ?? null;
    if (map && (map.skip || map.status)) return { said, map: next && !map.next ? { ...map, next } : map, field: src.field };
    if (map?.next) next ??= map.next;
    first ??= { said, field: src.field };
  }
  if (!first) return { said: null, map: null, field: null };
  return { ...first, map: next ? { status: null, next } : null };
}
