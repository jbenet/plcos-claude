import { getDb } from '@/lib/db';
import { describeAudit } from '@/lib/audit-words';
import type { AuditRow } from '@/modules/platform';
import { gitLog, issuesIn } from './git';
import { loadLedger, type RunView } from '@/lib/workflows/view';

/**
 * Developer → Logs as one timeline (issue 0101: "treat our dev as part of the system"): the audit
 * log, the workflow runs from the ledger, and the development cycle from the repository's own
 * history, merged newest first. Each source is read in a bounded window; a source that can't be read
 * says so rather than looking empty.
 */

export type Kind = 'dev' | 'workflow' | 'import' | 'record' | 'feedback';
export const KIND_LABEL: Record<Kind, string> = {
  dev: 'Dev', workflow: 'Workflow', import: 'Import', record: 'Record', feedback: 'Feedback',
};
export const KINDS: Kind[] = ['dev', 'workflow', 'import', 'record', 'feedback'];

export interface Event {
  id: string;
  at: Date;
  kind: Kind;
  what: string;
  about: string | null;
  actor: string | null;
  href: string | null;
  issues: string[];
  /** A short mono token: a commit hash, an action name. */
  code: string | null;
  run: RunView | null;
  detail: Array<[string, string]>;
}

export interface Timeline {
  events: Event[];
  more: Date | null;
  sources: Array<{ key: 'audit' | 'ledger' | 'git'; label: string; ok: boolean; note: string }>;
}

const IMPORT = /^(enrich\.|dakota\.|init\.|seed\.)|[._]imported$|^event\.tagged$|^network\.built$/;

const IMPORT_WORDS: Record<string, string> = {
  'enrich.exported': 'exported a research batch',
  'enrich.imported': 'imported research findings',
  'enrich.prospects': 'imported prospects',
  'enrich.portfolio': 'imported the portfolio research',
  'enrich.sourced': 'sourced new candidates',
  'dakota.translated': 'imported the Dakota replica',
  'strategy.move_imported': 'imported a strategy move',
  'init.loaded': 'loaded the init file',
  'seed.loaded': 'seeded the demo',
  'event.tagged': 'tagged events',
  'network.built': 'rebuilt the network',
};

const short = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 140 ? `${v.slice(0, 137)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const t = JSON.stringify(v);
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
};

/** Numbers in an import's detail, as "302 sourced, 394 merged": counts, never values. */
function counts(d: Record<string, unknown>): string | null {
  const parts = Object.entries(d).filter(([, v]) => typeof v === 'number' && v > 0).slice(0, 6)
    .map(([k, v]) => `${(v as number).toLocaleString('en-GB')} ${k.replace(/_/g, ' ')}`);
  return parts.length ? parts.join(', ') : null;
}

export function auditEvent(a: AuditRow, i: number): Event {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  const who = a.actor ?? 'The system';
  const kind: Kind = a.action === 'feedback.filed' ? 'feedback' : IMPORT.test(a.action) ? 'import' : 'record';
  let what: string, about: string | null, issues: string[] = [], href: string | null = null;
  if (kind === 'import') {
    what = `${who} ${IMPORT_WORDS[a.action] ?? a.action.replace(/[._]/g, ' ')}`;
    about = counts(d);
  } else if (kind === 'feedback') {
    const loc = typeof d.location === 'string' ? d.location : '';
    const num = /issues\/(\d{4})-/.exec(loc)?.[1];
    what = `${who} filed ${num ? `issue ${num}` : 'feedback'}${typeof d.kind === 'string' ? ` (${d.kind})` : ''}`;
    about = typeof d.page === 'string' ? `on ${d.page}` : typeof d.title === 'string' ? d.title : null;
    if (num) { issues = [num]; href = `/developer/issues/${num}`; }
  } else {
    ({ what, about } = describeAudit(a));
  }
  return {
    id: `a${i}-${a.at.getTime()}`, at: a.at, kind, what, about, actor: a.actor ?? 'system', href, issues,
    code: a.action, run: null,
    detail: Object.entries(d).slice(0, 12).map(([k, v]) => [k, short(v)]),
  };
}

export function runEvent(r: RunView): Event | null {
  const at = r.startedAt ?? r.endedAt;
  if (!at) return null;
  const written = r.counts?.written;
  return {
    id: `r-${r.runId}`, at, kind: r.family === 'import' ? 'import' : 'workflow',
    what: `${r.agent} ran ${r.workflow} · ${r.operation}`,
    about: [r.version ? `protocol ${r.version}` : null, written !== null && written !== undefined ? `${written} of ${r.planned} written` : null,
      r.checks.list.length ? `${r.checks.pass}/${r.checks.list.length} checks` : null].filter(Boolean).join(' · ') || null,
    actor: r.source === 'chatgpt' ? 'ChatGPT' : r.source === 'claude-code' ? 'Claude' : r.source === 'script' ? 'script' : 'app',
    href: `/dev/workflows?run=${r.runId}`, issues: issuesIn(r.operation), code: null, run: r, detail: [],
  };
}

async function auditWindow(limit: number, before: Date | null): Promise<AuditRow[]> {
  const db = await getDb();
  const rows = await db.query<{ at: Date | string; action: string; subject_type: string; subject_id: string | null; name: string | null; detail: Record<string, unknown> }>(
    `select a.at, a.action, a.subject_type, a.subject_id, u.name, a.detail
       from platform.audit_log a left join platform.app_user u on u.id = a.actor_id
      where ($2::timestamptz is null or a.at < $2)
      order by a.at desc limit $1`,
    [limit, before ? before.toISOString() : null],
  );
  return rows.map((r) => ({ at: new Date(r.at), action: r.action, subjectType: r.subject_type, subjectId: r.subject_id, actor: r.name, detail: r.detail ?? {} }));
}

export async function loadTimeline({ limit = 200, before = null, kind = null }: { limit?: number; before?: Date | null; kind?: Kind | null }): Promise<Timeline & { counts: Record<Kind, number> }> {
  const [audit, ledger, git] = await Promise.all([
    auditWindow(limit, before).then((rows) => ({ rows, ok: true })).catch(() => ({ rows: [] as AuditRow[], ok: false })),
    loadLedger(),
    gitLog({ limit, firstParent: true, before }),
  ]);
  const events: Event[] = [
    ...audit.rows.map(auditEvent),
    ...ledger.runs.map(runEvent).filter((e): e is Event => e !== null && (!before || e.at < before)),
    ...git.commits.map((c): Event => ({
      id: `g-${c.hash}`, at: c.at, kind: 'dev',
      what: c.merge && c.branch ? `Merged ${c.branch}` : c.subject,
      about: c.merge && c.branch ? c.subject.replace(/^Merge (?:branch )?(?:'[^']+'|[\w./-]+)(?: into [\w./-]+)?:?\s*/, '') || null : null,
      actor: c.author, href: null, issues: c.issues, code: c.short, run: null, detail: [],
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  // Counted over the span the unfiltered page covers, so one source's longer reach doesn't outweigh the rest.
  const cutoff = events[Math.min(limit, events.length) - 1]?.at.getTime() ?? 0;
  const counts = Object.fromEntries(KINDS.map((k) => [k, events.filter((e) => e.kind === k && e.at.getTime() >= cutoff).length])) as Record<Kind, number>;
  const matching = kind ? events.filter((e) => e.kind === kind) : events;
  const shown = matching.slice(0, limit);
  return {
    events: shown, counts,
    more: matching.length > limit || audit.rows.length === limit || git.commits.length === limit ? shown.at(-1)?.at ?? null : null,
    sources: [
      { key: 'git', label: 'Repository history', ok: !git.error, note: git.error ? `unavailable: ${git.error}` : `${git.ref}, first parent: merges and direct commits` },
      { key: 'ledger', label: 'Workflow ledger', ok: !ledger.error, note: ledger.error ?? (ledger.where === 'demo' ? 'invented runs' : ledger.label) },
      { key: 'audit', label: 'Audit log', ok: audit.ok, note: audit.ok ? 'platform.audit_log, append-only' : 'could not be read' },
    ],
  };
}
