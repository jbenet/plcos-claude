import type { ReactNode } from 'react';
import { syncSummary } from '@/lib/sync';
import { ago, formatDate } from '@/lib/time';
import { config } from '@/config/deployment';
import { shareRequestWork } from '@/lib/page-render';
import { PageFrame } from './PageFrame';
import s from './Shell.module.css';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Every screen sits in this frame. The queue column is for queue-shaped screens; the
 * inspector becomes the right pane, which the reader can close.
 */
export async function Page({
  crumbs, actions, queue, inspector, children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  /** A fixed left column inside the main area, for queue-shaped screens. */
  queue?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  const sync = await shareRequestWork('shell:syncSummary', {}, syncSummary);
  const profile = config.data.profile;
  // Until a connector has delivered, a real page computes its figures from an empty
  // database, and an empty database says $0 with complete confidence.
  const empty = profile === 'real' && !sync.sources.some((s) => s.source !== 'init' && s.status === 'ok');
  const sources = sync.sources.map((s) => `${s.label}: ${s.status}`).join('\n');
  // A preview (docs/COLLAB.md) serves a copy that never syncs, so the bar dates the copy instead of
  // reporting the syncs inside it as if they were this server's.
  const copied = config.data.copyTakenAt ? new Date(config.data.copyTakenAt) : null;

  return (
    <PageFrame
      profile={copied ? 'copy' : profile}
      notice={
        empty
          ? 'Nothing has been imported yet. Figures on this page come from an empty database: read a zero as not loaded, not as a fact about the raise.'
          : undefined
      }
      crumbs={crumbs.map((c) => ({ label: c.label, href: c.href }))}
      syncTone={copied ? 'amber' : sync.tone}
      syncLine={copied ? `Taken ${ago(copied)} · changes here are thrown away` : sync.line}
      syncTitle={
        copied
          ? `Copied from the real data at ${formatDate(copied, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. ` +
            `Nothing syncs here. In the copy: ${sync.line}.\n${sources}`
          : sources
      }
      actions={actions}
      inspector={inspector}
    >
      {queue ? (
        // On a phone the queue goes above the work (issue 0090), so its layout lives in the stylesheet.
        <div className={s.queued}>
          <div className="queue">{queue}</div>
          <div className={s.queuedWork}>{children}</div>
        </div>
      ) : (
        children
      )}
    </PageFrame>
  );
}
