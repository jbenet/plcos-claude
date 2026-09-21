'use client';

import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/lib/capture';

/**
 * Drag a rectangle over the page.
 *
 * The feedback drawer is hidden while this is up — the reporter is choosing a part of the
 * page, and the panel covering a third of it would be in the way and then in the picture.
 * Escape cancels; a drag smaller than a few pixels counts as a mis-click rather than as an
 * empty selection.
 */
export function RegionPicker({
  onPick, onCancel,
}: {
  onPick: (r: Region) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState<[number, number] | null>(null);
  const [to, setTo] = useState<[number, number] | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const rect = from && to
    ? {
        x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]),
        w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]),
      }
    : null;

  return (
    <div
      className="regionpick nocapture"
      role="dialog"
      aria-label="Drag to choose a part of the page"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        setFrom([e.clientX, e.clientY]);
        setTo([e.clientX, e.clientY]);
      }}
      onPointerMove={(e) => { if (from) setTo([e.clientX, e.clientY]); }}
      onPointerUp={() => {
        if (done.current) return;
        if (!rect || rect.w < 8 || rect.h < 8) { setFrom(null); setTo(null); return; }
        done.current = true;
        onPick(rect);
      }}
    >
      {rect && (
        <>
          <div className="regionhole" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          <div className="regionsize" style={{ left: rect.x, top: Math.max(0, rect.y - 22) }}>
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </div>
        </>
      )}
      <div className="regionhint">
        Drag over the part you want · <b>Esc</b> to cancel
      </div>
    </div>
  );
}
