import { createHash } from 'node:crypto';
import { check } from '@/lib/enrich/schema';
import { checkStrategy } from '@/lib/enrich/strategy';
import { factReviewProblems } from '@/lib/enrich/fact-review';
import { prospectFileProblems } from '@/lib/enrich/prospect-rows';

/**
 * A push (docs/deploy/railway.md §7, decision F): one finished W1, W1c or W5 output, as the files the
 * workflow wrote, with their paths relative to enrich/ — the same shape the API workflow returns
 * (lib/workflows/api.ts) — or researched prospects (docs/prospects-import.md, 5 Oct 2026):
 *
 *   { "workflow": "W1" | "W1c" | "W5" | "prospects",
 *     "files": [{ "path": "raw/<key>.json" | "strategy/[<vehicle>/]<key>.json" | "fact-review-<NN><part>.jsonl"
 *                       | "prospects/<name>.jsonl", "content": … }],
 *     "run": { "id": "<the Mac's ledger run id>", "source": "claude-code", "agent": "…", "model": "…" } }   (optional)
 *
 * A review file's content is its rows, as a list; a prospects file's is its text, as written, so its line
 * numbers are the file's. These checks need no server state, so the Mac runs
 * them before sending (scripts/cloud-push.sh) and the server runs them again. A claim sourced from Dakota
 * is validated like any other: the cloud is our system, as PL's warehouse is (Juan, 4 Oct 2026).
 */
export type PushWorkflow = 'W1' | 'W1c' | 'W5' | 'prospects';
export interface PushFile { path: string; content: unknown }
export interface PushRun { id?: string; source?: string; agent?: string; model?: string | null; protocol?: { version?: string | null; hash?: string } }
export interface PushBundle { workflow: PushWorkflow; files: PushFile[]; run?: PushRun }
/** One reason a push was refused: the file it is about (null for the push as a whole) and its problems. */
export interface Rejection { path: string | null; problems: string[] }

/** A finding key is the file name, so no slash or dot; ":" is allowed, since keys from prospects carry it (6 Oct 2026: a Mac push refused for it). */
export const RAW = /^raw\/([\w:-]+)\.json$/;
export const STRATEGY = /^strategy\/(?:([\w-]+)\/)?([\w:-]+)\.json$/;
export const REVIEW = /^fact-review-[\w-]+\.jsonl$/;
/** A prospects file, by the name it is pushed with; the server writes it under a run-specific name (lib/sync/push.ts). */
export const PROSPECTS = /^prospects\/([A-Za-z0-9][\w.-]{0,99})\.jsonl$/;

/** The key a file is about, or null for a review file. */
export const keyOf = (path: string) => RAW.exec(path)?.[1] ?? STRATEGY.exec(path)?.[2] ?? null;

const stable = (v: unknown): string => JSON.stringify(v, (_k, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value);

/** The push's identity: SHA-256 of its workflow and files, keys sorted, files by path. The run metadata is not part of it. */
export function bundleHash(b: Pick<PushBundle, 'workflow' | 'files'>): string {
  const files = [...b.files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)).map((f) => ({ path: f.path, content: f.content }));
  return createHash('sha256').update(stable({ workflow: b.workflow, files }), 'utf8').digest('hex');
}

export function checkBundle(input: unknown, maxFiles: number): { bundle: PushBundle | null; rejections: Rejection[] } {
  const whole = (problem: string) => ({ bundle: null, rejections: [{ path: null, problems: [problem] }] });
  const b = input as Partial<PushBundle> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return whole('the push is not a JSON object');
  if (!['W1', 'W1c', 'W5', 'prospects'].includes(b.workflow as string)) return whole('workflow must be W1, W1c, W5 or prospects');
  if (!Array.isArray(b.files) || !b.files.length) return whole('files must be a non-empty list');
  if (b.files.length > maxFiles) return whole(`more than ${maxFiles} files; push the batch in parts`);
  if (b.run !== undefined && (!b.run || typeof b.run !== 'object' || Array.isArray(b.run))) return whole('run must be an object');
  const rejections: Rejection[] = [];
  const paths = new Set<string>();
  const reviews: string[] = [], rawKeys: string[] = [];
  b.files.forEach((f, i) => {
    const path = typeof f?.path === 'string' ? f.path : null;
    const problems: string[] = [];
    if (!f || typeof f !== 'object' || !path) { rejections.push({ path: `files[${i}]`, problems: ['needs a path and a content'] }); return; }
    if (paths.has(path)) problems.push('the same path twice');
    paths.add(path);
    const raw = RAW.exec(path), strategy = STRATEGY.exec(path), review = REVIEW.test(path), prospects = PROSPECTS.exec(path);
    const allowed = b.workflow === 'prospects' ? Boolean(prospects) : b.workflow === 'W1' ? Boolean(raw) : b.workflow === 'W5' ? Boolean(strategy) : Boolean(raw) || review;
    if (!allowed) problems.push(b.workflow === 'prospects' ? 'a prospects push holds prospects/<name>.jsonl files only (letters, digits, dot, dash, underscore)'
      : b.workflow === 'W1' ? 'a W1 push holds raw/<key>.json files only'
      : b.workflow === 'W5' ? 'a W5 push holds strategy/[<vehicle>/]<key>.json files only'
        : 'a W1c push holds one fact-review-<NN><part>.jsonl and its corrected raw/<key>.json files');
    else if (prospects) {
      // The importer's own row checks, by line; whether each vehicle exists is the server's to say (lib/sync/push.ts).
      if (typeof f.content !== 'string' || !f.content.trim()) problems.push('a prospects file\'s content is its text, one JSON object per line');
      else {
        const { rows, problems: lines } = prospectFileProblems(prospects[1]!, f.content, null);
        problems.push(...lines.map((p) => `line ${p.line}: ${p.reason}`));
        if (!rows && !lines.length) problems.push('the file holds no prospect rows');
      }
    } else if (raw) { rawKeys.push(raw[1]!); problems.push(...check(f.content, raw[1])); }
    else if (strategy) {
      problems.push(...checkStrategy(f.content, strategy[2]));
      if (strategy[1] && (f.content as { ask?: { vehicle?: unknown } } | null)?.ask?.vehicle !== strategy[1]) problems.push('ask.vehicle does not match its folder');
    } else if (review) {
      reviews.push(path);
      if (!Array.isArray(f.content) || !f.content.length) problems.push('a review file is a non-empty list of rows');
      else {
        const keys = new Set<string>();
        (f.content as unknown[]).forEach((row, r) => {
          // Grades are checked against the server's finding later; here, only what the row says of itself.
          const own = factReviewProblems(row, { facts: Array.isArray((row as { facts?: unknown[] })?.facts) ? (row as { facts: unknown[] }).facts : [] });
          if (own.length) problems.push(...own.map((p) => `row ${r + 1}: ${p}`));
          const key = (row as { key?: unknown })?.key;
          if (typeof key === 'string') { if (keys.has(key)) problems.push(`row ${r + 1}: key reviewed twice`); keys.add(key); }
        });
      }
    }
    if (problems.length) rejections.push({ path, problems });
  });
  if (b.workflow === 'W1c') {
    if (reviews.length !== 1) rejections.push({ path: null, problems: [`a W1c push holds exactly one review file (it has ${reviews.length})`] });
    else {
      const reviewed = new Set(((b.files.find((f) => f.path === reviews[0])?.content ?? []) as Array<{ key?: unknown }>).map((r) => r?.key));
      const unreviewed = rawKeys.filter((k) => !reviewed.has(k));
      if (unreviewed.length) rejections.push({ path: null, problems: [`${unreviewed.length} corrected findings have no row in the review: ${unreviewed.slice(0, 10).join(', ')}`] });
    }
  }
  return { bundle: rejections.length ? null : { workflow: b.workflow as PushWorkflow, files: b.files as PushFile[], run: b.run }, rejections };
}

/** When a file was last written by a workflow: a finding's reading or latest correction, a strategy's writing or latest revision. */
export function writtenAt(content: unknown): number | null {
  const c = content as { researched?: { at?: string; corrected?: Array<{ at?: string }> }; made?: { at?: string; revised?: Array<{ at?: string }> } } | null;
  const dates = [c?.researched?.at, ...(c?.researched?.corrected ?? []).map((x) => x?.at), c?.made?.at, ...(c?.made?.revised ?? []).map((x) => x?.at)]
    .map((d) => (typeof d === 'string' ? Date.parse(d) : NaN)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : null;
}
