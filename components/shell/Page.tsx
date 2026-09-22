import type { ReactNode } from 'react';
import { syncSummary } from '@/lib/sync';
import { config } from '@/config/deployment';
import { PageFrame } from './PageFrame';

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
  const sync = await syncSummary();
  const profile = config.data.profile;
  // Until a connector has delivered, a real page computes its figures from an empty
  // database, and an empty database says $0 with complete confidence.
  const empty = profile === 'real' && !sync.sources.some((s) => s.source !== 'init' && s.status === 'ok');

  return (
    <PageFrame
      profile={profile}
      notice={
        empty
          ? 'Nothing has been imported yet. Figures on this page come from an empty database: read a zero as not loaded, not as a fact about the raise.'
          : undefined
      }
      crumbs={crumbs.map((c) => ({ label: c.label, href: c.href }))}
      syncTone={sync.tone}
      syncLine={sync.line}
      syncTitle={sync.sources.map((s) => `${s.label}: ${s.status}`).join('\n')}
      actions={actions}
      inspector={inspector}
    >
      {queue ? (
        <div style={{ display: 'flex', minHeight: 0, alignItems: 'stretch', margin: '-22px -24px' }}>
          <div className="queue">{queue}</div>
          <div style={{ flex: 1, minWidth: 0, padding: '22px 24px' }}>{children}</div>
        </div>
      ) : (
        children
      )}
    </PageFrame>
  );
}
