'use client';

import dynamic from 'next/dynamic';
import { useState, type ComponentProps, type ComponentType } from 'react';
import type { MarkdownField as Field } from './MarkdownField';

const load = () => import('./MarkdownField').then((m) => m.MarkdownField);

/**
 * MarkdownField, with its editor's script fetched when a field is first drawn rather than with every page: the
 * feedback box is in the shell, so tiptap was in the script every page loaded (about 400 KB, 15 Oct 2026).
 */
export const MarkdownField = dynamic(load, {
  loading: () => <div className="muted" role="status" style={{ minHeight: '7.5em' }}>Loading the editor…</div>,
});

/**
 * A field that is on the page from the start (Strategy's "commit to this"), drawn as a plain textarea until a
 * person focuses it. Drawing the editor straight away fetched tiptap (about 540 KB of script) on every Strategy
 * view, nearly doubling that page's script (17 Oct 2026). Pointing at the box starts the fetch; what was typed
 * before the editor arrives is kept, and the editor takes the cursor when it swaps in.
 */
export function DeferredMarkdownField(props: ComponentProps<typeof Field>) {
  const [Editor, setEditor] = useState<ComponentType<ComponentProps<typeof Field>> | null>(null);
  const [focused, setFocused] = useState(false);
  if (Editor) return <Editor {...props} autoFocus={focused} />;
  const open = (focus: boolean) => {
    if (focus) setFocused(true);
    void load().then((C) => { if (focus) setEditor(() => C); });
  };
  return (
    <div className="mdfield">
      <textarea
        rows={props.rows ?? 7}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.label ?? 'Enter any feedback'}
        onChange={(e) => props.onChange(e.target.value)}
        onPointerEnter={() => open(false)}
        onFocus={() => open(true)}
      />
    </div>
  );
}
