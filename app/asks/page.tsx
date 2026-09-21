import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago, shortDate } from '@/lib/time';
import { vehicleSelection } from '@/lib/session';
import {
  connectorLoad, listAsks, listConflicts, listRestrictions, REASON_LABEL,
} from '@/modules/coordination';

export const dynamic = 'force-dynamic';

const STATUS_FLAG: Record<string, string> = {
  proposed: 'f-mute', blocked: 'f-block', approved: 'f-ok',
  made: 'f-ok', answered: 'f-mute', withdrawn: 'f-mute',
};

const OUTCOME_LABEL: Record<string, string> = {
  opted_in: 'Opted in', declined: 'Declined', no_reply: 'No reply', deferred: 'Deferred',
};

export default async function Asks() {
  const selection = await vehicleSelection();
  const [asks, conflicts, load, restrictions] = await Promise.all([
    listAsks(selection.current?.id ?? null),
    listConflicts(),
    connectorLoad(),
    listRestrictions(),
  ]);

  const openConflicts = conflicts.filter((c) => c.status === 'open');
  const blocked = asks.filter((a) => a.status === 'blocked');
  const cap = config.guard.asksPerConnectorPerQuarter;

  return (
    <Page
      crumbs={[
        { label: selection.current?.name ?? 'All vehicles', href: '/overview' },
        { label: 'Ask coordination' },
      ]}
      inspector={
        <>
          <div className="lbl">Connector load</div>
          <div className="ihead">Goodwill is the scarce resource</div>
          <div className="imeta">Asks per connector this quarter · cap {cap}</div>
          {load.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              No ask has gone through a connector yet.
            </p>
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
            <div className="lbl">Why the cap sits on the connector</div>
            <p>
              A target-side frequency guard protects the target. The connector-side cap protects
              the thing you cannot buy back. Both run; the connector one blocks more often.
            </p>
          </div>
          <div className="note">
            The cap of {cap} is a guess in <code>config/deployment.ts</code>, taken from an
            unverified 1–5 range. It should move the moment there is real data behind it.
          </div>
        </>
      }
    >
      <div className="lbl">Module 07 · Convert &amp; coordinate</div>
      <h1>Ask coordination</h1>
      <p className="sublede">
        One owner per relationship, a frequency guard on the target, a load cap on the connector,
        and a conflict case whenever two vehicles reach for the same person inside{' '}
        {config.guard.conflictWindowDays} days. The guard refuses before the ask is made, not after.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className="tag t-plain">Asks on file</span>
          <div className="n">{asks.length}</div>
          <div className="f">{asks.filter((a) => a.madeAt).length} actually made.</div>
        </div>
        <div className="kpi">
          <span className={blocked.length ? 'tag t-clay' : 'tag t-plain'}>Blocked</span>
          <div className="n">{blocked.length}</div>
          <div className="f">Refused by a guard before anything left the building.</div>
        </div>
        <div className="kpi">
          <span className={openConflicts.length ? 'tag t-clay' : 'tag t-plain'}>Open conflicts</span>
          <div className="n">{openConflicts.length}</div>
          <div className="f">Each needs a winner, a reason, and a dated follow-up for the loser.</div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Restrictions</span>
          <div className="n">{restrictions.length}</div>
          <div className="f">Attached to targets, checked on every candidate route.</div>
        </div>
      </div>

      {openConflicts.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Conflicts waiting on a decision</h2>
            <span className="lbl">{config.guard.conflictWindowDays}-day window · GUESS</span>
          </div>
          {openConflicts.map((c) => (
            <Link
              key={c.caseId}
              className="row"
              href={`/approvals?t=${c.claimantB.ticketId ?? c.claimantA.ticketId ?? ''}`}
            >
              <span className="kind k-intro" style={{ width: 110 }}>
                CONFLICT
              </span>
              <div className="t">
                <b>{c.entityName}</b>
                <span>
                  {c.claimantA.vehicleName} and {c.claimantB.vehicleName}, both inside the window ·
                  opened {ago(c.openedAt)}
                </span>
              </div>
              <div className="state">
                <b>Adjudication required</b>
                one proceeds, one returns
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>The ask log</h2>
          <span className="lbl">
            {selection.current ? selection.current.name : 'all vehicles'} · every ask, made or not
          </span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Target</th>
              <th style={{ width: 150 }}>Via</th>
              <th style={{ width: 140 }}>Vehicle</th>
              <th style={{ width: 110 }}>Owner</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 120 }}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {asks.map((a) => (
              <tr key={a.askId}>
                <td>
                  <Link href={`/orgs/${a.entityId}`}>
                    <b>{a.entityName}</b>
                  </Link>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {a.purpose}
                  </div>
                </td>
                <td className="muted">{a.connectorName ?? 'direct'}</td>
                <td className="muted">{a.vehicleName}</td>
                <td className="muted">{a.ownerName}</td>
                <td>
                  <span className={`flag ${STATUS_FLAG[a.status]}`}>{a.status}</span>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                    {a.madeAt ? ago(a.madeAt) : a.scheduledFor ? `returns ${shortDate(a.scheduledFor)}` : '—'}
                  </div>
                </td>
                <td className="muted">
                  {a.outcome ? OUTCOME_LABEL[a.outcome] : '—'}
                  {a.outcomeNote && (
                    <div style={{ fontSize: 10.5, marginTop: 3 }}>{a.outcomeNote}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>What this covers:</b> every ask recorded in this system, across all vehicles when no
          vehicle is selected. It does not cover conversations that happened before this log
          existed, or anything nobody wrote down.
        </p>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Restrictions on file</h2>
            <span className="lbl">attached to the target, not the edge</span>
          </div>
          {restrictions.length === 0 ? (
            <div className="cbody">
              <p className="muted">None recorded.</p>
            </div>
          ) : (
            restrictions.map((r) => (
              <div className="row" key={r.restrictionId} style={{ alignItems: 'flex-start' }}>
                <span className="kind k-send" style={{ width: 90 }}>
                  {r.scope}
                </span>
                <div className="t">
                  <b>{r.instruction}</b>
                  <span>
                    {r.entityName}
                    {r.connectorName ? ` · concerning ${r.connectorName}` : ''} · recorded by{' '}
                    {r.recordedByName ?? 'unattributed'}
                    {r.source ? ` from ${r.source}` : ''}
                  </span>
                </div>
              </div>
            ))
          )}
          <p className="cover">
            A connector-scoped restriction is not an invitation to find another connector toward
            the same approach. The guard refuses the substitution too, and that refusal cannot be
            overridden with a reason — it is the target&rsquo;s instruction, not our policy.
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Adjudicated</h2>
            <span className="lbl">winner, reason, and the loser&rsquo;s date</span>
          </div>
          {conflicts.filter((c) => c.status === 'adjudicated').length === 0 ? (
            <div className="cbody">
              <p className="muted">
                Nothing adjudicated yet. When a case is decided it records all four things — a
                winner, a loser, a reason code, and a dated follow-up — and the last one is what
                turns a block into a scheduled second bite.
              </p>
            </div>
          ) : (
            conflicts
              .filter((c) => c.status === 'adjudicated')
              .map((c) => (
                <div className="row" key={c.caseId} style={{ alignItems: 'flex-start' }}>
                  <div className="t">
                    <b>{c.entityName}</b>
                    <span>
                      {c.winnerAskId === c.claimantA.askId ? c.claimantA.vehicleName : c.claimantB.vehicleName}{' '}
                      proceeds · {c.reasonCode ? REASON_LABEL[c.reasonCode] : '—'}
                    </span>
                  </div>
                  <div className="state">
                    <b>{c.loserFollowupAt ? shortDate(c.loserFollowupAt) : 'no date'}</b>
                    the other returns
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </Page>
  );
}
