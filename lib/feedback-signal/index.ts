/**
 * The feedback signal (docs/deploy/04-feedback-signal.md). Juan, 7 Oct 2026: "can poll feedback, or can
 * setup a callback in the app to tell you … ideally want an efficient way of signaling project dev to pick
 * up tasks". So the app tells, once per burst: after the ingester files issues, their ids wait in
 * inbox/signal.json, and when the box has been quiet for QUIET_MS this server fires the project's Claude
 * Code routine, which wakes the feedback thread. Nothing polls and an idle day costs nothing.
 *
 * The signal carries ids and a signed read link, never an issue's words: the issue text is real data and
 * the thread reads it from this server while working (docs/agent-rules/real-data.md). The link is
 * GET /api/feedback/signal, limited to those ids, expiring after LINK_TTL_MS, signed with a key derived
 * from the routine token, so turning the signal off also kills every link it sent.
 *
 * The state file survives a restart; a failed fire is retried with backoff on later ingest passes.
 * Never throws into the ingester.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inboxDir, writeAtomic } from '@/lib/feedback-inbox';

/** GUESS: wait this long after the last filing, so a burst of reports wakes the thread once. */
export const QUIET_MS = 90_000;
/** GUESS: at most one fire this often; reports in between ride the next one. The routine API allows 100 an hour per account. */
export const MIN_GAP_MS = 10 * 60_000;
/** GUESS: the thread may wake late (a container restart), so a link lasts three days. */
export const LINK_TTL_MS = 3 * 24 * 60 * 60_000;
/** One fire names at most this many; the rest go in the next. */
export const MAX_IDS = 50;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const FILE = 'signal.json';

export interface SignalState {
  pending: string[];
  lastFiledAt: string | null;
  lastFiredAt: string | null;
  failures: number;
  nextTryAt: string | null;
  lastError: string | null;
}

export interface SignalTarget {
  /** The routine's fire URL and token; either missing means the signal is off. */
  url: string | undefined;
  token: string | undefined;
  /** This server's public origin, for the read link. None (the Mac app) means the thread reads the files there. */
  origin: string | undefined;
  /** Where the issue files are, said in the signal when there is no link. */
  issuesDir: string;
}

export type TickResult = 'off' | 'idle' | 'waiting' | 'fired' | 'failed';

const empty = (): SignalState => ({ pending: [], lastFiledAt: null, lastFiredAt: null, failures: 0, nextTryAt: null, lastError: null });

export async function readSignalState(issuesRoot: string): Promise<SignalState> {
  try {
    return { ...empty(), ...(JSON.parse(await readFile(join(inboxDir(issuesRoot), FILE), 'utf8')) as Partial<SignalState>) };
  } catch {
    return empty();
  }
}

const save = (issuesRoot: string, s: SignalState) => writeAtomic(inboxDir(issuesRoot), FILE, JSON.stringify(s));

export const signalOn = (t: Pick<SignalTarget, 'url' | 'token'>): boolean => !!t.url && !!t.token;

/** Ids the ingester just filed. Off, nothing is kept: turning it on later does not replay a backlog. */
export async function queueSignal(issuesRoot: string, ids: string[], target: SignalTarget, now = new Date()): Promise<void> {
  if (!ids.length || !signalOn(target)) return;
  const s = await readSignalState(issuesRoot);
  s.pending = [...new Set([...s.pending, ...ids])].sort();
  s.lastFiledAt = now.toISOString();
  await save(issuesRoot, s);
}

// ---------------------------------------------------------------- the read link

const readKey = (token: string) => createHmac('sha256', token).update('plcos feedback read link v1').digest();

export function signRead(token: string, ids: string[], exp: number): string {
  return createHmac('sha256', readKey(token)).update(`${ids.join(',')}|${exp}`).digest('hex');
}

export function verifyRead(token: string, ids: string[], exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isSafeInteger(exp) || exp * 1000 <= now || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const want = Buffer.from(signRead(token, ids, exp), 'hex');
  return timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

export function readLink(origin: string, token: string, ids: string[], now = Date.now()): { url: string; expires: string } {
  const exp = Math.floor((now + LINK_TTL_MS) / 1000);
  const q = new URLSearchParams({ ids: ids.join(','), exp: String(exp), sig: signRead(token, ids, exp) });
  return { url: `${origin}/api/feedback/signal?${q}`, expires: new Date(exp * 1000).toISOString() };
}

/** What the routine receives. Ids, where to read them, and nothing an issue says. */
export function signalText(ids: string[], target: SignalTarget, now = Date.now()): string {
  const lines = ['PLC OS feedback signal', `new issues: ${ids.join(', ')}`];
  if (target.origin && target.token) {
    const link = readLink(target.origin, target.token, ids, now);
    lines.push(`server: ${target.origin}`, `read: ${link.url}`, `link expires: ${link.expires}`);
  } else {
    lines.push('server: the Mac app (no public address)', `read: the files in ${target.issuesDir} in the live folder on the Mac`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- firing

/** One step: fire if anything waits, the box is quiet, the gap has passed and no backoff holds. */
export async function tickSignal(
  issuesRoot: string, target: SignalTarget,
  opts: { now?: Date; fetch?: typeof fetch } = {},
): Promise<TickResult> {
  if (!signalOn(target)) return 'off';
  const now = opts.now ?? new Date();
  const s = await readSignalState(issuesRoot);
  if (!s.pending.length) return 'idle';
  const t = now.getTime();
  if (s.lastFiledAt && t - Date.parse(s.lastFiledAt) < QUIET_MS) return 'waiting';
  if (s.lastFiredAt && t - Date.parse(s.lastFiredAt) < MIN_GAP_MS) return 'waiting';
  if (s.nextTryAt && t < Date.parse(s.nextTryAt)) return 'waiting';

  const ids = s.pending.slice(0, MAX_IDS);
  let error: string | null = null;
  try {
    const res = await (opts.fetch ?? fetch)(target.url!, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: signalText(ids, target, t) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) error = `the routine answered ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Re-read: the ingester may have queued more while the request was out.
  const after = await readSignalState(issuesRoot);
  if (error) {
    after.failures += 1;
    after.nextTryAt = new Date(t + BACKOFF_MS[Math.min(after.failures, BACKOFF_MS.length) - 1]!).toISOString();
    after.lastError = error;
    await save(issuesRoot, after);
    return 'failed';
  }
  const sent = new Set(ids);
  after.pending = after.pending.filter((id) => !sent.has(id));
  after.lastFiredAt = now.toISOString();
  after.failures = 0;
  after.nextTryAt = null;
  after.lastError = null;
  await save(issuesRoot, after);
  return 'fired';
}

/** The ingester's hook: this server's settings, then queue and tick. Never throws. */
export async function signalAfterPass(issuesRoot: string, filedIds: string[]): Promise<TickResult | null> {
  try {
    const [{ settingsReady, settingValue }, { config }, setting] = await Promise.all([
      import('@/lib/settings/store'), import('@/config/deployment'), import('./setting'),
    ]);
    await settingsReady().catch(() => undefined);
    // A preview copy never signals: it files nothing, and its issues are the live server's.
    if (config.data.copyTakenAt) return 'off';
    const target: SignalTarget = {
      url: settingValue(setting.FEEDBACK_SIGNAL_URL_SETTING.key),
      token: settingValue(setting.FEEDBACK_SIGNAL_TOKEN_SETTING.key),
      origin: settingValue('app.publicUrl'),
      issuesDir: config.issues.dir,
    };
    await queueSignal(issuesRoot, filedIds, target);
    const result = await tickSignal(issuesRoot, target);
    if (result === 'failed') {
      const s = await readSignalState(issuesRoot);
      if (s.failures === 1) console.warn(`[feedback] the signal did not reach the routine (${s.lastError}); retried later`);
    }
    return result;
  } catch (err) {
    console.warn('[feedback] signal step failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
