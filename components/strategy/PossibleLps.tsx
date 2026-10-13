import Link from '@/components/ui/AppLink';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { lastCalendarRead, listCandidates, reasonText, recentAdds, type CandidateGuest, type CandidateRow } from '@/lib/calendar-candidates';
import { shortDate } from '@/lib/time';
import { CandidateActions, UndoAdd } from './PossibleLpActions';
import s from './possible-lps.module.css';

/**
 * Possible LPs from the calendar (lib/calendar-candidates.ts), shown on Pipeline → New: meetings with an outside guest
 * that no LP matched, grouped by firm or domain, each with its dates, its guests' domains, whether we hold them, and why
 * it may be an LP. Nothing is added without a click. Team and admin only: a viewer sees no section.
 */

/** GUESS: a calendar read older than two days is said to be stale (the read is daily). */
const STALE_MS = 2 * 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function guestsLine(guests: CandidateGuest[]): string {
  const byDomain = new Map<string, { n: number; person: number; org: number }>();
  for (const g of guests) {
    const d = byDomain.get(g.domain) ?? { n: 0, person: 0, org: 0 };
    d.n++;
    if (g.held === 'person') d.person++;
    if (g.held === 'org') d.org++;
    byDomain.set(g.domain, d);
  }
  return [...byDomain].map(([domain, d]) => {
    const held = d.person ? `${d.person === d.n ? (d.n === 1 ? 'held' : 'all held') : `${d.person} held`} as ${d.person === 1 ? 'a person' : 'people'}`
      : d.org ? 'not held as a person; the domain is a firm we hold' : 'nobody held';
    return `${plural(d.n, 'guest')} at ${domain} (${held})`;
  }).join(' · ');
}

function datesLine(c: CandidateRow, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return c.meetings.map((m) => `${shortDate(new Date(`${m.day}T12:00:00Z`))}${m.day > today ? ' (upcoming)' : ''}`).join(', ');
}

function Title({ c }: { c: CandidateRow }) {
  if (c.entityId && c.name) {
    const what = c.held === 'person' ? 'person we hold, with no firm on record' : 'firm we hold';
    return <><span className={s.name}>{c.entityType === 'person' ? c.name : <Link href={`/orgs/${c.entityId}`}>{c.name}</Link>}</span> <span className="flag f-mute">{what}</span></>;
  }
  return <><span className={s.name}>Unknown firm at {c.domain}</span> <span className="flag f-ev">not held</span></>;
}

export async function PossibleLps({ vehicle, vehicles }: {
  /** The vehicle the page is on, or null on All vehicles. */
  vehicle: { id: string; name: string; kind: string; phase: string } | null;
  vehicles: Array<{ id: string; name: string; kind: string; phase: string }>;
}) {
  const user = await currentUser();
  if (!can(user, 'read', { vehicle: vehicle?.id ?? null, fieldClass: 'R2' })) return null;
  const db = await getDb();
  const [list, recent, read] = await Promise.all([listCandidates(db), recentAdds(db, vehicle?.id ?? null), lastCalendarRead(db)]);
  const now = new Date();
  // A pursuit opens in a vehicle being raised, never the grants rail (funders by invitation only, rule 12).
  const open = (vehicle ? [vehicle] : vehicles).filter((v) => v.phase === 'active' && v.kind !== 'grant_rail' && can(user, 'mutate', { vehicle: v.id }));
  const stale = read.at && now.getTime() - read.at.getTime() > STALE_MS;

  return (
    <section className="card" aria-labelledby="possible-lps">
      <div className="chead">
        <h2 id="possible-lps">Possible LPs from the calendar</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {read.at ? <>Calendar read {shortDate(read.at)}{stale ? ' · may be out of date' : ''}</> : 'Calendar not read yet'}
          {read.failed && <> · <span className="stat waiting"><i />Latest read failed</span></>}
        </span>
      </div>

      {!read.at ? (
        <div className="cbody"><div className="empty">
          <span className="stat unavailable"><i />Not read yet</span>
          <h3>The team’s calendars have not been read.</h3>
          <p>Possible LPs come from meetings with an outside guest that no LP matched. Anyone whose mailguard key can read their calendar can start a read in Preferences → Email → Read calendars now; it also runs daily.</p>
        </div></div>
      ) : list.length === 0 ? (
        <div className="cbody"><div className="empty">
          <span className="stat unavailable"><i />Nothing proposed</span>
          <h3>No possible LPs in the calendars read.</h3>
          <p>A meeting is proposed only when an outside guest matched no LP and something suggests an investor: investor data we hold for the firm or a guest, or invite wording such as fund, LP, investment or allocation, or one of our vehicles named. None in the meetings read does; that is not the same as none existing.</p>
        </div></div>
      ) : (
        <ul className={s.list}>
          {list.map((c) => (
            <li key={c.key} className={s.item}>
              <div>
                <div><Title c={c} /></div>
                <div className={s.meta}><b>{plural(c.meetings.length, 'meeting')}</b>: {datesLine(c, now)}</div>
                <div className={s.meta}>{guestsLine(c.guests)}</div>
                <div className={s.reasons}>{c.reasons.map((r, i) => <span key={i} className={`flag ${r.kind === 'investor_data' || r.kind === 'known_investor' ? 'f-ok' : 'f-mute'}`}>{reasonText(r)}</span>)}</div>
              </div>
              {open.length ? (
                <CandidateActions candidateKey={c.key} domain={c.domain} held={!!c.entityId} vehicles={open.map((v) => ({ id: v.id, name: v.name }))} fixedVehicle={!!vehicle} />
              ) : (
                <div className={s.meta}>{vehicle ? `${vehicle.name} does not take LP prospects here (being raised, and not the grants rail), or you cannot change it.` : 'No vehicle you can change is being raised.'} Someone on the team who can may add it.</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <div className={s.recent}>
          <div className="lbl">Added from the calendar lately</div>
          <ul className={s.list}>
            {recent.map((a) => (
              <li key={a.pursuitId}>
                <Link href={`/targets/${a.pursuitId}`}>{a.name}</Link> to New for {a.vehicle}, {shortDate(a.at)}, with {plural(a.meetings, 'meeting')}
                {can(user, 'mutate', {}) && <UndoAdd pursuitId={a.pursuitId} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={s.cover}>
        <b>What this covers:</b> the calendars read through each person’s mailguard key, about 18 months back and 90 days ahead, as the calendar read keeps them.
        Only dates, the team on each meeting, guests’ email domains and the reasons are kept; never a title, a description or a guest’s address or name.
        Personal addresses with nobody we hold, portfolio companies, our own team and Protocol Labs are left out, as is anything set aside as not an LP.
        A meeting no one on the team keeps in a connected calendar is not seen.
      </p>
    </section>
  );
}
