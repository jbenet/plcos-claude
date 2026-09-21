/**
 * Seam 3 of 5 — IssueSink.
 *
 * Markdown files now, GitHub issues later. The in-app feedback box writes through this
 * and knows nothing about either. `GitHubIssueSink` drops in at D2 by changing
 * config.issues.provider.
 */
import { config } from '@/config/deployment';

export type IssueStatus = 'open' | 'triaged' | 'agent-ready' | 'in-progress' | 'review' | 'done';
export type IssueKind = 'bug' | 'request' | 'question' | 'chore';
export type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * A file filed with the issue: the annotated screenshot, and any image dropped into the
 * body. The sink owns the name, so a caller cannot choose a path — it says what kind of
 * thing this is and hands over bytes.
 *
 * The body refers to these as `attachment:1`, `attachment:2` … and the sink rewrites those
 * tokens once it has named the files. That is the only way the markdown can point at a
 * real path without the caller inventing one.
 */
export interface IssueAttachment {
  kind: 'screenshot' | 'image';
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  base64: string;
  /** What the reporter's file was called, for the alt text and nothing else. */
  name?: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  kind: IssueKind;
  priority: IssuePriority;
  reporter: string;
  page: string;
  labels: string[];
  context: Record<string, unknown> | null;
  attachments?: IssueAttachment[];
  /**
   * How far the body's `attachment:N` tokens are from the attachment array. The screenshot
   * takes slot 1 when there is one, and the body counts its own images from 1.
   */
  tokenOffset?: number;
}

export interface Issue extends Omit<IssueDraft, 'attachments'> {
  id: string;
  status: IssueStatus;
  created: string;
  /** Where this issue actually lives — a repo path for files, a URL for GitHub. */
  location: string;
  /** Screenshots, if any were filed. Rendered in their own card rather than inline. */
  screenshots: string[];
  /** Every file filed with this issue, relative to the issues directory. */
  attachments: string[];
}

export interface IssueFilter {
  status?: IssueStatus[];
  kind?: IssueKind[];
  priority?: IssuePriority[];
}

export interface IssueSink {
  readonly kind: 'file' | 'github' | 'linear';
  /** Human-readable statement of where issues go, shown in the UI so it is never a guess. */
  readonly destination: string;
  create(draft: IssueDraft): Promise<Issue>;
  list(filter?: IssueFilter): Promise<Issue[]>;
  get(id: string): Promise<Issue | null>;
  update(id: string, patch: Partial<Pick<Issue, 'status' | 'priority' | 'labels'>>): Promise<Issue>;
}

export async function issues(): Promise<IssueSink> {
  if (config.issues.provider === 'file') {
    const { fileIssueSink } = await import('./file');
    return fileIssueSink(config.issues.dir);
  }
  const { unbuiltIssueSink } = await import('./github');
  return unbuiltIssueSink(config.issues.provider);
}

/** The SLA ladder from issues/README.md, in code so the UI can show it next to the issue. */
export const SLA: Record<IssuePriority, { triage: string; fix: string }> = {
  P0: { triage: 'same business day', fix: '1–2 days' },
  P1: { triage: '1 business day', fix: '1 week' },
  P2: { triage: '2 business days', fix: 'next version slice' },
  P3: { triage: 'weekly triage', fix: 'backlog' },
};
