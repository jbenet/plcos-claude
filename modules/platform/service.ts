import { issues as issueSink } from '@/lib/issues';
import type { IssueKind, IssuePriority } from '@/lib/issues';
import { appendAudit, attachIssueRef, insertFeedback } from './repo';
import type { AppUser } from './types';

export interface FeedbackCommand {
  title: string;
  body: string;
  kind: IssueKind;
  priority: IssuePriority;
  page: string;
  context: Record<string, unknown>;
}

/**
 * File a piece of feedback: one row in platform.feedback, one markdown file through the
 * IssueSink, one audit entry. The row is written first — if the sink fails, the complaint
 * still exists and can be re-filed, rather than being lost with the request.
 */
export async function fileFeedback(user: AppUser, cmd: FeedbackCommand) {
  const context = {
    ...cmd.context,
    user: user.handle,
  };

  const row = await insertFeedback({
    title: cmd.title.trim(),
    body: cmd.body.trim(),
    kind: cmd.kind,
    priority: cmd.priority,
    reporterId: user.id,
    page: cmd.page,
    labels: [],
    context,
  });

  const sink = await issueSink();
  const issue = await sink.create({
    title: row.title,
    body: row.body || '(no description given)',
    kind: cmd.kind,
    priority: cmd.priority,
    reporter: user.handle,
    page: cmd.page,
    labels: [],
    context,
  });

  await attachIssueRef(row.id, issue.id, issue.location);
  await appendAudit({
    actorId: user.id,
    action: 'feedback.filed',
    subjectType: 'issue',
    subjectId: issue.id,
    detail: { page: cmd.page, priority: cmd.priority, kind: cmd.kind, location: issue.location },
  });

  return issue;
}
