'use client';

import Link from '@/components/ui/AppLink';
import { useMemo, useState } from 'react';
import type { Issue, IssueKind, IssuePriority, IssueStatus } from '@/lib/issues';
import { ago } from '@/lib/time';

const STATUSES: IssueStatus[] = ['open', 'triaged', 'agent-ready', 'in-progress', 'review', 'done'];
const PRIORITIES: IssuePriority[] = ['P0', 'P1', 'P2', 'P3'];
const KINDS: IssueKind[] = ['bug', 'request', 'question', 'chore'];

/**
 * The filter issue 0001 asked for.
 *
 * It runs in the browser: this list is one markdown file per issue and will be in the
 * hundreds at worst, so a round trip per chip would cost more than the filtering. The
 * default hides `done`, because the open queue is the question people arrive with — and
 * the count says how many rows that hid rather than leaving you to wonder.
 */
export function IssueList({ issues }: { issues: Issue[] }) {
  const [status, setStatus] = useState<IssueStatus | 'all' | 'not-done'>('not-done');
  const [priority, setPriority] = useState<IssuePriority | 'all'>('all');
  const [kind, setKind] = useState<IssueKind | 'all'>('all');

  const rows = useMemo(() => issues.filter((i) => {
    if (status === 'not-done' ? i.status === 'done' : status !== 'all' && i.status !== status) return false;
    if (priority !== 'all' && i.priority !== priority) return false;
    if (kind !== 'all' && i.kind !== kind) return false;
    return true;
  }), [issues, status, priority, kind]);

  const hidden = issues.length - rows.length;

  return (
    <div className="card">
      <div className="chead">
        <h2>All issues</h2>
        <span className="lbl">
          {rows.length} shown{hidden > 0 ? ` · ${hidden} filtered out` : ''} · {issues.length} on file
        </span>
      </div>

      <div className="sorter" style={{ padding: '10px 15px 0' }}>
        <button className={status === 'not-done' ? 'on' : ''} onClick={() => setStatus('not-done')}
                aria-pressed={status === 'not-done'}>Not done</button>
        {STATUSES.map((s) => (
          <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}
                  aria-pressed={status === s}>{s}</button>
        ))}
        <button className={status === 'all' ? 'on' : ''} onClick={() => setStatus('all')}
                aria-pressed={status === 'all'}>Any status</button>
      </div>
      <div className="sorter" style={{ padding: '6px 15px 0' }}>
        <button className={priority === 'all' ? 'on' : ''} onClick={() => setPriority('all')}
                aria-pressed={priority === 'all'}>Any priority</button>
        {PRIORITIES.map((p) => (
          <button key={p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}
                  aria-pressed={priority === p}>{p}</button>
        ))}
        <span style={{ width: 12 }} />
        <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}
                aria-pressed={kind === 'all'}>Any kind</button>
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}
                  aria-pressed={kind === k}>{k}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="cbody">
          <div className="empty">
            <span className="stat unavailable"><i />Nothing matches</span>
            <h3>No issue on file matches these filters.</h3>
            <p>
              {issues.length} issue{issues.length === 1 ? ' is' : 's are'} filed. This is a
              statement about the filters, not about the queue.
            </p>
          </div>
        </div>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 52 }}>Id</th>
              <th>Title</th>
              <th style={{ width: 90 }}>Kind</th>
              <th style={{ width: 62 }}>Priority</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 88 }}>Fixed in</th>
              <th style={{ width: 96 }}>Filed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="clickable">
                <td className="mono muted">{i.id}</td>
                <td>
                  <Link href={`/issues/${i.id}`}><b>{i.title}</b></Link>
                  <div className="muted" style={{ fontSize: 11.5 }}>{i.reporter} · {i.page}</div>
                </td>
                <td><span className={`kind k-${i.kind}`}>{i.kind}</span></td>
                <td className="mono">{i.priority}</td>
                <td><span className="flag f-mute">{i.status}</span></td>
                <td className="mono">
                  {i.fixedIn
                    ? <Link href={`/dev/changelog#${i.fixedIn.toLowerCase()}`} title="Open the changelog entry">{i.fixedIn}</Link>
                    : <span className="muted">—</span>}
                </td>
                <td className="muted nowrap">{i.created ? ago(new Date(i.created)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
