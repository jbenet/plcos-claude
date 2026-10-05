/**
 * A prospects file's rows, checked without the database (docs/prospects-import.md): the importer
 * (./prospects.ts), scripts/prospects-check.ts on the Mac, and a cloud push (lib/sync/bundle.ts and
 * lib/sync/push.ts) all read a file through these, so a line refused in one is refused in all of them.
 * No server imports: the Mac's push script loads this.
 */
export interface Prospect {
  entityId?: string | null; entityType?: 'person' | 'org';
  personKey?: string | null; name: string; org: string | null; vehicle: string;
  status: 'new' | 'sourcing' | 'passed';
  decidedAt?: string;
  emailDomain?: string; personalUrls?: string[];
  capacity: { band: string; basis: string; guess: boolean };
  reason: string; strategic: boolean;
  route: { best: string; score: number } | null;
  sources: Array<string | Record<string, unknown>>;
}
export interface ProspectFile { file: string; text: string; mtimeMs?: number; inProgress?: boolean }
export interface ProspectProblem { file: string; line: number; name?: string; vehicle?: string; reason: string }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const words = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
/** Notes retain supplied evidence; this import does not turn estimates into verified claims. */
export function prospectProblems(x: unknown): string[] {
  if (!object(x)) return ['Expected a prospect object'];
  const errors: string[] = [];
  if (x.personKey != null && !words(x.personKey)) errors.push('personKey must be nonempty text, null or absent');
  if (x.entityId != null && !words(x.entityId)) errors.push('entityId must be nonempty text, null or absent');
  if (x.entityType !== undefined && x.entityType !== 'person' && x.entityType !== 'org') errors.push('entityType must be person or org');
  if (x.emailDomain !== undefined && !words(x.emailDomain)) errors.push('emailDomain must be nonempty text');
  if (x.personalUrls !== undefined && (!Array.isArray(x.personalUrls) || !x.personalUrls.every(words))) errors.push('personalUrls must be a text array');
  for (const k of ['name', 'vehicle', 'reason']) if (!words(x[k])) errors.push(`${k} must be nonempty text`);
  if (x.org !== null && !words(x.org)) errors.push('org must be nonempty text or null');
  if (x.status !== 'new' && x.status !== 'sourcing' && x.status !== 'passed') errors.push('status must be new, sourcing or passed');
  if (x.decidedAt !== undefined && (typeof x.decidedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x.decidedAt)
    || !Number.isFinite(Date.parse(x.decidedAt)))) errors.push('decidedAt must be an ISO timestamp with a timezone');
  if (!object(x.capacity) || !words(x.capacity.band) || !words(x.capacity.basis) || typeof x.capacity.guess !== 'boolean') errors.push('capacity needs band, basis and a boolean guess');
  if (typeof x.strategic !== 'boolean') errors.push('strategic must be boolean');
  if (x.route !== null && (!object(x.route) || !words(x.route.best) || typeof x.route.score !== 'number' || !Number.isFinite(x.route.score))) errors.push('route must be null or have best text and a finite score');
  if (!Array.isArray(x.sources) || !x.sources.length || x.sources.some(s => !words(s) && !(object(s) && Object.keys(s).length))) errors.push('sources must contain source strings or objects');
  return errors;
}

/** Row errors are isolated; a whole JSON document/array is not a JSON-lines file. */
export function parseProspectFile(file: ProspectFile): { records: Array<{ p: Prospect; line: number }>; invalid: ProspectProblem[] } {
  const records: Array<{ p: Prospect; line: number }> = [], invalid: ProspectProblem[] = [];
  if (file.inProgress) return { records, invalid };
  const lines = file.text.split('\n');
  try {
    const whole: unknown = JSON.parse(file.text);
    if (Array.isArray(whole) || (object(whole) && lines.filter(l => l.trim()).length > 1)) {
      return { records, invalid: [{ file: file.file, line: 1, reason: 'File skipped: expected JSON lines, not a JSON document or array' }] };
    }
  } catch { /* Multiple JSON values are normal for JSON lines. */ }
  let parsed = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); parsed++; }
    catch { invalid.push({ file: file.file, line: index + 1, reason: 'Invalid JSON; row skipped' }); continue; }
    const errors = prospectProblems(value);
    if (errors.length) invalid.push({ file: file.file, line: index + 1, reason: errors.join('; ') });
    else records.push({ p: value as Prospect, line: index + 1 });
  }
  if (!parsed && invalid.length) return { records: [], invalid: [{ file: file.file, line: 1, reason: 'File skipped: no JSON lines could be read' }] };
  return { records, invalid };
}

/**
 * Every problem in one file, by line: the importer's row checks, and — when `vehicles` is given — that each
 * row's `vehicle` is a known slug. `vehicles` null skips that one check (the caller says so).
 */
export function prospectFileProblems(file: string, text: string, vehicles: ReadonlySet<string> | null): { rows: number; problems: ProspectProblem[] } {
  const { records, invalid } = parseProspectFile({ file, text, inProgress: false });
  const problems = [...invalid];
  if (vehicles) for (const r of records) if (!vehicles.has(r.p.vehicle)) problems.push({ file, line: r.line, vehicle: r.p.vehicle, reason: `Unknown vehicle slug "${r.p.vehicle}"` });
  problems.sort((a, b) => a.line - b.line);
  return { rows: records.length, problems };
}

/**
 * The name a cloud push writes a prospects file under in enrich/prospects/ (lib/sync/push.ts):
 * <date>-push-<first 8 of its run id>-<the name it was pushed with>.jsonl. Only such a name, passed by the
 * push, may skip the importer's two-minute settle wait (./prospects.ts, readProspectFiles).
 */
export const PUSHED_PROSPECTS = /^\d{4}-\d{2}-\d{2}-push-[0-9a-f]{8}-[A-Za-z0-9][\w.-]{0,99}\.jsonl$/;
export const pushedProspectsName = (runId: string, name: string, at = new Date()) => `${at.toISOString().slice(0, 10)}-push-${runId.slice(0, 8).toLowerCase()}-${name}.jsonl`;
/** The names in an import job's `settled` that a push could have written; anything else is ignored. */
export const settledNames = (settled: unknown): Set<string> =>
  new Set((Array.isArray(settled) ? settled : []).filter((n): n is string => typeof n === 'string' && PUSHED_PROSPECTS.test(n)));
