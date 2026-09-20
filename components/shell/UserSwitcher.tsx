'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/modules/platform';

/**
 * The local half of the AuthProvider seam, made visible. It is labelled "local only" on
 * purpose: nothing about this should look like a login.
 */
export function UserSwitcher({ user, users }: { user: AppUser; users: AppUser[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const pick = (handle: string) => {
    setOpen(false);
    start(async () => {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userHandle: handle }),
      });
      router.refresh();
    });
  };

  return (
    <div>
      <button className="who" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="av">{user.initials}</span>
        <span className="nm">
          {user.name}
          <small>{pending ? 'switching…' : user.role}</small>
        </span>
        <span className="car">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="pop" role="menu">
          <div className="lbl" style={{ padding: '4px 9px 6px' }}>
            Local user switcher
          </div>
          {users.map((u) => (
            <button key={u.handle} className={u.id === user.id ? 'on' : ''} onClick={() => pick(u.handle)}>
              {u.name}
              <small>{u.role}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
