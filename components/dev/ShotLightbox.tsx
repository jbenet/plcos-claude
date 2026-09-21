'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Click a changelog screenshot to see it large, here, on this page.
 *
 * It listens on the document rather than wiring a handler per image, because the changelog
 * renders a hundred and thirty of them and the page is a server component. The anchor stays
 * in the markup, so ⌘-click and middle-click still open the PNG in a tab — a plain left
 * click is the only one intercepted.
 *
 * Portalled to `<body>`: the rail is `position: sticky` and therefore its own stacking
 * context, and an overlay rendered inside it paints under the topbar.
 */
export function ShotLightbox() {
  const [shot, setShot] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const img = (e.target as HTMLElement | null)?.closest?.('img.clshot') as HTMLImageElement | null;
      if (!img) return;
      e.preventDefault();
      setShot({ src: img.currentSrc || img.src, alt: img.alt });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShot(null);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!shot) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [shot]);

  if (!shot || typeof document === 'undefined') return null;

  return createPortal(
    <div className="lbx" role="dialog" aria-label={shot.alt || 'Screenshot'} onClick={() => setShot(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.src} alt={shot.alt} />
      <button type="button" className="lbxclose" aria-label="Close" onClick={() => setShot(null)}>
        ×
      </button>
      <span className="lbxhint">Click anywhere or press Esc to close</span>
    </div>,
    document.body,
  );
}
