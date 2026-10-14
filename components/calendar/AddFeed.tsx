'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCalendarFeedAction, type FeedResult } from '@/app/settings/calendar-actions';

/** Paste a calendar's private address; its entries are sorted like your Google calendar's. */
export function AddFeed() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<FeedResult | null>(null);
  return (
    <form
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        try {
          const out = await addCalendarFeedAction(new FormData(form));
          setR(out);
          if (out.ok) { form.reset(); router.refresh(); }
        } finally { setBusy(false); }
      }}
    >
      <input name="address" type="password" autoComplete="off" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
        aria-label="The calendar's private address" required style={{ flex: '1 1 280px' }} />
      <button className="btn p" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      {r && <span role="status" style={{ flexBasis: '100%', fontSize: 12, color: r.ok ? 'var(--green)' : 'var(--clay)' }}>{r.message}</span>}
    </form>
  );
}
