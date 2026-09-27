'use client';

import { useEffect, useRef, useState } from 'react';
import { isShortcutsKey, SHORTCUT_GROUPS } from '@/lib/keyboard-shortcuts';

type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export function useShortcutPlatform() {
  const [apple, setApple] = useState(false);
  useEffect(() => setApple(/Mac|iPad|iPhone|iPod/i.test(navigator.platform)), []);
  return { modifier: apple ? '⌘' : 'Ctrl', alt: apple ? 'Option' : 'Alt' };
}

/** Shared with the feedback box so its help and the app-wide list cannot drift. */
export function ShortcutList({ group }: { group: ShortcutGroup['id'] }) {
  const { modifier, alt } = useShortcutPlatform();
  const section = SHORTCUT_GROUPS.find((item) => item.id === group)!;
  return (
    <dl className="shortcut-list">
      {section.shortcuts.map((shortcut) => (
        <div key={shortcut.description}>
          <dt>{shortcut.keys.map((keys, i) => (
            <span key={keys.join('+')}>
              {i > 0 && <span className="muted"> / </span>}
              {keys.map((key) => <kbd key={key}>{key === 'Mod' ? modifier : key === 'Alt' ? alt : key}</kbd>)}
            </span>
          ))}</dt>
          <dd>{shortcut.description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function KeyboardShortcuts() {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modal = dialog.current;
      if (!modal || event.defaultPrevented || event.repeat) return;
      if (modal.open) {
        if (event.key === 'Escape' || isShortcutsKey(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          modal.close();
        }
        return;
      }
      if (!isShortcutsKey(event)) return;
      // Existing dialogs own their keys, especially the feedback box and its keys panel.
      // Check presence, not focus: the drawer can be open while focus stays on its launcher.
      if (document.querySelector('dialog[open], [role="dialog"]:not(.shortcuts-dialog)')) return;
      event.preventDefault();
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modal.showModal();
      closeButton.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <dialog
      ref={dialog}
      className="shortcuts-dialog nocapture"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClose={() => {
        if (returnFocus.current?.isConnected) returnFocus.current.focus();
        returnFocus.current = null;
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
          event.currentTarget.close();
        }
      }}
    >
      <header className="shortcuts-head">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button ref={closeButton} type="button" className="btn" onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <p className="shortcuts-note">Shortcuts apply where you are working. Text fields keep what you type; open dialogs handle their own keys.</p>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`shortcuts-${group.id}`}>
          <h3 className="lbl" id={`shortcuts-${group.id}`}>{group.title}</h3>
          <ShortcutList group={group.id} />
        </section>
      ))}
    </dialog>
  );
}
