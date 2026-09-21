/**
 * The issue file format from CLAUDE.md, read and written by hand.
 *
 * No YAML library on purpose: the frontmatter is a closed set of scalar and string-array
 * fields, and a hand-written serializer is how the file keeps the comments and field order
 * a person expects to see when they open it in an editor.
 */
import type { IssueKind, IssuePriority, IssueStatus } from './index';

export interface ParsedIssue {
  id: string;
  title: string;
  status: IssueStatus;
  kind: IssueKind;
  priority: IssuePriority;
  reporter: string;
  page: string;
  created: string;
  labels: string[];
  body: string;
  context: Record<string, unknown> | null;
  /** Screenshots, when any were filed. Rendered separately from the prose. */
  screenshots: string[];
  /** Every file filed with this issue, relative to the issues directory. */
  attachments: string[];
  /** The version that closed it, from `fixed_in:` or the closing note (issue 0011). */
  fixedIn: string | null;
}

const COMMENTED = new Set(['status', 'kind', 'priority']);

export function parseIssue(file: string, fallbackId: string): ParsedIssue {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(file.trim());
  const front = match ? match[1]! : '';
  const rest = match ? match[2]! : file;

  const fields: Record<string, string | string[]> = {};
  for (const line of front.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let raw = m[2]!.trim();
    if (COMMENTED.has(key)) raw = raw.replace(/\s+#.*$/, '').trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      fields[key] = unquote(raw);
    }
  }

  const str = (k: string, d = ''): string => (typeof fields[k] === 'string' ? (fields[k] as string) : d);
  // `screenshot:` (singular) and `attachment:` are the earlier spellings, still read.
  const legacy = str('screenshot') || str('attachment');
  const screenshots = Array.isArray(fields['screenshots'])
    ? (fields['screenshots'] as string[])
    : legacy ? [legacy] : [];
  const attachments = Array.isArray(fields['attachments'])
    ? (fields['attachments'] as string[])
    : [...screenshots];
  // The screenshot links in the prose render the `screenshots` field for anybody reading
  // the file in an editor. The app shows the pictures themselves, so they are not prose.
  let trimmed = rest;
  for (const shot of screenshots) trimmed = trimmed.replace(`![Screenshot](${shot})`, '');
  const { body, context } = splitContext(trimmed);

  /** `**Done (N30).**`, `**Half done (N30)…`, `**Partly done (N30)…` — all of them. */
  const fromBody = /\*\*[^*]*?\((N\d+)\)/.exec(body);

  return {
    fixedIn: str('fixed_in') || fromBody?.[1] || null,
    id: str('id', fallbackId),
    title: str('title', '(untitled)'),
    status: (str('status', 'open') as IssueStatus),
    kind: (str('kind', 'bug') as IssueKind),
    priority: (str('priority', 'P2') as IssuePriority),
    reporter: str('reporter', 'unknown'),
    page: str('page', ''),
    created: str('created', ''),
    labels: Array.isArray(fields['labels']) ? (fields['labels'] as string[]) : [],
    screenshots,
    attachments,
    body,
    context,
  };
}

/** Pull the fenced ```json context block out of the prose, if there is one. */
function splitContext(rest: string): { body: string; context: Record<string, unknown> | null } {
  const fence = /```json context\r?\n([\s\S]*?)```/.exec(rest);
  if (!fence) return { body: rest.trim(), context: null };
  let context: Record<string, unknown> | null = null;
  try {
    context = JSON.parse(fence[1]!) as Record<string, unknown>;
  } catch {
    context = null;
  }
  return { body: rest.replace(fence[0], '').trim(), context };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const NEEDS_QUOTES = /^[\d\s]|[:#]/;
const quote = (s: string): string => (NEEDS_QUOTES.test(s) ? JSON.stringify(s) : s);

export function serializeIssue(issue: ParsedIssue): string {
  const lines = [
    '---',
    `id: ${JSON.stringify(issue.id)}`,
    `title: ${quote(issue.title)}`,
    `status: ${issue.status.padEnd(14)}# open | triaged | agent-ready | in-progress | review | done`,
    `kind: ${issue.kind.padEnd(16)}# bug | request | question | chore`,
    `priority: ${issue.priority.padEnd(12)}# P0 blocking | P1 serious | P2 normal | P3 someday`,
    `reporter: ${quote(issue.reporter)}`,
    `page: ${quote(issue.page)}`,
    `created: ${issue.created}`,
    `labels: [${issue.labels.join(', ')}]`,
    ...(issue.screenshots.length > 0 ? [`screenshots: [${issue.screenshots.join(', ')}]`] : []),
    ...(issue.attachments.length > 0 ? [`attachments: [${issue.attachments.join(', ')}]`] : []),
    '---',
    '',
    issue.body.trim(),
    '',
  ];
  for (const shot of issue.screenshots) {
    lines.push(`![Screenshot](${shot})`);
    lines.push('');
  }
  if (issue.context) {
    lines.push('```json context');
    lines.push(JSON.stringify(issue.context, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'issue';
}
