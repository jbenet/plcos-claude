'use client';
import { IMPORT_LABELS } from '@/lib/import-jobs/types';
import { active, needsLook, useJobs } from '@/lib/import-jobs/client';
import { ProspectPrecedence, type ProspectPrecedenceReport } from './ProspectPrecedence';

const word = (status: string) => (status === 'queued' ? 'Queued' : status === 'running' ? 'Working' : status === 'completed' ? 'Completed' : 'Stopped');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * The imports in full (issue 0114): on Developer → Status and the developer pages that start them,
 * not over every page. Elsewhere the rail's status mark says the same in a word. Closing a page does
 * not cancel a job. `compact` shows only what runs and what needs a look, for a page that starts imports.
 */
export function ImportJobs({ compact = false }: { compact?: boolean }) {
  const { jobs, error } = useJobs();
  const running = jobs.filter(active), look = needsLook(jobs);
  const rest = compact ? [] : jobs.filter((j) => !active(j) && !look.includes(j));
  if (compact && !running.length && !look.length && !error) return null;
  const line = (job: (typeof jobs)[number], stale = false) => (
    <div key={job.id} style={{ marginBottom: 8, opacity: stale ? 0.7 : 1 }}>
      <b>{IMPORT_LABELS[job.kind]}</b> · {word(job.status)}
      {' · '}{job.phase}{job.total !== null ? ` · ${job.done} of ${job.total} ${job.kind === 'dakota' ? 'records' : 'steps'}` : ''}
      {job.created_at && <span className="muted"> · {when(job.created_at)}</span>}
      {job.error && <p role={stale ? undefined : 'alert'} className={stale ? 'muted' : undefined} style={{ margin: '2px 0 0' }}>{job.error}</p>}
      {job.status === 'completed' && job.result && <p className="muted" style={{ margin: '2px 0 0' }}>{Object.entries(job.result).filter(([, value]) => typeof value === 'number').map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
      {job.status === 'completed' && job.kind === 'prospects' && !!job.result?.precedence &&
        <ProspectPrecedence report={job.result.precedence as ProspectPrecedenceReport} />}
    </div>
  );
  return <section className="card" aria-label="Import progress">
    <div className="chead"><h2>Imports</h2><span className="muted">Running jobs carry on if you leave this page.</span></div>
    <div className="cbody" aria-live="polite">
      {error && <p role="status">{error}</p>}
      {!running.length && !look.length && !rest.length && !error && <p className="muted" style={{ margin: 0 }}>No import has run in the last day.</p>}
      {running.map((j) => line(j))}
      {look.map((j) => line(j))}
      {rest.length > 0 && <details className="more"><summary>Earlier today: {rest.length}</summary>{rest.map((j) => line(j, true))}</details>}
    </div>
  </section>;
}
