import { issues as issueSink } from '@/lib/issues';
import type { IssueAttachment, IssueKind, IssuePriority, IssueSink } from '@/lib/issues';
import { appendAudit, attachIssueRef, insertFeedback } from './repo';
import type { AppUser } from './types';
import { bestEffortDb, type QueueClock } from '@/lib/db/scheduling';

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
}

/**
 * The markdown file is the receipt. Database metadata is best-effort and never holds
 * the complaint behind a busy connection, including reporter lookup.
 */
export async function fileFeedback(user: AppUser | { handle: string; resolveUser: () => Promise<AppUser> }, cmd: FeedbackCommand, options: { clock?: QueueClock; sink?: IssueSink } = {}) {
  const verified = !('resolveUser' in user);
  const context = {
    ...cmd.context,
    user: user.handle,
    reporterVerification: verified ? 'verified' : 'unverified local cookie; database lookup pending',
  };

  const sink = options.sink ?? await issueSink();
  const issue = await sink.create({
    title: cmd.title.trim(),
    body: cmd.body.trim() || '(no description given)',
    kind: cmd.kind,
    priority: cmd.priority,
    reporter: verified ? user.handle : `${user.handle} (unverified)`,
    page: cmd.page,
    labels: [],
    context,
    attachments: cmd.attachments ?? [],
    tokenOffset: cmd.imageOffset ?? 0,
  });

  void bestEffortDb(async () => {
    const actor = 'resolveUser' in user ? await user.resolveUser() : user;
    const row = await insertFeedback({
      title: cmd.title.trim(), body: cmd.body.trim(), kind: cmd.kind, priority: cmd.priority,
      reporterId: actor.id, page: cmd.page, labels: [],
      context: { ...context, user: actor.handle, reporterVerification: 'verified' },
    });
    await attachIssueRef(row.id, issue.id, issue.location);
    await appendAudit({
      actorId: actor.id,
      action: 'feedback.filed',
      subjectType: 'issue',
      subjectId: issue.id,
      detail: {
        page: cmd.page, priority: cmd.priority, kind: cmd.kind, location: issue.location,
        attachments: issue.attachments,
      },
    });
  }, 250, options.clock);

  return issue;
}
