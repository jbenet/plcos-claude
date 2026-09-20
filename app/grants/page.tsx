import { Page } from '@/components/shell/Page';
import { InvitationForm } from '@/components/grants/InvitationForm';
import { shortDate } from '@/lib/time';
import { FUNDER_STATUS_LABEL, listFunders } from '@/modules/grants';

export const dynamic = 'force-dynamic';

const STATUS_FLAG: Record<string, string> = {
  sourced: 'f-mute', invited: 'f-ok', applied: 'f-ev', awarded: 'f-ok', declined: 'f-mute',
};

export default async function Grants() {
  const funders = await listFunders();
  const blocked = funders.filter((f) => !f.mayApproach);

  return (
    <Page
      crumbs={[{ label: 'Execute & govern' }, { label: 'Grants rail' }]}
      inspector={
        <>
          <div className="lbl">The gate</div>
          <div className="ihead">Sourced, not applied for</div>
          <div className="imeta">A state machine guard, not advice</div>
          <div className="kv">
            <span>Funders on the rail</span>
            <span>{funders.length}</span>
          </div>
          <div className="kv">
            <span>Outreach blocked</span>
            <span style={{ color: blocked.length ? 'var(--clay)' : undefined }}>{blocked.length}</span>
          </div>
          <div className="kv">
            <span>Invitation on file</span>
            <span>{funders.length - blocked.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">What counts as an invitation</div>
            <p>
              A reference, a date and a name. An encouraging conversation at a conference is not an
              invitation, and the difference is the entire point of the rule — unsolicited
              approaches are how a foundation relationship ends before it starts.
            </p>
          </div>
          <div className="warn" style={{ marginTop: 16 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>
              Not overridable
            </div>
            <p>
              The ask guard refuses grants-rail outreach without an invitation and offers no
              override, the same as a do-not-approach instruction. It is somebody else&rsquo;s
              decision, not our policy.
            </p>
          </div>
        </>
      }
    >
      <div className="lbl">Module 20 · Execute &amp; govern</div>
      <h1>Grants rail</h1>
      <p className="sublede">
        Funders we have sourced, and the small number who have actually invited us. Outreach is
        blocked until an invitation exists — encoded as a guard in the ask path rather than as a
        paragraph somebody is meant to remember.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Funders</h2>
          <span className="lbl">
            {blocked.length} blocked · {funders.length - blocked.length} open
          </span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 290 }}>Funder</th>
              <th style={{ width: 210 }}>Programme</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 210 }}>Invitation</th>
              <th style={{ width: 190 }}>Outreach</th>
            </tr>
          </thead>
          <tbody>
            {funders.map((f) => (
              <tr key={f.funderId}>
                <td>
                  <b>{f.entityName}</b>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {f.fitNote}
                  </div>
                </td>
                <td className="muted">
                  {f.programme}
                  <div style={{ fontSize: 11 }}>{f.cycle}</div>
                </td>
                <td>
                  <span className={`flag ${STATUS_FLAG[f.status]}`}>{FUNDER_STATUS_LABEL[f.status]}</span>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {f.invitationRef ? (
                    <>
                      <span className="mono">{f.invitationRef}</span>
                      <div>
                        {f.invitedOn ? shortDate(f.invitedOn) : ''} · {f.invitedBy}
                      </div>
                    </>
                  ) : (
                    'None on file'
                  )}
                </td>
                <td>
                  {f.mayApproach ? (
                    <span className="flag f-ok">permitted</span>
                  ) : (
                    <>
                      <span className="flag f-block" style={{ marginBottom: 6, display: 'inline-block' }}>
                        blocked
                      </span>
                      <InvitationForm funderId={f.funderId} funderName={f.entityName} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>What this covers:</b> funders someone has recorded on the rail. A funder nobody has
          written down is not permitted by omission — the guard refuses an entity with no funder
          record at all, for the same reason.
        </p>
      </div>
    </Page>
  );
}
