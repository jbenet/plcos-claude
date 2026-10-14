'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setCalendarColoursAction, type FeedResult } from '@/app/settings/calendar-actions';
import { GOOGLE_COLOURS, type ColourPicks } from '@/lib/calendar-classify';

/** Pick one Google event colour that means Travel and one that means Events. */
export function CalendarColours({ picks }: { picks: ColourPicks }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<FeedResult | null>(null);
  const pick = (name: 'travel' | 'events', label: string) => (
    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {label}
      <select name={name} defaultValue={picks[name] ?? 'none'} aria-label={`Colour for ${label}`}>
        <option value="none">No colour</option>
        {GOOGLE_COLOURS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
  return (
    <form
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const out = await setCalendarColoursAction(new FormData(e.currentTarget));
          setR(out);
          if (out.ok) router.refresh();
        } finally { setBusy(false); }
      }}
    >
      {pick('travel', 'Travel')}
      {pick('events', 'Events')}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {r && <span role="status" style={{ flexBasis: '100%', fontSize: 12, color: r.ok ? 'var(--green)' : 'var(--clay)' }}>{r.message}</span>}
    </form>
  );
}
