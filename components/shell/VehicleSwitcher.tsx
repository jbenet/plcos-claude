'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Vehicle } from '@/modules/platform';

export function VehicleSwitcher({ current, all }: { current: Vehicle | null; all: Vehicle[] }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();

  const pick = (slug: string) => {
    setOpen(false);
    start(async () => {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleSlug: slug }),
      });
      router.refresh();
    });
  };

  return (
    <div className="vswrap">
      <button className="vsw" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="lbl">Vehicle</div>
        <div className="v">
          <span>{current ? current.name : 'All vehicles'}</span>
          <span>{open ? '▴' : '▾'}</span>
        </div>
      </button>
      {open && (
        <div className="pop" role="menu">
          <button className={current === null ? 'on' : ''} onClick={() => pick('all')}>
            All vehicles
            <small>No blended figure is ever shown across them</small>
          </button>
          {all.map((v) => (
            <button key={v.slug} className={current?.slug === v.slug ? 'on' : ''} onClick={() => pick(v.slug)}>
              {v.name}
              <small>
                {v.kind === 'grant_rail' ? 'grants rail' : v.kind} · {v.exemption}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
