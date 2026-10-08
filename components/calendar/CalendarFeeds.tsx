import { removeCalendarFeedAction } from '@/app/settings/calendar-actions';
import { auth } from '@/lib/auth';
import { LANE_LABEL } from '@/lib/lanes';
import { myFeeds } from '@/lib/calendar-feeds';
import { shortDate } from '@/lib/time';
import { AddFeed } from './AddFeed';

/**
 * Preferences → Calendars (issue 0021): your calendars' private addresses, read for the Calendar page's Travel
 * and Events lanes. Read only. Each address is kept encrypted and shown here only as its service and last four.
 */
export async function CalendarFeeds() {
  const user = await (await auth()).currentUser();
  if (user.access === 'viewer') return null;
  const feeds = await myFeeds(user.id);
  return (
    <div className="card" id="calendars">
      <div className="chead">
        <h2>Calendars</h2>
        <span className="lbl">Travel and Events on the Calendar page · read only</span>
      </div>
      <div className="cbody">
        <p style={{ marginTop: 0 }}>
          Paste a calendar’s private address and the Calendar page shows its trips or events, with your name. In Google
          Calendar: Settings → the calendar → <b>Secret address in iCal format</b>. Anyone with the address can read
          that calendar, so it is kept encrypted and never shown again. Nothing is ever written to a calendar.
        </p>
        {feeds.map((f, i) => (
          <div className="fact" key={`${f.masked}-${i}`}>
            <span>{LANE_LABEL[f.lane]}</span>
            <span>
              <span className="mono">{f.masked}</span> · added {shortDate(new Date(f.addedAt))}
              {f.last && ('error' in f.last
                ? <span style={{ color: 'var(--clay)' }}> · {f.last.error}</span>
                : ` · ${f.last.events} in view when last read`)}
              <form action={removeCalendarFeedAction} style={{ display: 'inline', marginLeft: 8 }}>
                <input type="hidden" name="index" value={i} />
                <button className="btn" type="submit">Remove</button>
              </form>
            </span>
          </div>
        ))}
        <AddFeed />
      </div>
    </div>
  );
}
