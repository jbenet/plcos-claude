import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { cappedText } from '@/lib/body-cap';
import { issues, type IssueSink, type IssueStatus } from '@/lib/issues';
import { MAX_IDS } from '@/lib/feedback-signal';
import { auditSync, type SyncCaller } from './auth';
import type { PushAnswer } from './push';

/**
 * GET|POST /api/sync/feedback: the app's feedback queue by an Admin's token (sync:admin), so project dev reads the
 * issues people file in the app and closes them once fixed, the way JuanMail and MailGuard reach the server (Juan,
 * 7 Oct 2026: "do it the same way other services ... are doing it"). docs/deploy/07-feedback-signal.md §6.
 *
 *   GET  ?view=open                → 200 { items: [{ id, status, kind, priority, created, page, attachments }] }
 *                                    `open` is filed and untouched; `active` is everything not done. No issue text.
 *   GET  ?ids=0201,0202            → 200 { items: [{ …issue, markdown }], missing } (the signal link's shape)
 *   GET  ?id=0201&file=<path>      → the image, only a path that issue lists
 *   POST { id, status, note? }     → 200 { issue: { id, status, closedAt } }; `note` is appended to the body
 *   POST ?op=file { report }       → 202 { journaled, clientId, id? }: files an issue as the token's holder
 *
 * Issue text is real data (docs/agent-rules/real-data.md): it is returned to the token's holder and never
 * written to the audit row, which carries ids, statuses and counts.
 */
const STATUSES: readonly IssueStatus[] = ['open', 'triaged', 'agent-ready', 'in-progress', 'done'];
const VIEWS: Record<string, IssueStatus[]> = { open: ['open'], active: ['open', 'triaged', 'agent-ready', 'in-progress'] };
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const ID = /^\d{4,6}$/;
const MAX_NOTE = 2000;

export interface FeedbackOptions { sink?: IssueSink; dir?: string }
/** The answer, or the raw bytes of an attachment. */
export type FeedbackAnswer = PushAnswer | { status: 200; bytes: Uint8Array<ArrayBuffer>; type: string };

const dirOf = (o: FeedbackOptions) => resolve(process.cwd(), o.dir ?? config.issues.dir);

export async function readFeedback(caller: SyncCaller, request: Request, o: FeedbackOptions = {}): Promise<FeedbackAnswer> {
  const q = new URL(request.url).searchParams;
  const sink = o.sink ?? await issues();
  const fail = async (status: number, reason: string, error: string) => {
    await auditSync(caller, 'feedback', 'invalid', { op: 'read', reason });
    return { status, body: { ok: false, error } };
  };

  const view = q.get('view');
  if (view !== null) {
    const statuses = VIEWS[view];
    if (!statuses) return fail(400, 'view', `view must be ${Object.keys(VIEWS).join(' or ')}.`);
    const items = (await sink.list({ status: statuses })).map((i) => ({
      id: i.id, status: i.status, kind: i.kind, priority: i.priority, created: i.created, page: i.page, attachments: i.attachments.length,
    }));
    await auditSync(caller, 'feedback', 'ok', { op: 'list', view, count: items.length });
    return { status: 200, body: { ok: true, view, items } };
  }

  const file = q.get('file');
  if (file !== null) {
    const id = q.get('id') ?? '';
    if (!ID.test(id)) return fail(400, 'id', 'Give the issue as ?id=<number>&file=<path>.');
    const issue = await sink.get(id);
    // Only a path the issue itself lists, so the token cannot reach anything else in the folder.
    const type = TYPES[extname(file).toLowerCase()];
    if (!issue || !issue.attachments.includes(file) || !type) return fail(404, 'file', 'That issue lists no such file.');
    const bytes = await readFile(resolve(dirOf(o), file)).catch(() => null);
    if (!bytes) return fail(404, 'file', 'That file is not on this server.');
    await auditSync(caller, 'feedback', 'ok', { op: 'file', id, bytes: bytes.length });
    return { status: 200, bytes: new Uint8Array(bytes), type };
  }

  const ids = (q.get('ids') ?? '').split(',').filter(Boolean);
  if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => ID.test(id))) {
    return fail(400, 'ids', `Give ?view=open, ?ids=<up to ${MAX_IDS} issue numbers>, or ?id=<number>&file=<path>.`);
  }
  const found = (await Promise.all(ids.map((id) => sink.get(id)))).filter((i) => i !== null);
  const items = await Promise.all(found.map(async (i) => ({
    ...i, markdown: await readFile(resolve(process.cwd(), i.location), 'utf8').catch(() => null),
  })));
  const missing = ids.filter((id) => !found.some((i) => i.id === id));
  await auditSync(caller, 'feedback', 'ok', { op: 'read', count: items.length, missing: missing.length });
  return { status: 200, body: { ok: true, items, missing } };
}

export async function setFeedbackStatus(caller: SyncCaller, request: Request, o: FeedbackOptions = {}): Promise<PushAnswer> {
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'feedback', outcome, { op: 'status', ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  if (config.data.copyTakenAt) return answer(403, 'refused', { error: 'This server serves a copy of the data; set statuses on the live server.' }, { reason: 'copy' });
  let input: Record<string, unknown>;
  try { input = JSON.parse((await request.text()).slice(0, 8 * 1024)); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return answer(422, 'invalid', { error: 'Send { id, status, note? }.' }, { reason: 'shape' });
  const extra = Object.keys(input).filter((k) => !['id', 'status', 'note'].includes(k));
  if (extra.length) return answer(422, 'invalid', { error: `Unknown fields: ${extra.slice(0, 5).join(', ')}. Send { id, status, note? }.` }, { reason: 'fields' });
  const id = typeof input.id === 'string' ? input.id : '';
  const status = STATUSES.find((s) => s === input.status);
  const note = input.note === undefined ? undefined : typeof input.note === 'string' ? input.note : null;
  if (!ID.test(id)) return answer(422, 'invalid', { error: 'id must be an issue number, as a string.' }, { reason: 'id' });
  if (!status) return answer(422, 'invalid', { error: `status must be one of ${STATUSES.join(', ')}.` }, { reason: 'status', id });
  if (note === null || (note && note.length > MAX_NOTE)) return answer(422, 'invalid', { error: `note is text of at most ${MAX_NOTE} characters.` }, { reason: 'note', id });
  const sink = o.sink ?? await issues();
  if (!await sink.get(id)) return answer(404, 'invalid', { error: 'No issue has that id.' }, { reason: 'unknown-issue', id });
  const issue = await sink.update(id, { status, note });
  return answer(200, 'ok', { issue: { id: issue.id, status: issue.status, closedAt: issue.closedAt ?? null } }, { id, status, noted: Boolean(note?.trim()) });
}

const MAX_REPORT = 12 * 1024 * 1024;

/**
 * POST ?op=file { title?, body, kind?, priority?, page?, context?, screenshots?, images?, clientId? }
 *   → 202 { journaled, clientId, id? }: files an issue as the token's holder, the way the feedback box does
 *   (journal first, file after). For apps without a browser session, such as the Astra menu-bar app
 *   (desktop/astra). The text is never written to the audit row.
 */
export async function fileFeedbackByToken(caller: SyncCaller, request: Request, o: { root?: string; filesHere?: boolean } = {}): Promise<PushAnswer> {
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'feedback', outcome, { op: 'file', ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const { feedbackHome } = await import('@/config/ports');
  if (config.data.copyTakenAt || !(o.filesHere ?? feedbackHome(config.data.profile).filesHere)) {
    return answer(403, 'refused', { error: 'Feedback is filed on the live server.' }, { reason: 'not-live' });
  }
  const text = await cappedText(request, MAX_REPORT);
  if (text === null) return answer(413, 'invalid', { error: 'The report is too large.' }, { reason: 'size' });
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return answer(422, 'invalid', { error: 'Send a report object.' }, { reason: 'shape' });
  const { isClientId } = await import('@/lib/feedback-journal');
  if (raw.clientId !== undefined && !isClientId(raw.clientId)) return answer(400, 'invalid', { error: 'The report\'s client id is malformed.' }, { reason: 'client-id' });
  const { checkReport, journal } = await import('@/lib/feedback-inbox');
  const checked = checkReport(raw);
  if (!checked.ok) return answer(checked.status, 'invalid', { error: checked.error }, { reason: 'report' });
  const { newRequestKey } = await import('@/lib/request-key');
  const { join } = await import('node:path');
  const clientId = (raw.clientId as string | undefined) ?? newRequestKey();
  const done = await journal(o.root ?? join(process.cwd(), config.issues.dir), {
    kind: 'issue', clientId, receivedAt: new Date().toISOString(), reporter: caller.user.handle, request: checked.value,
  });
  if (!o.root) setImmediate(() => { void import('@/lib/feedback-ingest').then((m) => m.kickIngest()).catch(() => undefined); });
  return answer(202, 'ok', { journaled: true, clientId, repeat: done.already !== null, ...(done.filed?.issueId ? { id: done.filed.issueId } : {}) },
    { shots: checked.value.screenshots.length, repeat: done.already !== null });
}
