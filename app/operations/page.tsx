import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago, shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import { connectorLoad, listAsks, listConflicts, listRestrictions, REASON_LABEL } from '@/modules/coordination';
import { sprintStrip, urgency } from '@/modules/calendar';
import { listCycles, bandwidthAlerts } from '@/modules/close';
import { poolChecks } from '@/modules/pipeline';
import { SprintStrip } from '@/components/calendar/SprintStrip';

export const dynamic = 'force-dynamic';

/**
 * Operations is the cross-vehicle layer: the things that are true of the raise rather than
 * of any one vehicle. Conflicts between vehicles, connector goodwill spent across all of
 * them, the calendar everyone shares, and the budget one actor has for all of us.
 */
export default async function Operations() {
  const [asks, conflicts, load, restrictions, weeks, urgencyState, cycles, alerts, pools] =
    await Promise.all([
      listAsks(), listConflicts(), connectorLoad(), listRestrictions(),
      sprintStrip(7), urgency(), listCycles(), bandwidthAlerts(), poolChecks(),
    ]);

  const open = conflicts.filter((c) => c.status === 'open');
  const blocked = asks.filter((a) => a.status === 'blocked');
  const cap = config.guard.asksPerConnectorPerQuarter;
  const over = pools.filter((p) => p.status === 'over');
  const workingWeeks = weeks.filter((w) => !w.dead).length;

  return (
    <Page
      crumbs={[{ label: SECTION.capital }, { label: 'Operations' }]}
      inspector={
        <>
          <div className="lbl">Connector load</div>
          <div className="ihead">Goodwill is the scarce resource</div>
          <div className="imeta">Across every vehicle · cap {cap} per quarter</div>
          {load.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>No ask has gone through a connector yet.</p>
          ) : (
            load.map((c) => (
              <div className="kv" key={c.connectorId}>
                <span>{c.name}</span>
                <span style={{ color: c.used >= cap ? 'var(--clay)' : undefined }}>
                  {c.used} of {cap}
                </span>
              </div>
            ))
          )}
          <div className="scope">
            <div className="lbl">Why this is not per vehicle</div>
            <p>
              A connector does not have a separate reserve of patience for each of our raises.
              The cap is counted across all of them, which is the only way it means anything.
            </p>
          </div>
          <div className="note">
            {restrictions.length} restriction{restrictions.length === 1 ? '' : 's'} on file. They
            attach to the target and are checked on every candidate route, in every vehicle.
          </div>
        </>
      }
    >
      <div className="lbl">PL Capital · across every vehicle</div>
      <h1>Operations</h1>
      <p className="sublede">
        The part of the raise that is not about one vehicle: collisions between them, goodwill
        spent across them, the calendar they share, and the budget one investor has for all of us.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className={open.length ? 'tag t-clay' : 'tag t-plain'}>Open conflicts</span>
          <div className="n">{open.length}</div>
          <div className="f">
            Two vehicles on one actor inside {config.guard.conflictWindowDays} days.
          </div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Asks blocked</span>
          <div className="n">{blocked.length}</div>
          <div className="f">Refused by a guard before anything left the building.</div>
        </div>
        <div className="kpi">
          <span className={over.length ? 'tag t-clay' : 'tag t-plain'}>Pool violations</span>
          <div className="n">{over.length}</div>
          <div className="f">
            {over.length === 0
              ? 'No actor is committed beyond a verified budget.'
              : `${usdM(over.reduce((a, p) => a + p.over, 0))} counted in more than one place.`}
          </div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Working weeks</span>
          <div className="n">
            {workingWeeks} of {weeks.length}
          </div>
          <div className="f">
            {urgencyState.suppressed ? 'Urgency suppressed today.' : 'The queue speaks normally today.'}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Elsewhere</h2>
          <span className="lbl">cross-vehicle, and not scoped to one</span>
        </div>
        <div className="cbody" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" href="/forecast" style={{ padding: '7px 12px' }}>
            Forecast &amp; conserved pool
          </Link>
          <Link className="btn" href="/calendar" style={{ padding: '7px 12px' }}>
            Sprint calendar
          </Link>
          <Link className="btn" href="/asks" style={{ padding: '7px 12px' }}>
            Ask log
          </Link>
          <Link className="btn" href="/research" style={{ padding: '7px 12px' }}>
            The universe
          </Link>
          <Link className="btn" href="/orgs/g/all" style={{ padding: '7px 12px' }}>
            Relationships
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The run to the closes</h2>
          <span className="lbl">
            {cycles.map((c) => `${c.vehicleName} ${shortDate(c.targetDate)}`).join(' · ') || 'no cycle open'}
          </span>
        </div>
        <SprintStrip weeks={weeks} />
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Conflicts</h2>
            <span className="lbl">a record with a lifecycle, not a block</span>
          </div>
          {conflicts.length === 0 ? (
            <div className="cbody">
              <p className="muted">No vehicle has collided with another.</p>
            </div>
          ) : (
            conflicts.map((c) => (
              <Link
                className="row"
                key={c.caseId}
                href={`/approvals?t=${c.claimantB.ticketId ?? c.claimantA.ticketId ?? ''}`}
              >
                <span className={`flag ${c.status === 'open' ? 'f-block' : 'f-ok'}`} style={{ width: 96, textAlign: 'center' }}>
                  {c.status}
                </span>
                <div className="t">
                  <b>{c.entityName}</b>
                  <span>
                    {c.claimantA.vehicleName} and {c.claimantB.vehicleName} ·{' '}
                    {c.reasonCode ? REASON_LABEL[c.reasonCode] : 'not adjudicated'}
                  </span>
                </div>
                <div className="state">
                  <b>{c.loserFollowupAt ? shortDate(c.loserFollowupAt) : ago(c.openedAt)}</b>
                  {c.loserFollowupAt ? 'the other returns' : 'opened'}
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="card">
          <div className="chead">
            <h2>Bandwidth</h2>
            <span className="lbl">named, not blocked</span>
          </div>
          {alerts.length === 0 ? (
            <div className="cbody">
              <p className="muted">Nobody is split between an SPV clock and a fund close.</p>
            </div>
          ) : (
            alerts.slice(0, 6).map((a, i) => (
              <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
                <span className="kind k-stage" style={{ width: 76 }}>{a.kind}</span>
                <div className="t">
                  <b>{a.name}</b>
                  <span>{a.detail}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Page>
  );
}
