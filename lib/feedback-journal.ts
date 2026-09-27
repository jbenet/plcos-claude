/**
 * The feedback journal's rules (Juan, 27 Sep: "can't submit feedback" while an import pegs the
 * server; then "it should journal to the server. the page may die or close forever").
 *
 * File posts the report to /api/feedback, which journals it on the server and answers 202 at once
 * (lib/feedback-inbox.ts); the server files it afterwards. The browser's outbox is the fallback for
 * when the request cannot reach the server at all — a restart, the network — and keeps resending
 * until the server accepts. This file is the part with no browser in it — the backoff, what counts
 * as acceptance, and what a response does to the outbox — so the properties can hold it to them
 * (scripts/properties/feedback-journal.ts). The storage and the sender are in lib/feedback-outbox.ts.
 */

/** What the feedback route takes, as the box sends it. */
export interface FeedbackRequest {
  title: string;
  body: string;
  kind: string;
  priority: string;
  page: string;
  context: Record<string, unknown>;
  screenshots: string[];
  images: Array<{ name?: string; dataUrl: string }>;
  imageOffset: number;
}

/** A note from the connection-feedback form (components/routes/ConnectionFeedback.tsx). */
export interface ConnectionNoteRequest {
  lp: string;
  page: string;
  text: string;
}

interface EntryBase {
  /** The idempotency key: the server files one issue (or note) per client id, however often it is sent. */
  clientId: string;
  createdAt: string;
  /** Sends that ended without a confirmation. */
  attempts: number;
  /** When the sender may try again on its own (ms since the epoch). */
  nextAt: number;
  lastError: string | null;
  /**
   * The server answered and said no (a 4xx: too large, not a PNG, not the live app). Resending the
   * same thing gets the same answer, so it waits for "Retry now" instead of the clock.
   */
  refused: boolean;
  /** Kept in localStorage without its pictures, because IndexedDB was unavailable. */
  textOnly?: boolean;
}

/**
 * A report for the feedback box's route, or a connection note for its own. Both routes answer a
 * resend with what they already saved (app/api/feedback, lib/enrich/feedback.ts).
 */
export type JournalEntry = EntryBase & (
  | { target?: 'issue'; request: FeedbackRequest }
  | { target: 'connection'; request: ConnectionNoteRequest }
);

/**
 * How long to wait after the nth unconfirmed send: 5 s, 15 s, 60 s, then every 2 minutes. GUESS:
 * a pegged import lasts minutes, a restart well under one; two minutes keeps a stuck note trying
 * without adding load to a server that is already struggling.
 */
export const BACKOFF_MS = [5_000, 15_000, 60_000] as const;
export const BACKOFF_CAP_MS = 120_000;
/**
 * One send's patience: 3 s, plus 1 s for every megabyte of pictures to upload, at most 20 s. GUESS:
 * the journal answers in well under 100 ms; the rest is the upload over the local network.
 */
export const SEND_TIMEOUT_MS = 3_000;
export const sendTimeout = (bodyChars: number) => Math.min(20_000, SEND_TIMEOUT_MS + Math.floor(bodyChars / 1_000_000) * 1_000);

export function retryDelay(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts < 1) return BACKOFF_MS[0];
  return BACKOFF_MS[Math.floor(attempts) - 1] ?? BACKOFF_CAP_MS;
}

/** A client id the server accepts: what lib/request-key.ts makes, and nothing that could be a path. */
export const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
export const isClientId = (v: unknown): v is string => typeof v === 'string' && CLIENT_ID.test(v);

/** An issue number as the file sink gives them out. */
const ISSUE_ID = /^\d{1,9}$/;

export type SendOutcome =
  /** Journaled on the server: safe there, filed shortly. `id` when it was already filed. */
  | { kind: 'journaled'; id: string | null; repeat: boolean }
  /** `id` is the issue number; a connection note has none, and says `null`. */
  | { kind: 'filed'; id: string | null; repeat: boolean }
  | { kind: 'retry'; error: string }
  | { kind: 'refused'; error: string };

/**
 * What one response means. Acceptance is a 2xx that says it journaled and echoes this entry's
 * client id; a server from before the journal confirmed with an issue number and the client id
 * (for a connection note, its own id and a time), and that still counts. Anything else — a 200 from
 * a proxy, an HTML error page, a response for another report — leaves the entry in the outbox.
 * 408 and 429 are the server asking for later, not no.
 */
export function classify(
  clientId: string, status: number | null, json: unknown, networkError?: string, target: 'issue' | 'connection' = 'issue',
): SendOutcome {
  if (status === null) return { kind: 'retry', error: networkError || 'No answer from the server' };
  const body = (json && typeof json === 'object' ? json : {}) as { id?: unknown; clientId?: unknown; at?: unknown; error?: unknown; repeat?: unknown; journaled?: unknown };
  const said = typeof body.error === 'string' && body.error ? body.error : null;
  if (status >= 200 && status < 300) {
    if (body.journaled === true && body.clientId === clientId) {
      return { kind: 'journaled', id: typeof body.id === 'string' && ISSUE_ID.test(body.id) ? body.id : null, repeat: body.repeat === true };
    }
    if (target === 'connection' && body.id === clientId && typeof body.at === 'string' && body.at) {
      return { kind: 'filed', id: null, repeat: false };
    }
    if (target === 'issue' && typeof body.id === 'string' && ISSUE_ID.test(body.id) && body.clientId === clientId) {
      return { kind: 'filed', id: body.id, repeat: body.repeat === true };
    }
    return { kind: 'retry', error: 'The server answered without confirming it kept the report' };
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { kind: 'refused', error: said ?? `The server refused it (${status})` };
  }
  return { kind: 'retry', error: said ?? `The server answered ${status}` };
}

/**
 * The outbox after one send. The entry leaves only when the server confirmed it kept it (journaled,
 * or filed); every other outcome keeps it, counted and rescheduled. Others are untouched.
 */
export function settle(entries: JournalEntry[], clientId: string, outcome: SendOutcome, now: number): JournalEntry[] {
  if (outcome.kind === 'filed' || outcome.kind === 'journaled') return entries.filter((e) => e.clientId !== clientId);
  return entries.map((e) => {
    if (e.clientId !== clientId) return e;
    const attempts = e.attempts + 1;
    return {
      ...e,
      attempts,
      lastError: outcome.error,
      refused: outcome.kind === 'refused',
      nextAt: now + retryDelay(attempts),
    };
  });
}

/** Whether the sender should try this entry now. A kick (page load, online, a live server) skips the clock, not a refusal. */
export function due(entry: JournalEntry, now: number, kicked: boolean): boolean {
  if (entry.refused) return false;
  return kicked || entry.nextAt <= now;
}

const firstLine = (text: string) => {
  const first = text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean);
  return first ? (first.length > 80 ? `${first.slice(0, 79)}…` : first) : '';
};

/** The report's name in the list: its title, or its first line of words. */
export function entryTitle(entry: JournalEntry): string {
  if (entry.target === 'connection') return `Connection note: ${firstLine(entry.request.text) || 'no words'}`;
  return entry.request.title.trim() || firstLine(entry.request.body) || 'Untitled';
}

/** How many pictures go with it. */
export const entryPictures = (entry: JournalEntry) =>
  entry.target === 'connection' ? 0 : entry.request.screenshots.length + entry.request.images.length;

/** What "Copy text" copies: enough to file it by hand if everything else fails. */
export function entryText(entry: JournalEntry): string {
  if (entry.target === 'connection') {
    return `${entry.request.text.trim()}\n\nConnection note · ${entry.request.page} · written ${entry.createdAt}`;
  }
  const r = entry.request;
  return [
    r.title.trim() ? `# ${r.title.trim()}` : null,
    r.body.trim(),
    '',
    `${r.kind} · ${r.priority} · ${r.page} · written ${entry.createdAt}`,
  ].filter((l) => l !== null).join('\n');
}
