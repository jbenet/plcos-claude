import { removeCalendarFeedAction } from '@/app/settings/calendar-actions';
import { auth } from '@/lib/auth';
import { myColours, myFeeds } from '@/lib/calendar-feeds';
import { shortDate } from '@/lib/time';
import { AddFeed } from './AddFeed';
import { CalendarColours } from './CalendarColours';

/**
 * Preferences → Calendars (issue 0021): how the Calendar page sorts your calendar entries into Travel and Events,
 * your colour picks, and any pasted private addresses. Read only. An address is kept encrypted and shown here only
 * as its service and last four.
 */
export async function CalendarFeeds() {
  const user = await (await auth()).currentUser();
  if (user.access === 'viewer') return null;
  const [feeds, colours] = await Promise.all([myFeeds(user.id), myColours(user.id)]);
  return (
    <div className="card" id="calendars">
      <div className="chead">
        <h2>Calendars</h2>
        <span className="lbl">Travel and Events on the Calendar page · read only</span>
      </div>
      <div className="cbody">
        <p style={{ marginTop: 0 }}>
          Keep trips and events in your own calendar, as you already do. The Calendar page reads every calendar your
          mailguard token can read (connect it under Email above; it needs calendar.read) and sorts each entry, with
          your name on it:
        </p>
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          <li><b>Event</b>: a conference, summit or talk in its title, or a Luma, Eventbrite or registration link (links
            are seen when your token also holds calendar.read.details).</li>
          <li><b>Travel</b>: an entry over two or more days with a place, which is the destination.</li>
          <li><b>Meeting</b>: everything else. Meetings are not shown there; they appear next to the LP instead.</li>
        </ul>
        <p>
          To say otherwise, put <span className="mono">[travel]</span> or <span className="mono">[event]</span> in the
          entry’s title, give it the colour you pick below, or click Travel, Event or Meeting under it on the Calendar
          page, which is remembered. Nothing is ever written to a calendar.
        </p>
        <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>Your colours</h3>
        <p style={{ margin: 0 }}>A Google Calendar colour that always means Travel, and one that always means Events.</p>
        <CalendarColours picks={colours} />
        <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>Another calendar’s address (optional)</h3>
        <p style={{ marginTop: 0 }}>
          For a calendar your mailguard token does not read, such as TripIt: paste its private address and its entries
          are sorted the same way. In Google Calendar: Settings → the calendar → <b>Secret address in iCal format</b>.
          Anyone with the address can read that calendar, so it is kept encrypted and never shown again.
        </p>
        {feeds.map((f, i) => (
          <div className="fact" key={`${f.masked}-${i}`}>
            <span className="mono">{f.masked}</span>
            <span>
              added {shortDate(new Date(f.addedAt))}
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
