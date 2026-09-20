import type { ReactNode } from 'react';
import { syncSummary } from '@/lib/sync';
import { FeedbackButton } from './FeedbackBox';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Every screen sits in this frame: breadcrumb with a visible last-sync line, the work
 * area, and the right-hand inspector slot. A page that has nothing selected passes no
 * inspector and the column collapses — it never renders an empty panel.
 */
export async function Page({
  crumbs,
  actions,
  inspector,
  children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  const sync = await syncSummary();
  const last = crumbs[crumbs.length - 1];

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          {crumbs.slice(0, -1).map((c) => (
            <span key={c.label}>
              {c.label}
              {' / '}
            </span>
          ))}
          <b>{last?.label}</b>
        </div>
        <div className="sync" title={sync.sources.map((s) => `${s.label}: ${s.status}`).join('\n')}>
          <span className={`dot ${sync.tone}`} />
          {sync.line}
        </div>
        {actions}
        <FeedbackButton />
      </div>

      <div className="body">
        <div className="work">{children}</div>
        {inspector ? <aside className="insp">{inspector}</aside> : null}
      </div>
    </>
  );
}
