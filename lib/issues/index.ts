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
 * A file filed with the issue. Today that is one annotated screenshot from the feedback
 * box; the shape is general because a GitHub sink will upload the same bytes to a
 * different place, and the caller should not know which.
 */
export interface IssueAttachment {
  /** Suffix only — the sink owns the name, so a caller cannot choose a path. */
  kind: 'screenshot';
  contentType: 'image/png';
  base64: string;
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
  attachment?: IssueAttachment | null;
}

export interface Issue extends Omit<IssueDraft, 'attachment'> {
  id: string;
  status: IssueStatus;
  created: string;
  /** Where this issue actually lives — a repo path for files, a URL for GitHub. */
  location: string;
  /** Where the attachment landed, relative to the issue. Null when there is none. */
  attachment: string | null;
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
