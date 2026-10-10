'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { relabelCalendarEntryAction } from '@/app/settings/calendar-actions';

const NAMES = { travel: 'Travel', events: 'Event', meeting: 'Meeting' } as const;

/**
 * A calendar entry's lane, and a click to say what it really is (issue 0021). Remembered for every occurrence of
 * the entry; Meeting takes it off this page, and it stays a touchpoint on the LP.
 */
export function Relabel({ entry }: { entry: { key: string; label: keyof typeof NAMES; by: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const to = async (label: keyof typeof NAMES) => {
    const fd = new FormData();
    fd.set('key', entry.key);
    fd.set('label', label);
    setBusy(true);
    try {
      const r = await relabelCalendarEntryAction(fd);
      if (r.ok) { setErr(null); router.refresh(); } else setErr(r.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="ddetail" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>From a calendar, {entry.by}. Not {entry.label === 'travel' ? 'a trip' : 'an event'}?</span>
      {(Object.keys(NAMES) as Array<keyof typeof NAMES>).filter((l) => l !== entry.label).map((l) => (
        <button key={l} type="button" className="btn" style={{ padding: '1px 7px', fontSize: 11 }} disabled={busy} onClick={() => to(l)}
          title={l === 'meeting' ? 'Take it off this page; it stays a meeting on the LP' : `Show it as ${NAMES[l] === 'Event' ? 'an event' : 'a trip'}`}>
          {NAMES[l]}
        </button>
      ))}
      {err && <span role="status" style={{ color: 'var(--clay)' }}>{err}</span>}
    </div>
  );
}
