import Link from 'next/link';
import { summarize, touchpointsByPair } from '@/modules/meetings';
import { auditSince } from '@/modules/platform';
import { STATUSES, type Pursuit, type PursuitStatus } from '@/modules/strategy';

/**
 * A vehicle's movement, in numbers (N62, issue 0007). Juan, on the overview's "What happened":
 * "some of these dont belong in 'what happened' for this vehicle… with so many LPs and activity
 * and so on, idk what this section would show. i think aggregate stats/metrics/dashboard things
 * are good here, not a big list." So: the last 30 days, what is coming up, and who is waiting —
 * each counted from this vehicle's pursuits only, and from touchpoints about its raise (N59).
 */
const DAY = 86_400_000;
const ORDER: PursuitStatus[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'];
const BY_LABEL = new Map(STATUSES.map((s) => [s.label, s.id]));

function Stat({ n, label, sub, href, warn }: { n: number; label: string; sub?: string; href?: string; warn?: boolean }) {
  const body = (
    <>
      <span className={`n mono${warn && n > 0 ? ' warnnum' : ''}`}>{n.toLocaleString('en-US')}</span>
      <span className="l">{label}</span>
      {sub && <span className="s">{sub}</span>}
    </>
  );
  return href && n > 0 ? <Link className="vstat" href={href}>{body}</Link> : <div className="vstat">{body}</div>;
}

export async function Lately({ pursuits, vehicleName }: { pursuits: Pursuit[]; vehicleName: string }) {
  const now = new Date();
  const t = now.getTime();
  const since = t - 30 * DAY;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ids = new Set(pursuits.map((p) => p.pursuitId));
  const [touches, log] = await Promise.all([
    touchpointsByPair(pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }))),
    auditSince(['pursuit.status_set', 'pursuit.update_added'], new Date(since)),
  ]);

  let meetings = 0, first = 0, replies = 0, outreach = 0, ahead = 0, waiting = 0, quiet = 0, due = 0, overdue = 0;
  const met = new Set<string>();
  for (const p of pursuits) {
    // Their firm's touchpoints are a colleague's, not theirs (N55): not counted here either.
    const list = (touches.get(`${p.entityId}:${p.vehicleId}`) ?? []).filter((x) => !x.viaOrganization);
    for (const x of list) {
      const on = x.on?.getTime();
      if (on !== undefined && on >= since && on <= t) {
        if (x.channel === 'meeting' || x.channel === 'call') { meetings++; met.add(p.pursuitId); }
        if ((x.channel === 'email' || x.channel === 'message') && x.direction === 'theirs') replies++;
        if ((x.channel === 'email' || x.channel === 'message') && x.direction === 'ours') outreach++;
      }
      const set = !x.on && x.scheduledFor ? x.scheduledFor.getTime() : null;
      if (set !== null && set > t && set <= t + 30 * DAY) ahead++;
    }
    const s = summarize(list, now);
    if (s.meetingDates[0] && s.meetingDates[0].getTime() >= since) first++;
    if (p.status === 'passed') continue;
    // Waiting counts from Selected on: before we decide to approach, an old email is not a wait.
    if (s.awaitingSince && t - s.awaitingSince.getTime() >= 14 * DAY && p.status !== 'new' && p.status !== 'sourcing') waiting++;
    if (p.status === 'discussing' && (!s.lastTouch || t - s.lastTouch.getTime() > 90 * DAY)) quiet++;
    if (p.nextStepOn) {
      const d = p.nextStepOn.getTime();
      if (d < today) overdue++;
      else if (d < today + 7 * DAY) due++;
    }
  }

  // Status changes made here are dated in the audit log; one read from Affinity is not.
  const idOf = (id: unknown, label: unknown) => (typeof id === 'string' ? id : BY_LABEL.get(String(label))) as PursuitStatus | undefined;
  const moves = log.filter((a) => a.action === 'pursuit.status_set' && a.subjectId && ids.has(a.subjectId));
  const forward = new Set(moves.filter((a) => {
    const from = idOf(a.detail['fromId'], a.detail['from']);
    const to = idOf(a.detail['toId'], a.detail['to']);
    return to && to !== 'passed' && (from === 'passed' || ORDER.indexOf(to) > ORDER.indexOf(from ?? 'new'));
  }).map((a) => a.subjectId)).size;
  const passed = new Set(moves.filter((a) => idOf(a.detail['toId'], a.detail['to']) === 'passed').map((a) => a.subjectId)).size;
  const updates = log.filter((a) => a.action === 'pursuit.update_added' && a.subjectId && ids.has(a.subjectId)).length;

  return (
    <div className="card">
      <div className="chead">
        <h2>Lately</h2>
        <span className="lbl">{vehicleName} · counted, not listed</span>
      </div>
      <div className="cbody">
        <div className="lbl">The last 30 days</div>
        <div className="vstats">
          <Stat n={meetings} label={meetings === 1 ? 'meeting or call held' : 'meetings and calls held'} sub={`with ${met.size} ${met.size === 1 ? 'LP' : 'LPs'}, ${first} of them a first`} />
          <Stat n={replies} label={replies === 1 ? 'email from an LP' : 'emails from LPs'} />
          <Stat n={outreach} label={outreach === 1 ? 'email from us' : 'emails from us'} />
          <Stat n={forward} label={forward === 1 ? 'LP moved forward here' : 'LPs moved forward here'} />
          <Stat n={passed} label="passed" href="/targets?status=passed" />
          <Stat n={updates} label={updates === 1 ? 'update written' : 'updates written'} />
        </div>
        <div className="lbl" style={{ marginTop: 14 }}>Coming up</div>
        <div className="vstats">
          <Stat n={ahead} label="meetings in the next 30 days" />
          <Stat n={due} label="next steps due this week" />
          <Stat n={overdue} label="next steps past their date" warn />
        </div>
        <div className="lbl" style={{ marginTop: 14 }}>Waiting</div>
        <div className="vstats">
          <Stat n={waiting} label="waiting on a reply for two weeks or more" sub="from Selected on: we wrote last, nothing from them since" href="/targets?status=connecting&touch=waiting" />
          <Stat n={quiet} label="discussing, no touch in 90 days" href="/targets?status=discussing&touch=stale" />
        </div>
      </div>
      <p className="cover">
        <b>What this counts:</b> {vehicleName}&rsquo;s pursuits, and touchpoints about its raise, inside
        its window. A colleague at the same firm is counted on their own page, not here. A status
        change counts when it was made here; one read from Affinity carries no date, so it is not
        in the 30 days.
      </p>
    </div>
  );
}
