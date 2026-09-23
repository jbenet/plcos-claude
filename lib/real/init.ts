import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { config } from '@/config/deployment';
import { parseJsonc } from '@/lib/jsonc';
import type { Db } from '@/lib/db';

/**
 * The real profile's first rows (N38, docs/15).
 *
 * The demo starts from fixtures; the real profile starts from a file a person fills in —
 * who is on the team, which vehicles exist, which Affinity lists track them. Everything else
 * arrives from Affinity later. The file is JSON with comments because the questions *are*
 * the comments, and it lives in data/real/ because it names people and lists.
 *
 * Loading is repeatable. It adds and updates; it never deletes, because a person removed
 * from the file may still be the author of a review or the owner of an ask.
 */

export const INIT_PATH = join(config.data.root, 'init.jsonc');
export const TEMPLATE_PATH = 'config/init.real.template.jsonc';

export interface TeamMember {
  handle: string;
  name: string;
  initials: string;
  role: string | null;
  email: string | null;
  /** The address they sign in to Affinity with — how an owner or a note author finds them. */
  affinityEmail: string | null;
}

export interface VehicleInit {
  slug: string;
  name: string;
  kind: 'fund' | 'spv' | 'grant_rail';
  /**
   * Required. It decides what may be said in public material, so it is never defaulted.
   * "unknown" is allowed only on a historical vehicle, and the gates read it as 506(c).
   */
  exemption: '506(b)' | '506(c)' | 'n/a' | 'unknown';
  /** "historical": it did not close, and is kept for its history. Default "active". */
  phase: 'active' | 'historical';
  target: number | null;
  firstClose: string | null;
  /** Exact Affinity list names. Matched loosely later — dashes and case vary. */
  affinityLists: string[];
  /** Note text is imported only where this is true. Juan chose Neurotech only (docs/15). */
  importNotes: boolean;
}

export interface RealInit {
  team: TeamMember[];
  vehicles: VehicleInit[];
  answers: Record<string, string | null>;
}

/**
 * The questions that are not a field on a person or a vehicle. The template repeats them
 * as comments; this is the copy the Data page reads, so the two cannot disagree about what
 * is still open.
 */
export const QUESTIONS: Record<string, string> = {
  hardCommitmentRecord:
    'Where is "signed and countersigned" recorded today — an Affinity field, the fund administrator, DocuSign, a spreadsheet? The headline number can only come from there.',
  affinityAmountField:
    'Which Affinity field holds an amount, if any — and does it mean indicated (soft) or signed (hard)?',
  affinityStageField:
    'Which Affinity field holds the stage of a pursuit? The connection test will list the fields on each list.',
  relationshipOwners:
    'Who besides you owns LP relationships in Affinity? Add them to the team with the email they use there.',
  doNotApproach:
    'Is there anyone who must not be approached, or only by one named person? Every route is checked against this (rule 8).',
  spv506b: 'Which SPV is 506(b), if any? (CLAUDE.md, open question 4.)',
  grantsInAffinity: 'Are grants and their funders tracked in Affinity?',
  guessedConstants:
    'Do you have real numbers for any guessed constant — asks per connector per quarter (now 3), the conflict window (now 14 days), the correction budget (now 12 h/week)?',
};

export interface InitReport {
  path: string;
  exists: boolean;
  /** True when this load copied the template into place. */
  created: boolean;
  /** Anything that stops the file loading. Loading is all or nothing. */
  problems: string[];
  /** Unknowns still marked as unknown: a null, an empty list. */
  open: Array<{ where: string; ask: string }>;
  init: RealInit | null;
  hash: string | null;
}

const HANDLE = /^[a-z][a-z0-9-]{0,23}$/;
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['fund', 'spv', 'grant_rail'] as const;
const EXEMPTIONS = ['506(b)', '506(c)', 'n/a', 'unknown'] as const;
const PHASES = ['active', 'historical'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join('');

export function validate(raw: unknown): { init: RealInit | null; problems: string[] } {
  const problems: string[] = [];
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { init: null, problems: ['The file must be one object with "team", "vehicles" and "answers".'] };
  }

  const team: TeamMember[] = [];
  if (!Array.isArray(obj.team) || obj.team.length === 0) {
    problems.push('"team" needs at least one person — the tool cannot open without somebody to be.');
  } else {
    const seen = new Set<string>();
    obj.team.forEach((t: Record<string, unknown>, i: number) => {
      const at = `team[${i}]`;
      const handle = str(t?.handle);
      const name = str(t?.name);
      if (!handle || !HANDLE.test(handle)) problems.push(`${at}.handle must be short, lowercase letters, digits or dashes.`);
      else if (seen.has(handle)) problems.push(`${at}.handle "${handle}" appears twice.`);
      else seen.add(handle);
      if (!name) problems.push(`${at}.name is required.`);
      if (handle && name) {
        team.push({
          handle, name,
          initials: str(t.initials) ?? initialsOf(name),
          role: str(t.role), email: str(t.email), affinityEmail: str(t.affinityEmail),
        });
      }
    });
  }

  const vehicles: VehicleInit[] = [];
  if (!Array.isArray(obj.vehicles) || obj.vehicles.length === 0) {
    problems.push('"vehicles" needs at least one vehicle.');
  } else {
    const seen = new Set<string>();
    obj.vehicles.forEach((v: Record<string, unknown>, i: number) => {
      const slug = str(v?.slug);
      const at = `vehicles[${slug ?? i}]`;
      const name = str(v?.name);
      const kind = v?.kind as VehicleInit['kind'];
      const exemption = v?.exemption as VehicleInit['exemption'];
      if (!slug || !SLUG.test(slug)) problems.push(`${at}.slug must be lowercase letters, digits or dashes.`);
      else if (seen.has(slug)) problems.push(`${at}.slug appears twice.`);
      else seen.add(slug);
      if (!name) problems.push(`${at}.name is required.`);
      if (!KINDS.includes(kind)) problems.push(`${at}.kind must be one of ${KINDS.join(', ')}.`);
      const phase = (v?.phase ?? 'active') as VehicleInit['phase'];
      if (!PHASES.includes(phase)) problems.push(`${at}.phase must be "active" or "historical".`);
      if (!EXEMPTIONS.includes(exemption)) {
        problems.push(`${at}.exemption must be one of 506(b), 506(c), n/a — or "unknown" on a historical vehicle. It is never defaulted: it decides what may be said in public.`);
      } else if (exemption === 'unknown' && phase !== 'historical') {
        problems.push(`${at}.exemption is "unknown", which only a historical vehicle may be. An active one needs 506(b), 506(c) or n/a.`);
      }
      const target = v?.target ?? null;
      if (target !== null && (typeof target !== 'number' || !(target > 0))) problems.push(`${at}.target must be a positive number of dollars, or null.`);
      const firstClose = v?.firstClose ?? null;
      if (firstClose !== null && (typeof firstClose !== 'string' || !DATE.test(firstClose))) problems.push(`${at}.firstClose must be YYYY-MM-DD, or null.`);
      const lists = v?.affinityLists ?? [];
      if (!Array.isArray(lists) || lists.some((l) => typeof l !== 'string')) problems.push(`${at}.affinityLists must be a list of list names.`);
      if (v?.importNotes !== undefined && typeof v.importNotes !== 'boolean') problems.push(`${at}.importNotes must be true or false.`);
      if (slug && name && KINDS.includes(kind) && EXEMPTIONS.includes(exemption) && PHASES.includes((v?.phase ?? 'active') as VehicleInit['phase'])) {
        vehicles.push({
          slug, name, kind, exemption, phase: (v?.phase ?? 'active') as VehicleInit['phase'],
          target: typeof target === 'number' ? target : null,
          firstClose: typeof firstClose === 'string' ? firstClose : null,
          affinityLists: Array.isArray(lists) ? (lists as string[]).map((l) => l.trim()).filter(Boolean) : [],
          importNotes: v.importNotes === true,
        });
      }
    });
  }

  const answers: Record<string, string | null> = {};
  const given = (obj.answers ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(QUESTIONS)) answers[key] = str(given[key]);
  for (const key of Object.keys(given)) {
    if (!(key in QUESTIONS)) problems.push(`answers.${key} is not a question this file asks. A typo?`);
  }

  return problems.length ? { init: null, problems } : { init: { team, vehicles, answers }, problems };
}

/** Every unknown the file still admits to. */
export function openQuestions(init: RealInit): InitReport['open'] {
  const open: InitReport['open'] = [];
  for (const t of init.team) {
    if (!t.role) open.push({ where: `team.${t.handle}.role`, ask: `What does ${t.name} do on the raise?` });
    if (!t.affinityEmail) open.push({ where: `team.${t.handle}.affinityEmail`, ask: `Which email does ${t.name} sign in to Affinity with?` });
  }
  for (const v of init.vehicles) {
    // A historical vehicle has no target to reach and no close to come.
    if (v.phase === 'active' && v.kind !== 'grant_rail' && v.target === null) open.push({ where: `vehicles.${v.slug}.target`, ask: `What is the target for ${v.name}, in dollars?` });
    if (v.phase === 'active' && v.kind !== 'grant_rail' && v.firstClose === null) open.push({ where: `vehicles.${v.slug}.firstClose`, ask: `When is the first close for ${v.name}?` });
    if (v.exemption === 'unknown') open.push({ where: `vehicles.${v.slug}.exemption`, ask: `Was ${v.name} 506(b) or 506(c)? Until you say, it is treated as 506(c).` });
    if (v.kind !== 'grant_rail' && v.affinityLists.length === 0) open.push({ where: `vehicles.${v.slug}.affinityLists`, ask: `Which Affinity list tracks ${v.name}?` });
  }
  for (const [key, ask] of Object.entries(QUESTIONS)) {
    if (init.answers[key] === null) open.push({ where: `answers.${key}`, ask });
  }
  return open;
}

/** Read and check the file without touching the database. */
export async function readInit(): Promise<InitReport> {
  const path = INIT_PATH;
  let text: string;
  try {
    text = await readFile(join(process.cwd(), path), 'utf8');
  } catch {
    return { path, exists: false, created: false, problems: [`${path} does not exist.`], open: [], init: null, hash: null };
  }
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (err) {
    return { path, exists: true, created: false, problems: [`Not valid JSON: ${(err as Error).message}`], open: [], init: null, hash };
  }
  const { init, problems } = validate(raw);
  return { path, exists: true, created: false, problems, open: init ? openQuestions(init) : [], init, hash };
}

/**
 * Put the file's people and vehicles into the database. Creates the file from the template
 * the first time. Refuses outside the real profile, and refuses a file with any problem —
 * half an init file is a team with nobody on it, or a vehicle with no exemption.
 */
export async function loadInit(db: Db): Promise<InitReport> {
  if (config.data.profile !== 'real') throw new Error('The init file belongs to the real profile.');

  let created = false;
  const abs = join(process.cwd(), INIT_PATH);
  const exists = await stat(abs).then(() => true, () => false);
  if (!exists) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(join(process.cwd(), TEMPLATE_PATH), abs);
    created = true;
  }

  const report = { ...(await readInit()), created };
  if (!report.init) {
    console.error(`[init] ${INIT_PATH} was not loaded:\n  ${report.problems.join('\n  ')}`);
    return report;
  }
  const { team, vehicles } = report.init;

  await db.transaction(async (tx) => {
    for (const t of team) {
      await tx.query(
        `insert into platform.app_user (handle, name, initials, role, email)
         values ($1,$2,$3,$4,$5)
         on conflict (handle) do update set name = excluded.name, initials = excluded.initials,
           role = excluded.role, email = excluded.email`,
        [t.handle, t.name, t.initials, t.role ?? '', t.email ?? ''],
      );
    }
    for (const [i, v] of vehicles.entries()) {
      await tx.query(
        `insert into platform.vehicle (slug, name, kind, exemption, target_amount, sort_order, phase)
         values ($1,$2,$3::platform.vehicle_kind,$4,$5,$6,$7)
         on conflict (slug) do update set name = excluded.name, kind = excluded.kind,
           exemption = excluded.exemption, target_amount = excluded.target_amount,
           sort_order = excluded.sort_order, phase = excluded.phase`,
        [v.slug, v.name, v.kind, v.exemption, v.target, i + 1, v.phase],
      );
    }
    await tx.query(
      `insert into platform.source_sync (source, label, status, last_sync_at, detail)
       values ('init', 'Init file', 'ok', now(), $1)
       on conflict (source) do update set status = 'ok', last_sync_at = now(), detail = excluded.detail`,
      [`${INIT_PATH} · ${team.length} ${team.length === 1 ? 'person' : 'people'} · ${vehicles.length} vehicles`],
    );
    await tx.query(
      `insert into platform.source_sync (source, label, status, detail)
       values ('affinity', 'Affinity', 'not_connected', 'Read-only. The connection has not been tested yet.')
       on conflict (source) do nothing`,
    );
    const last = await tx.one<{ hash: string | null }>(
      `select detail->>'hash' as hash from platform.audit_log
        where action = 'init.loaded' order by at desc, id desc limit 1`,
    );
    if (last?.hash !== report.hash) {
      await tx.query(
        `insert into platform.audit_log (action, subject_type, detail) values ('init.loaded', 'init', $1)`,
        [JSON.stringify({ hash: report.hash, people: team.length, vehicles: vehicles.length, open: report.open.length })],
      );
    }
  });
  return report;
}
