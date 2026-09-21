import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { SprintStrip } from '@/components/calendar/SprintStrip';
import { listPeriods, sprintStrip, urgency } from '@/modules/calendar';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

const KIND_FLAG: Record<string, string> = {
  sprint: 'f-mute', holiday: 'f-ev', dead_zone: 'f-block', milestone: 'f-ok',
};

export default async function Calendar() {
  const [weeks, periods, urgencyState] = await Promise.all([
    sprintStrip(18), listPeriods(), urgency(),
  ]);
  const suppressing = periods.filter((p) => p.suppressUrgency);
  const workingWeeks = weeks.filter((w) => !w.dead).length;

  return (
    <Page
      crumbs={[{ label: SECTION.other }, { label: 'Sprint calendar' }]}
      inspector={
        <>
          <div className="lbl">Today</div>
          <div className="ihead">
            {urgencyState.suppressed ? 'Urgency suppressed' : 'A working day'}
          </div>
          <div className="imeta">
            {urgencyState.suppressed
              ? `Until ${urgencyState.until ? shortDate(urgencyState.until) : 'further notice'}`
              : 'The queue speaks normally'}
          </div>
          <div className="kv">
            <span>Weeks shown</span>
            <span>{weeks.length}</span>
          </div>
          <div className="kv">
            <span>Working weeks</span>
            <span>{workingWeeks}</span>
          </div>
          <div className="kv">
            <span>Dead weeks</span>
            <span>{weeks.length - workingWeeks}</span>
          </div>
          <div className="scope">
            <div className="lbl">What suppression does</div>
            <p>
              Nothing is hidden and nothing is rescheduled. The system stops using urgency
              language, because a queue that nags into an empty office is not urgency — it is
              noise, and it teaches people to ignore the queue.
            </p>
          </div>
          <div className="note">
            This is the module I dismissed as a nicety. For a raise with a December close it
            changes what the system says on roughly a third of the remaining working days.
          </div>
        </>
      }
    >
      <div className="lbl">Module 22 · Execute &amp; govern</div>
      <h1>Sprint calendar</h1>
      <p className="sublede">
        The run to the close, with the holiday overlay on. {weeks.length - workingWeeks} of the next{' '}
        {weeks.length} weeks are not working weeks, and the system knows it.
      </p>

      <div className="card">
        <div className="chead">
          <h2>The run to first close</h2>
          <span className="lbl">holiday overlay on</span>
        </div>
        <SprintStrip weeks={weeks} wrap />
        <p className="cover">
          <b>Dead weeks are drawn as dead</b> — grey, dashed, and never carrying a milestone.
          Scheduling a first close into the week of 24 December would be a plan that has already
          failed, so the calendar refuses to show one there.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Everything on the calendar</h2>
          <span className="lbl">{periods.length} periods · {suppressing.length} suppress urgency</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Kind</th>
              <th>What</th>
              <th style={{ width: 200 }}>When</th>
              <th style={{ width: 140 }}>Vehicle</th>
              <th style={{ width: 120 }}>Urgency</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.periodId}>
                <td>
                  <span className={`flag ${KIND_FLAG[p.kind]}`}>{p.kind.replace('_', ' ')}</span>
                </td>
                <td>
                  <b>{p.label}</b>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {p.detail}
                  </div>
                </td>
                <td className="muted nowrap">
                  {shortDate(p.startsOn)}
                  {p.endsOn.getTime() !== p.startsOn.getTime() ? ` → ${shortDate(p.endsOn)}` : ''}
                </td>
                <td className="muted">{p.vehicleName ?? 'all'}</td>
                <td className="muted">{p.suppressUrgency ? 'suppressed' : 'normal'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
