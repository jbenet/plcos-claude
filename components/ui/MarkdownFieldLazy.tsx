'use client';

import dynamic from 'next/dynamic';

/**
 * MarkdownField, with its editor's script fetched when a field is first drawn rather than with every page: the
 * feedback box is in the shell, so tiptap was in the script every page loaded (about 400 KB, 15 Oct 2026).
 */
export const MarkdownField = dynamic(() => import('./MarkdownField').then((m) => m.MarkdownField), {
  loading: () => <div className="muted" role="status" style={{ minHeight: '7.5em' }}>Loading the editor…</div>,
});
