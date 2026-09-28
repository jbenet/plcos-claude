import Link from '@/components/ui/AppLink';
import { localToday, vehicleWorkstreams, type Workstream } from '@/modules/linear';
import { dayMonth, IssueList } from './IssueList';
import { Avatar, ProgressRing, ProjectIcon, StatusIcon } from './icons';
import { freshnessWord } from './MyLinear';
import s from './linear.module.css';

/**
 * Workstreams, on a vehicle's Overview (docs/24-linear.md): the Linear projects a person linked to
 * this vehicle, each with status, lead, done/total and target, on one start-to-target strip; then
 * the next open issues and the latest done. A card, not a page: Linear's own timeline is a click away.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function scale(projects: Workstream[], today: string) {
  const dates = [today, ...projects.flatMap((p) => [p.start, p.target].filter((x): x is string => Boolean(x)))].map(t);
  let lo = Math.min(...dates), hi = Math.max(...dates);
  if (hi - lo < 60 * DAY) hi = lo + 60 * DAY; // GUESS: two months is the shortest span that still reads as a timeline
  const pad = (hi - lo) * 0.04;
  lo -= pad; hi += pad;
  const x = (ms: number) => ((ms - lo) / (hi - lo)) * 100;
  const ticks: Array<{ at: number; label: string }> = [];
  const d = new Date(lo);
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  for (; d.getTime() < hi; d.setUTCMonth(d.getUTCMonth() + 1)) ticks.push({ at: x(d.getTime()), label: MONTHS[d.getUTCMonth()]! });
  const every = ticks.length > 7 ? 2 : 1;
  return { x, ticks: ticks.filter((_, i) => i % every === 0), hi };
}

function Bar({ p, x, hi }: { p: Workstream; x: (ms: number) => number; hi: number }) {
  const c = p.color ?? 'var(--muted)';
  const tint = `color-mix(in srgb, ${c} 22%, var(--surface))`;
  const fill = `color-mix(in srgb, ${c} 70%, var(--surface))`;
  const f = p.total > 0 ? p.done / p.total : 0;
  if (p.start && p.target) {
    const l = x(t(p.start)), w = Math.max(0.8, x(t(p.target)) - l);
    return <span className={s.bar} style={{ left: `${l}%`, width: `${w}%`, background: tint }}><i style={{ width: `${f * 100}%`, background: fill }} /></span>;
  }
  if (p.start) {
    const l = x(t(p.start));
    return <span className={`${s.bar} ${s.open}`} style={{ left: `${l}%`, width: `${x(hi) - l}%`, background: `linear-gradient(90deg, ${tint} 55%, transparent)` }} title="No target date" />;
  }
  if (p.target) return <span className={s.diamond} style={{ left: `${x(t(p.target))}%`, background: fill }} title="Target only, no start date" />;
  return <span className={s.noDates}>no dates</span>;
}

export async function WorkstreamsCard({ vehicle }: { vehicle: { id: string; name: string } }) {
  let w;
  try {
    w = await vehicleWorkstreams(vehicle.id);
  } catch {
    return (
      <div className="card">
        <div className="chead"><h2>Workstreams</h2><span className="flag f-mute">Source unavailable</span></div>
        <div className="cbody"><p className="muted">The Linear replica could not be read, so nothing is shown rather than an empty card. Reload; Developer → Linear shows the sync.</p></div>
      </div>
    );
  }
  const today = localToday();
  const fresh = freshnessWord(w.freshness);
  const head = (
    <div className="chead">
      <h2>Workstreams</h2>
      <span className={s.headRight}>
        {fresh.flag && <span className="flag f-block">{fresh.flag}</span>}
        <span className={s.fresh}>Linear · {w.projects.length ? `${w.projects.length} project${w.projects.length === 1 ? '' : 's'} · ` : ''}{fresh.text}</span>
      </span>
    </div>
  );

  if (!w.synced || w.projects.length === 0) {
    return (
      <div className="card">
        {head}
        <div className={s.empty}>
          {!w.synced ? (
            <><b>Linear hasn’t been read on this server yet.</b> Once it is synced on <Link href="/dev/linear">Developer → Linear</Link>, the projects linked to {vehicle.name} show here.</>
          ) : w.suggested > 0 ? (
            <><b>No Linear project is linked to {vehicle.name} yet.</b> {w.suggested} look{w.suggested === 1 ? 's' : ''} like it by name: accept {w.suggested === 1 ? 'it' : 'them'} once on <Link href="/dev/linear#links">Developer → Linear</Link> and {w.suggested === 1 ? 'it shows' : 'they show'} here.</>
          ) : (
            <><b>No Linear project is linked to {vehicle.name}.</b> Link one by hand on <Link href="/dev/linear#links">Developer → Linear</Link> when the team starts one.</>
          )}
        </div>
      </div>
    );
  }

  const { x, ticks, hi } = scale(w.projects, today);
  const todayX = x(t(today));
  return (
    <div className={`card ${s.ws}`}>
      {head}
      <div className={s.axis} aria-hidden>
        <span />
        <span className={s.axisLbl}>Project</span>
        <span className={`${s.axisLbl} ${s.pLead}`}>Lead</span>
        <span className={s.track}>
          {ticks.map((k) => <span key={k.at} className={s.tick} style={{ left: `${k.at}%` }}>{Math.abs(k.at - todayX) > 7 && k.at < 93 && <span>{k.label}</span>}</span>)}
          <span className={s.todayLbl} style={{ left: `${todayX}%` }}>Today</span>
        </span>
        <span className={s.axisLbl}>Done</span>
        <span className={`${s.axisLbl} ${s.pTarget}`}>Target</span>
      </div>
      {w.projects.map((p) => {
        const late = Boolean(p.target && p.target < today && p.status.type !== 'completed' && p.status.type !== 'canceled');
        const summary = `${p.name}: ${p.status.name}; lead ${p.lead?.name ?? 'none'}; ${p.done} of ${p.total} issues done; ${p.start ? `started ${dayMonth(p.start)}` : 'no start date'}; ${p.target ? `target ${dayMonth(p.target)}${late ? ', past it' : ''}` : 'no target date'}.`;
        const inner = (
          <>
            <span className={s.pIcon}><StatusIcon type={p.status.type} name={p.status.name} /></span>
            <span className={s.pName}><ProjectIcon color={p.color} /><b>{p.name}</b></span>
            <span className={s.pLead}>{p.lead ? <><Avatar person={p.lead} size={16} /><span>{p.lead.name}</span></> : <span>No lead</span>}</span>
            <span className={s.track} aria-hidden>
              {ticks.map((k) => <span key={k.at} className={s.tick} style={{ left: `${k.at}%` }} />)}
              <Bar p={p} x={x} hi={hi} />
              <span className={s.today} style={{ left: `${todayX}%` }} />
            </span>
            <span className={s.pProg} aria-hidden><ProgressRing done={p.done} total={p.total} color={p.color} />{p.done}/{p.total}</span>
            <span className={`${s.pTarget} ${late ? s.late : ''}`} aria-hidden>{p.target ? dayMonth(p.target) : '—'}</span>
            <span className="sr-only">{summary}{p.url ? ' Opens in Linear, in a new tab.' : ''}</span>
          </>
        );
        return p.url
          ? <a key={p.id} className={s.prow} href={p.url} target="_blank" rel="noopener noreferrer" title={summary}>{inner}</a>
          : <div key={p.id} className={s.prow} title={summary}>{inner}</div>;
      })}
      <div className={s.split}>
        <div>
          <div className={s.sub}>
            <h3>Upcoming</h3>
            <span>{w.upcoming.length ? `next ${w.upcoming.length}${w.upcomingMore ? ` of ${w.upcoming.length + w.upcomingMore}` : ''} open · by due date, then priority` : ''}</span>
          </div>
          <IssueList issues={w.upcoming} today={today} empty="Nothing open in these projects." />
        </div>
        <div>
          <div className={s.sub}>
            <h3>Recently done</h3>
            <span>{w.recentlyDone.length ? 'latest first' : ''}</span>
          </div>
          <IssueList issues={w.recentlyDone} today={today} date="completed" empty="Nothing done in these projects yet." />
        </div>
      </div>
      <p className="cover">
        <b>From Linear, read-only.</b> The projects linked to {vehicle.name} on Developer → Linear{w.suggested > 0 ? ` (${w.suggested} more suggested by name, not yet accepted)` : ''};
        progress counts issues done of all not canceled. The red line is today. Every row opens Linear.
      </p>
    </div>
  );
}
