import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { config } from '@/config/deployment';
import { parseJsonc } from '@/lib/jsonc';
import type { Db, Queryable } from '@/lib/db';
import { recordActivity } from '@/lib/activity/log';
import { writeVehicle } from '@/modules/platform';

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
  /** Their default-to address: the one they mostly use, and the one we email them at (app_user.email). */
  email: string | null;
  /** The address they sign in with (Google), when it is not `email`. Optional. */
  login?: string | null;
  /** Other addresses of theirs. Sign-in and mail matching accept any of them. Optional. */
  aliases?: string[];
  /** The address they sign in to Affinity with — how an owner or a note author finds them. */
  affinityEmail: string | null;
  /** The address they sign in to Linear with, when it is not `email` — how "My Linear" finds their issues. Optional. */
  linearEmail: string | null;
  /** Omitted grants preserve existing rows; new rows default to Juan Admin / everyone else Team. */
  access?: import('@/lib/authz').Role;
  vehicles?: string[] | null;
  approves?: string[];
  /** false deactivates them (they can no longer sign in; their history stays). Omitted keeps the row's state. */
  active?: boolean;
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
  /**
   * When it is raising (N59): an email or meeting outside the window is not about this raise.
   * `closes` null while it is still open. `note` says when the dates are a guess.
   */
  raise: { opens: string | null; closes: string | null; note: string | null };
  /** Words that name it in a subject line or a meeting title, besides its name (N59). */
  aliases: string[];
  // `importNotes` is retired (N49): every note in the account is kept, whichever list it is
  // on (Juan, 23 Sep). A file that still has it loads; the value is ignored.
}

export interface RealInit {
  team: TeamMember[];
  vehicles: VehicleInit[];
  answers: Record<string, string | null>;
  /**
   * The email domains the team raises from (N59). An email or a meeting to or from one of them,
   * inside a raise window, is taken to be about the raise.
   */
  fundraiseDomains: string[];
  /** The firm's names, as a subject line would carry them: naming it is speaking of a raise (N59). */
  firmNames: string[];
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

/** Every address of a team member the file names (default-to, login, aliases), lower-cased. */
export function memberAddresses(t: Pick<TeamMember, 'email' | 'login' | 'aliases'>): string[] {
  return [...new Set([t.email, t.login, ...(t.aliases ?? [])].filter((a): a is string => !!a && !!a.trim()).map((a) => a.trim().toLowerCase()))];
}

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
      if (t?.access !== undefined && !['admin', 'team', 'viewer'].includes(String(t.access))) problems.push(`${at}.access must be admin, team or viewer.`);
      if (t?.vehicles !== undefined && t.vehicles !== null && (!Array.isArray(t.vehicles) || t.vehicles.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)))) problems.push(`${at}.vehicles must be null (all) or a list of vehicle UUIDs.`);
      const addr = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
      if (t?.email !== undefined && t.email !== null && t.email !== '' && !addr(t.email)) problems.push(`${at}.email must be an email address.`);
      if (t?.login !== undefined && t.login !== null && t.login !== '' && !addr(t.login)) problems.push(`${at}.login must be an email address.`);
      if (t?.aliases !== undefined && (!Array.isArray(t.aliases) || t.aliases.some((a) => !addr(a)))) problems.push(`${at}.aliases must be a list of email addresses.`);
      if (t?.active !== undefined && typeof t.active !== 'boolean') problems.push(`${at}.active must be true or false.`);
      if (t?.approves !== undefined && (!Array.isArray(t.approves) || t.approves.some(k => !['STAGE', 'INTRO_ASK', 'SEND'].includes(String(k))))) problems.push(`${at}.approves may contain STAGE, INTRO_ASK and SEND; money/allocation require Admin.`);
      if (handle && name) {
        team.push({
          handle, name,
          initials: str(t.initials) ?? initialsOf(name),
          role: str(t.role), email: str(t.email), affinityEmail: str(t.affinityEmail), linearEmail: str(t.linearEmail),
          ...(t.login === undefined ? {} : { login: str(t.login) }),
          ...(Array.isArray(t.aliases) ? { aliases: (t.aliases as unknown[]).filter((a): a is string => typeof a === 'string').map((a) => a.trim()) } : {}),
          ...(t.access === undefined ? {} : { access: t.access as TeamMember['access'] }),
          ...(t.vehicles === undefined ? {} : { vehicles: t.vehicles as TeamMember['vehicles'] }),
          ...(t.approves === undefined ? {} : { approves: t.approves as string[] }),
          ...(typeof t.active === 'boolean' ? { active: t.active } : {}),
        });
      }
    });
  }

  // An address names one person: the same address on two people in the file is a problem, never a guess.
  const owner = new Map<string, string>();
  for (const t of team) {
    for (const a of memberAddresses(t)) {
      const was = owner.get(a);
      if (was && was !== t.handle) problems.push(`team.${t.handle}: ${a} is also ${was}'s address. An address belongs to one person.`);
      else owner.set(a, t.handle);
    }
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
      const raise = (v?.raise ?? {}) as Record<string, unknown>;
      const opens = raise.opens ?? null;
      const closes = raise.closes ?? null;
      for (const [k, d] of [['opens', opens], ['closes', closes]] as const) {
        if (d !== null && (typeof d !== 'string' || !DATE.test(d))) problems.push(`${at}.raise.${k} must be YYYY-MM-DD, or null.`);
      }
      const aliases = v?.aliases ?? [];
      if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== 'string')) problems.push(`${at}.aliases must be a list of words.`);
      if (slug && name && KINDS.includes(kind) && EXEMPTIONS.includes(exemption) && PHASES.includes((v?.phase ?? 'active') as VehicleInit['phase'])) {
        vehicles.push({
          slug, name, kind, exemption, phase: (v?.phase ?? 'active') as VehicleInit['phase'],
          target: typeof target === 'number' ? target : null,
          firstClose: typeof firstClose === 'string' ? firstClose : null,
          affinityLists: Array.isArray(lists) ? (lists as string[]).map((l) => l.trim()).filter(Boolean) : [],
          raise: {
            opens: typeof opens === 'string' ? opens : null,
            closes: typeof closes === 'string' ? closes : null,
            note: str(raise.note),
          },
          aliases: Array.isArray(aliases) ? (aliases as string[]).map((a) => a.trim()).filter(Boolean) : [],
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

  const domains = obj.fundraiseDomains ?? [];
  if (!Array.isArray(domains) || domains.some((d) => typeof d !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))) {
    problems.push('"fundraiseDomains" must be a list of email domains, like "example.com".');
  }
  const fundraiseDomains = Array.isArray(domains) ? (domains as string[]).map((d) => d.trim().toLowerCase()) : [];
  const firm = obj.firmNames ?? [];
  if (!Array.isArray(firm) || firm.some((f) => typeof f !== 'string')) problems.push('"firmNames" must be a list of names.');
  const firmNames = Array.isArray(firm) ? (firm as string[]).map((f) => f.trim()).filter(Boolean) : [];

  return problems.length ? { init: null, problems } : { init: { team, vehicles, answers, fundraiseDomains, firmNames }, problems };
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

/** Explicit grant fields change permissions; omitted fields cannot widen an existing user's access. */
export async function upsertTeamMember(db: Queryable, t: TeamMember): Promise<void> {
  await db.query(
    `insert into platform.app_user (handle, name, initials, role, email, access, vehicles, approves, linear_email, active)
         values ($1,$2,$3,$4,$5,coalesce($6::platform.access_role,case when $1 = 'juan' then 'admin'::platform.access_role else 'team'::platform.access_role end),$7::uuid[],coalesce($9::text[],'{}'),$10,coalesce($11::boolean,true))
         on conflict (handle) do update set name = coalesce((
           select a.detail->>'name' from platform.audit_log a
           where a.subject_type='app_user' and a.subject_id=app_user.id::text
             and a.action='identity.team_roster_updated'
           order by a.at desc,a.id desc limit 1), excluded.name), initials = excluded.initials,
           role = excluded.role, email = excluded.email, linear_email = excluded.linear_email,
           access = coalesce($6::platform.access_role, app_user.access),
           vehicles = case when $8::boolean then excluded.vehicles else app_user.vehicles end,
           approves = coalesce($9::text[], app_user.approves),
           active = coalesce($11::boolean, app_user.active)`,
    [t.handle, t.name, t.initials, t.role ?? '', t.email ?? '', t.access ?? null, t.vehicles ?? null, t.vehicles !== undefined, t.approves ?? null, t.linearEmail ?? null, t.active ?? null],
  );
  // Their addresses become exactly the file's: default-to, login, aliases (platform.user_address).
  const { setAddresses } = await import('@/modules/platform');
  const id = (await db.one<{ id: string }>('select id::text from platform.app_user where handle = $1', [t.handle]))!.id;
  await setAddresses(db, id, { default: t.email, login: t.login ?? null, aliases: t.aliases ?? [] });
}

/** The file's team, all or nothing: the address clashes if there are any (and nothing written), else []. */
export async function applyTeam(db: Queryable, team: TeamMember[]): Promise<string[]> {
  const clashes = await addressProblems(db, team);
  if (clashes.length) return clashes;
  for (const t of team) await upsertTeamMember(db, t);
  return [];
}

/**
 * Addresses in the file that someone else already holds in the database: reported as problems before anything
 * is applied, never silently moved from one person to another.
 */
export async function addressProblems(db: Queryable, team: TeamMember[]): Promise<string[]> {
  const problems: string[] = [];
  for (const t of team) {
    const addresses = memberAddresses(t);
    if (!addresses.length) continue;
    const rows = await db.query<{ address: string; handle: string }>(`select a.address, u.handle from platform.user_address a
      join platform.app_user u on u.id = a.user_id where lower(a.address) = any($1::text[]) and u.handle <> $2`, [addresses, t.handle]);
    for (const r of rows) problems.push(`team.${t.handle}: ${r.address.toLowerCase()} already belongs to ${r.handle}. Remove it from one of them first.`);
  }
  return problems;
}

/**
 * The file's vehicles, by the same row writer Settings → Vehicles uses (modules/platform/vehicles.ts): an
 * upsert by slug, in the file's order. A vehicle made in the app and absent from the file is left alone
 * (a reload never deletes); one the file names is updated to match it.
 */
export async function applyVehicles(db: Queryable, vehicles: VehicleInit[]): Promise<void> {
  for (const [i, v] of vehicles.entries()) await writeVehicle(db, v, i + 1, 'update');
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

  const activityAt = new Date().toISOString();
  let imported = false;
  await db.transaction(async (tx) => {
    const last = await tx.one<{ hash: string | null }>(
      `select detail->>'hash' as hash from platform.audit_log
        where action = 'init.loaded' order by at desc, id desc limit 1`,
    );
    // A successful load already applied this exact file. Avoid no-op upserts on boot:
    // even unchanged rows fire statement triggers and invalidate persisted route caches.
    if (last?.hash === report.hash) return;
    // An address held by someone else is a problem like any other: nothing is applied.
    const clashes = await applyTeam(tx, team);
    if (clashes.length) { report.problems.push(...clashes); return; }
    await applyVehicles(tx, vehicles);
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
    await tx.query(
      `insert into platform.audit_log (action, subject_type, detail) values ('init.loaded', 'init', $1)`,
      [JSON.stringify({ hash: report.hash, people: team.length, vehicles: vehicles.length, open: report.open.length })],
    );
    imported = true;
  });
  if (report.problems.length) console.error(`[init] ${INIT_PATH} was not loaded:\n  ${report.problems.join('\n  ')}`);
  if (imported) await recordActivity({ source: 'intake', at: activityAt, segment: 'init', requests: 0,
    bytesIn: await stat(abs).then(s => s.size, () => null), bytesOut: 0, records: team.length + vehicles.length });
  return report;
}
