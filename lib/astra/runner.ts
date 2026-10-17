/**
 * The pure parts of the Mac's Astra runner (scripts/astra-runner.ts, docs/30-astra-runner.md), kept here so the
 * property tests reach them without a Mac, a Keychain or codex.
 */
import { FOCUS_MAX, FOCUS_PATTERN, inWindow } from './jobs';

export const CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
export const MODELS = ['gpt-6-astra', 'gpt-6-sol'] as const;
/**
 * A worker that runs longer than this is stopped and its run failed, so a stuck run can't burn tokens for hours.
 * Guessed from Oct runs: a W1+W5 batch of 5 took 40–90 min, a w5t batch of 8 took 6–9 min (Juan, 12 Oct: "make sure
 * astra doesnt do silly things and run up the token bill").
 */
export const RUN_LIMIT_MS: Record<string, number> = { w1w5: 2 * 3600_000, w1: 90 * 60_000, w5: 45 * 60_000, w5t: 25 * 60_000,
  w1s: 90 * 60_000, w5r: 45 * 60_000 };
/** Workflows that research the public web; the others work from local files only and get no web search. */
/** How long the runner holds new runs while it fetches a stale research export (guessed: an export takes a few minutes). */
export const RESEARCH_HOLD_MS = 30 * 60_000;
export const WEB_WORKFLOWS: readonly string[] = ['w1w5', 'w1', 'w1s'];
/** After both models report "at capacity", the runner claims nothing for this long. */
export const CAPACITY_WAIT_MS = 30 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The night a local time belongs to: the date the window opened. 02:00 on the 11th in a 22–07 window is the
 * night of the 10th, so Auto queues one night's runs once, not again after midnight.
 */
export function nightOf(now: Date, start: number, end: number): { night: string; inWindow: boolean } {
  const open = inWindow(now.getHours(), start, end);
  const wraps = start > end;
  const night = open && wraps && now.getHours() < end ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
  return { night: localDate(night), inWindow: open };
}

/** Fill `{{name}}` from `values`; an unknown name is an error, so a template typo never ships a half-filled brief. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`The brief template names {{${name}}}, which the runner does not fill.`);
    return values[name]!;
  });
}

/**
 * codex exec's arguments: a research worker writing only inside the worker folder and enrich/. Only a web workflow gets
 * the network: a strategy run reads the team's notes and quoted mail, so it must not be able to send anything out (red
 * team, 17 Oct 2026).
 */
export function codexArgs(o: { model: string; worker: string; enrich: string; last: string; git?: string[]; web?: boolean }): string[] {
  return ['exec', '-m', o.model, '-C', o.worker, '-s', 'workspace-write', '--skip-git-repo-check',
    '--add-dir', o.enrich, ...(o.git ?? []).flatMap((d) => ['--add-dir', d]),
    '-c', `sandbox_workspace_write.network_access=${o.web ?? true}`, '-c', `tools.web_search=${o.web ?? true}`, '-o', o.last, '-'];
}

/** Whether a finished attempt should fall back to the next model: only when it wrote no final message and said "at capacity". */
export function shouldFallBack(lastMessage: string, log: string): boolean {
  return !lastMessage.trim() && /model is at capacity/i.test(log);
}

/**
 * The batch file's prefix for a job: the whole job id without dashes, so two jobs never share a batch file (8 hex
 * characters could collide: red team, 17 Oct 2026), and recognisably the runner's (astra-<id>-NN, as enrich-batch.ts's
 * astra-[\w-]+ holds match).
 */
export const batchPrefix = (jobId: string) => `astra-${jobId.replace(/-/g, '')}-`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface RunnerJob<W extends string = string> { id: string; workflow: W; size: number; focus?: string[] }

/**
 * A job as the server handed it, checked before the runner builds any path or argument from it: an id that is not a
 * UUID, a workflow this runner does not name, a size outside 1–20, or a focus the server itself would refuse (one
 * starting `--` would read as a flag) drops the job (red team, 17 Oct 2026).
 */
export function acceptJob<W extends string>(raw: unknown, workflows: readonly W[]): RunnerJob<W> | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const workflow = workflows.find((w) => w === j.workflow);
  if (typeof j.id !== 'string' || !UUID.test(j.id) || !workflow) return null;
  if (!Number.isSafeInteger(j.size) || (j.size as number) < 1 || (j.size as number) > 20) return null;
  const focus = j.focus === undefined || j.focus === null ? [] : j.focus;
  if (!Array.isArray(focus) || focus.length > FOCUS_MAX || !focus.every((f) => typeof f === 'string' && FOCUS_PATTERN.test(f))) return null;
  return { id: j.id.toLowerCase(), workflow, size: j.size as number, focus: focus as string[] };
}
