/**
 * The pure parts of the Mac's Astra runner (scripts/astra-runner.ts, docs/30-astra-runner.md), kept here so the
 * property tests reach them without a Mac, a Keychain or codex.
 */
import { inWindow } from './jobs';

export const CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
export const MODELS = ['gpt-6-astra', 'gpt-6-sol'] as const;
/** A worker that runs longer than this is stopped and its run failed (a W1+W5 batch of 5 took 40–90 min in Oct). */
export const RUN_LIMIT_MS = 3 * 3600_000;
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

/** codex exec's arguments: a research worker with web search, writing only inside the worker folder and enrich/. */
export function codexArgs(o: { model: string; worker: string; enrich: string; last: string; git?: string[] }): string[] {
  return ['exec', '-m', o.model, '-C', o.worker, '-s', 'workspace-write', '--skip-git-repo-check',
    '--add-dir', o.enrich, ...(o.git ?? []).flatMap((d) => ['--add-dir', d]),
    '-c', 'sandbox_workspace_write.network_access=true', '-c', 'tools.web_search=true', '-o', o.last, '-'];
}

/** Whether a finished attempt should fall back to the next model: only when it wrote no final message and said "at capacity". */
export function shouldFallBack(lastMessage: string, log: string): boolean {
  return !lastMessage.trim() && /model is at capacity/i.test(log);
}

/** The batch file's prefix for a job: short, unique, and recognisably the runner's. */
export const batchPrefix = (jobId: string) => `astra-${jobId.slice(0, 8)}-`;
