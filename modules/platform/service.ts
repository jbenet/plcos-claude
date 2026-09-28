import { getDb } from '@/lib/db';
import { issues as issueSink } from '@/lib/issues';
import type { IssueAttachment, IssueKind, IssuePriority, IssueSink } from '@/lib/issues';
import { appendAudit, attachIssueRef, insertFeedback } from './repo';
import type { AppUser } from './types';
import { bestEffortDb, cancellableDb, type QueueClock } from '@/lib/db/scheduling';

export interface FeedbackCommand {
  title: string;
  body: string;
  kind: IssueKind;
  priority: IssuePriority;
  page: string;
  context: Record<string, unknown>;
  /** The annotated screenshot and anything dropped into the body, in token order. */
  attachments?: IssueAttachment[];
  /**
   * How many attachments come before the dropped images. The body numbers its own images
   * from 1; the screenshot, when included, takes slot 1 — so the tokens shift by one.
   */
  imageOffset?: number;
  /** The browser journal's id for this report (lib/feedback-journal.ts): a resend files nothing new. */
  clientId?: string;
}

/**
 * The markdown file is the receipt. Database metadata is best-effort and never holds
 * the complaint behind a busy connection. The ingester resolves the reporter before calling this.
 */
export async function fileFeedback(user: AppUser | null, cmd: FeedbackCommand, options: { clock?: QueueClock; sink?: IssueSink; metadataBudgetMs?: number } = {}) {
  const context = {
    ...cmd.context,
    user: user?.handle ?? 'unknown',
    reporterVerification: user ? 'verified' : 'no active app_user resolved',
  };

  const sink = options.sink ?? await issueSink();
  const issue = await sink.create({
    title: cmd.title.trim(),
    body: cmd.body.trim() || '(no description given)',
    kind: cmd.kind,
    priority: cmd.priority,
    reporter: user?.handle ?? 'unknown',
    page: cmd.page,
    labels: [],
    context,
    attachments: cmd.attachments ?? [],
    tokenOffset: cmd.imageOffset ?? 0,
    ...(cmd.clientId ? { clientId: cmd.clientId } : {}),
  });
  // A resend of a report already filed: its database row and audit entry were queued the first time.
  if (issue.repeat || !user) return issue;

  void bestEffortDb(async signal => {
    const q = cancellableDb(await getDb(), signal);
    const actor = user;
    const row = await insertFeedback({
      title: cmd.title.trim(), body: cmd.body.trim(), kind: cmd.kind, priority: cmd.priority,
      reporterId: actor.id, page: cmd.page, labels: [],
      context: { ...context, user: actor.handle, reporterVerification: 'verified' },
    }, q);
    await attachIssueRef(row.id, issue.id, issue.location, q);
    await appendAudit({
      actorId: actor.id,
      action: 'feedback.filed',
      subjectType: 'issue',
      subjectId: issue.id,
      detail: {
        page: cmd.page, priority: cmd.priority, kind: cmd.kind, location: issue.location,
        attachments: issue.attachments,
      },
    }, q);
  }, options.metadataBudgetMs ?? 250, options.clock);

  return issue;
}
