/**
 * The server's feedback journal (Juan, 27 Sep: "it should journal to the server. the page may die
 * or close forever"). /api/feedback and /api/connection-feedback validate what arrives, write it
 * here as one file, and answer 202 at once. Filing — the issue number, the database row, the audit
 * entry — happens afterwards, off the request (lib/feedback-ingest.ts).
 *
 *   <issues dir>/inbox/<clientId>.json          journaled, not yet filed
 *   <issues dir>/inbox/filed/<clientId>.json    filed: the issue number, without the pictures
 *   <issues dir>/inbox/refused/<clientId>.json  can never be filed (an LP that is gone), with why
 *
 * A write is atomic: a temporary file, fsync, rename, fsync of the folder. A crash leaves the old
 * state or the new one, never half a report. The client id is the name, so a resend is idempotent.
 *
 * Node's fs and pure validation only. Nothing here imports the database, auth, or Next, so the
 * route that writes the journal never waits on them (a property checks the import chain).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectionNoteRequest, FeedbackRequest } from './feedback-journal';
import { isClientId } from './feedback-journal';
import type { IssueAttachment } from './issues';
import { continuations, titleFrom } from './issues/title';

export interface InboxBase {
  clientId: string;
  receivedAt: string;
  /** Untrusted local user selector captured by the server; ingest resolves it against app_user before filing. */
  reporter: string | null;
}
export type InboxEntry = InboxBase & (
  | { kind: 'issue'; request: FeedbackRequest }
  | { kind: 'connection'; request: ConnectionNoteRequest }
);

export interface FiledRecord {
  clientId: string;
  kind: InboxEntry['kind'];
  /** The issue number; null for a connection note, which has none. */
  issueId: string | null;
  location: string | null;
  title: string;
  receivedAt: string;
  filedAt: string;
}

export type InboxStatus =
  | { state: 'journaled' }
  | { state: 'filed'; issueId: string | null }
  | { state: 'refused'; reason: string };

export const inboxDir = (issuesRoot: string) => join(issuesRoot, 'inbox');
const filedDir = (issuesRoot: string) => join(inboxDir(issuesRoot), 'filed');
const refusedDir = (issuesRoot: string) => join(inboxDir(issuesRoot), 'refused');
const exists = async (path: string) => { try { await readFile(path); return true; } catch { return false; } };
const readJson = async <T>(path: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
};

/** Write `name` in `dir` so that it is either absent or complete, and on disk when this returns. */
export async function writeAtomic(dir: string, name: string, data: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx');
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  // The rename itself is durable only once the folder is synced. Not every platform lets a folder
  // be opened for that; the file is already complete either way.
  try {
    const d = await open(dir, 'r');
    try { await d.sync(); } finally { await d.close(); }
  } catch { /* best effort */ }
}

/**
 * Journal one entry. A client id already journaled or filed writes nothing and says which; a new
 * one is written atomically. Returns the filed record when there is one, so a resend after filing
 * can be told the issue number.
 */
export async function journal(issuesRoot: string, entry: InboxEntry): Promise<{ already: 'journaled' | 'filed' | null; filed: FiledRecord | null }> {
  if (!isClientId(entry.clientId)) throw new Error('The client id is malformed.');
  const filed = await readJson<FiledRecord>(join(filedDir(issuesRoot), `${entry.clientId}.json`));
  if (filed) return { already: 'filed', filed };
  const name = `${entry.clientId}.json`;
  if (await exists(join(inboxDir(issuesRoot), name))) return { already: 'journaled', filed: null };
  await writeAtomic(inboxDir(issuesRoot), name, JSON.stringify(entry));
  return { already: null, filed: null };
}

export async function inboxStatus(issuesRoot: string, clientId: string): Promise<InboxStatus | null> {
  if (!isClientId(clientId)) return null;
  const filed = await readJson<FiledRecord>(join(filedDir(issuesRoot), `${clientId}.json`));
  if (filed) return { state: 'filed', issueId: filed.issueId };
  if (await exists(join(inboxDir(issuesRoot), `${clientId}.json`))) return { state: 'journaled' };
  const refused = await readJson<{ reason?: string }>(join(refusedDir(issuesRoot), `${clientId}.json`));
  if (refused) return { state: 'refused', reason: refused.reason ?? 'refused' };
  return null;
}

/** The client ids waiting in the inbox, oldest first. */
export async function inboxIds(issuesRoot: string): Promise<string[]> {
  let names: string[];
  try { names = await readdir(inboxDir(issuesRoot)); } catch { return []; }
  const ids = names.filter((n) => n.endsWith('.json') && !n.startsWith('.')).map((n) => n.slice(0, -5)).filter(isClientId);
  const stamped = await Promise.all(ids.map(async (id) => ({ id, at: (await readEntry(issuesRoot, id))?.receivedAt ?? '' })));
  return stamped.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map((s) => s.id);
}

export const readEntry = (issuesRoot: string, clientId: string) =>
  readJson<InboxEntry>(join(inboxDir(issuesRoot), `${clientId}.json`));

/** Filed: the record goes to filed/ first, then the entry leaves the inbox. A crash between the two is a resend, which the writer dedupes. */
export async function markFiled(issuesRoot: string, entry: InboxEntry, issue: { id: string | null; location: string | null; title: string }): Promise<FiledRecord> {
  const record: FiledRecord = {
    clientId: entry.clientId, kind: entry.kind, issueId: issue.id, location: issue.location, title: issue.title,
    receivedAt: entry.receivedAt, filedAt: new Date().toISOString(),
  };
  await writeAtomic(filedDir(issuesRoot), `${entry.clientId}.json`, JSON.stringify(record));
  await unlink(join(inboxDir(issuesRoot), `${entry.clientId}.json`)).catch(() => undefined);
  return record;
}

/** Can never be filed. Kept whole, with the reason, rather than retried forever. */
export async function markRefused(issuesRoot: string, entry: InboxEntry, reason: string): Promise<void> {
  await writeAtomic(refusedDir(issuesRoot), `${entry.clientId}.json`, JSON.stringify({ ...entry, reason, refusedAt: new Date().toISOString() }));
  await unlink(join(inboxDir(issuesRoot), `${entry.clientId}.json`)).catch(() => undefined);
}

// ---------------------------------------------------------------- what a report must be

const TYPES = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
/** Per picture, as before. */
const MAX_B64 = 12_000_000;
/** GUESS: every picture together. A report over it is refused with 413 rather than journaled. */
export const MAX_TOTAL_B64 = 40_000_000;
const KINDS = new Set(['bug', 'request', 'question', 'chore']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export type Checked<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/**
 * A report as the box sends it, checked before it is journaled: a title or a description, only the
 * four image types, sizes capped. What is refused here is refused now, with the reason, instead of
 * sitting in the inbox failing.
 */
export function checkReport(raw: unknown): Checked<FeedbackRequest> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  // A title is one line, and a line-end backslash is a typed newline, not text (issue 0113).
  const given = continuations(str(b.title)).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const text = continuations(str(b.body));
  const title = given || titleFrom(text);
  if (!title) return { ok: false, status: 400, error: 'Say what happened. A title or a description — either is enough, neither is not.' };
  const screenshots = Array.isArray(b.screenshots) ? b.screenshots.map(str) : [];
  const images = Array.isArray(b.images)
    ? b.images.map((i) => ({ name: typeof (i as { name?: unknown })?.name === 'string' ? (i as { name: string }).name : undefined, dataUrl: str((i as { dataUrl?: unknown })?.dataUrl) }))
    : [];
  let total = 0;
  for (const shot of screenshots) {
    const m = TYPES.exec(shot);
    if (!m || m[1] !== 'image/png') return { ok: false, status: 400, error: 'A screenshot was not a PNG.' };
    if (m[2]!.length > MAX_B64) return { ok: false, status: 413, error: 'A screenshot is too large.' };
    total += m[2]!.length;
  }
  for (const img of images) {
    const m = TYPES.exec(img.dataUrl);
    if (!m) return { ok: false, status: 400, error: 'An attached file was not a PNG, JPEG, GIF or WebP.' };
    if (m[2]!.length > MAX_B64) return { ok: false, status: 413, error: 'An attached file is too large.' };
    total += m[2]!.length;
  }
  if (total > MAX_TOTAL_B64) return { ok: false, status: 413, error: 'The pictures together are too large. Remove one and file again.' };
  const context = b.context && typeof b.context === 'object' && !Array.isArray(b.context) ? b.context as Record<string, unknown> : {};
  return {
    ok: true,
    value: {
      title,
      body: text,
      kind: KINDS.has(str(b.kind)) ? str(b.kind) : 'bug',
      priority: PRIORITIES.has(str(b.priority)) ? str(b.priority) : 'P2',
      page: str(b.page) || '/',
      context,
      screenshots,
      images,
      imageOffset: Number.isInteger(b.imageOffset) && (b.imageOffset as number) >= 0 ? b.imageOffset as number : 0,
    },
  };
}

/**
 * The pictures as the sink takes them: screenshots first, then dropped images, which is the order
 * the body's `attachment:N` tokens are numbered against. Only the base64 body is kept; the sink
 * names the files.
 */
export function attachmentsOf(request: FeedbackRequest): IssueAttachment[] {
  const out: IssueAttachment[] = [];
  for (const shot of request.screenshots) {
    const m = TYPES.exec(shot);
    if (m) out.push({ kind: 'screenshot', contentType: 'image/png', base64: m[2]! });
  }
  for (const img of request.images) {
    const m = TYPES.exec(img.dataUrl);
    if (m) out.push({ kind: 'image', contentType: m[1] as IssueAttachment['contentType'], base64: m[2]!, name: img.name });
  }
  return out;
}
