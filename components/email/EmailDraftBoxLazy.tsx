'use client';

import dynamic from 'next/dynamic';

/**
 * EmailDraftBox, with its editor's script (tiptap, about 400 KB) fetched only when a draft is drawn: drafting is off
 * (config.email.drafting), and the LP page and routes otherwise loaded it on every visit (15 Oct 2026).
 */
export const EmailDraftBox = dynamic(() => import('./EmailDraftBox').then((m) => m.EmailDraftBox), {
  loading: () => <div className="muted" role="status">Loading the draft…</div>,
});
