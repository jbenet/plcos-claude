import { shortDate } from '@/lib/time';
import { aboutThisRaise, raiseWindows, touchpointsFor, type Touchpoint } from '@/modules/meetings';

/**
 * Everything on record with one person or organization, about anything (N59): their contact
 * history, summed. Juan, 23 Sep: "email unrelated to the fundraise may still be useful for
 * intelligence gathering… maybe could have aggregate stats about those messages in the LP's own
 * system-wide page (separate from the 'LP for this vehicle' page)". A raise's pages count only
 * what is about that raise; this is where the rest is kept, so nothing read is lost.
 */

export interface ContactCounts {
  emails: number;
  fromThem: number;
  fromUs: number;
  meetings: number;
  first: Date | null;
  last: Date | null;
}

/** Held, own contact — not research, not their firm's — in a set of touchpoints. */
export function countContact(touches: Touchpoint[], now = Date.now()): ContactCounts {
  const held = touches.filter((t) => !t.viaOrganization && t.channel !== 'research' && t.on && t.on.getTime() <= now);
  const emails = held.filter((t) => t.channel === 'email' || t.channel === 'message');
  const dates = held.map((t) => t.on!.getTime());
  return {
    emails: emails.length,
    fromThem: emails.filter((t) => t.direction === 'theirs').length,
    fromUs: emails.filter((t) => t.direction === 'ours').length,
    meetings: held.filter((t) => t.channel === 'meeting' || t.channel === 'call').length,
    first: dates.length ? new Date(Math.min(...dates)) : null,
    last: dates.length ? new Date(Math.max(...dates)) : null,
  };
}

const year = (d: Date) => d.getUTCFullYear();

export async function ContactHistory({ entityId, vehicleIds }: {
  entityId: string;
  /** The vehicles they are in the pipeline for: what their pipeline pages count. */
  vehicleIds: string[];
}) {
  const [touches, windows] = await Promise.all([touchpointsFor(entityId, null), raiseWindows()]);
  const own = touches.filter((t) => !t.viaOrganization && t.channel !== 'research');
  if (!own.length) return null;
  const now = Date.now();
  const all = countContact(own, now);
  const byVehicle = vehicleIds
    .map((id) => windows.get(id))
    .filter((w): w is NonNullable<typeof w> => Boolean(w))
    .map((w) => ({ w, n: own.filter((t) => t.on && t.on.getTime() <= now && aboutThisRaise(t, w)).length }));
  const aboutAny = own.filter((t) => [...windows.values()].some((w) => aboutThisRaise(t, w)));
  const other = countContact(own.filter((t) => !aboutAny.includes(t)), now);
  const years = [...new Set(own.filter((t) => t.on).map((t) => year(t.on!)))].sort((a, b) => b - a);
  const team = new Map<string, number>();
  for (const t of own) for (const n of t.attendees.length ? t.attendees : [t.ownerName]) {
    if (n && n !== 'Not on the team') team.set(n, (team.get(n) ?? 0) + 1);
  }
  const people = [...team.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const withFirm = touches.filter((t) => t.viaOrganization).length;

  return (
    <div className="card">
      <div className="chead">
        <h2>Contact history</h2>
        <span className="lbl">every email and meeting on record, about anything</span>
      </div>
      <div className="cbody">
        <div className="fact">
          <span>On record</span>
          <span>
            {all.emails} {all.emails === 1 ? 'email' : 'emails'} ({all.fromThem} from them, {all.fromUs} from us) · {all.meetings}{' '}
            {all.meetings === 1 ? 'meeting or call' : 'meetings and calls'}
          </span>
        </div>
        <div className="fact"><span>First and last</span><span>{all.first ? `${shortDate(all.first)} — ${shortDate(all.last!)}` : 'nothing held yet'}</span></div>
        <div className="fact">
          <span>About a raise</span>
          <span>{aboutAny.filter((t) => t.on && t.on.getTime() <= now).length}, each inside the window of a vehicle it names, or of any raising then</span>
        </div>
        {byVehicle.map(({ w, n }) => (
          <div className="fact" key={w.vehicleId}>
            <span>Counted for {w.name}</span>
            <span>
              {n} on its pipeline
              {w.opens ? ` · raising from ${shortDate(w.opens)}${w.closes ? ` to ${shortDate(w.closes)}` : ', still open'}` : ' · no raise window set: only what names it'}
            </span>
          </div>
        ))}
        <div className="fact">
          <span>About something else</span>
          <span>
            {other.emails + other.meetings} — {other.emails} {other.emails === 1 ? 'email' : 'emails'}, {other.meetings} {other.meetings === 1 ? 'meeting' : 'meetings'}
            {other.first ? (year(other.first) === year(other.last!) ? `, in ${year(other.first)}` : `, ${year(other.first)}–${year(other.last!)}`) : ''}
          </span>
        </div>
        {people.length > 0 && (
          <div className="fact"><span>From our side</span><span>{people.map(([n, k]) => `${n} (${k})`).join(', ')}</span></div>
        )}
        {years.length > 0 && (
          <table className="list" style={{ marginTop: 10 }}>
            <thead><tr><th>Year</th><th>Emails</th><th>Meetings and calls</th><th>About a raise</th></tr></thead>
            <tbody>
              {years.map((y) => {
                const inYear = own.filter((t) => t.on && year(t.on) === y);
                const c = countContact(inYear, now);
                return (
                  <tr key={y}>
                    <td>{y}</td><td>{c.emails}</td><td>{c.meetings}</td>
                    <td>{inYear.filter((t) => aboutAny.includes(t)).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="cover">
        <b>What this covers:</b> Affinity&rsquo;s mail and calendar sync, their notes, and anything
        logged here, as of the last translation{withFirm ? `; ${withFirm} more with their firm are not counted here` : ''}. A raise&rsquo;s
        pages count only contact about that raise, inside its window; the rest is kept here as
        history for research and strategy, and counted on no pipeline.
      </p>
    </div>
  );
}
