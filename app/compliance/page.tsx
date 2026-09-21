import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import {
  listAccreditation, listPublicClaims, listSideLetters, listSolicitations,
  METHOD_LABEL, STATUS_LABEL,
} from '@/modules/compliance';

export const dynamic = 'force-dynamic';

export default async function Compliance() {
  const selection = await vehicleSelection();
  const [accreditation, claims, solicitations, letters] = await Promise.all([
    listAccreditation(), listPublicClaims(), listSolicitations(), listSideLetters(),
  ]);
  const insufficient = accreditation.filter((r) => !r.sufficient);
  const needsReview = claims.filter((c) => c.status === 'needs_review');
  const incidents = solicitations.filter((s) => s.incident);
  const mfn = letters.filter((l) => l.mfn);

  return (
    <Page
      crumbs={moduleCrumbs('compliance', selection.current?.name ?? null)}
      inspector={
        <>
          <div className="lbl">Why this exists</div>
          <div className="ihead">Four of five vehicles are 506(c)</div>
          <div className="imeta">Which makes verification an obligation, not a formality</div>
          <div className="kv">
            <span>Subscribers on file</span>
            <span>{accreditation.length}</span>
          </div>
          <div className="kv">
            <span>Not sufficient</span>
            <span style={{ color: insufficient.length ? 'var(--clay)' : undefined }}>
              {insufficient.length}
            </span>
          </div>
          <div className="kv">
            <span>Public claims in use</span>
            <span>{claims.filter((c) => c.status === 'in_use').length}</span>
          </div>
          <div className="kv">
            <span>Claims needing review</span>
            <span style={{ color: needsReview.length ? 'var(--clay)' : undefined }}>
              {needsReview.length}
            </span>
          </div>
          <div className="scope">
            <div className="lbl">The rule the gate enforces</div>
            <p>
              Money cannot move onto the hard track for a 506(c) subscriber whose verification is
              missing, incomplete, expired, or self-certified. The check runs before the{' '}
              <code>MONEY</code> ticket is opened and again inside the transaction that would
              record it.
            </p>
          </div>
          <div className="note">
            A missing record is refused rather than waved through. Permitted-by-omission is the
            failure mode a verification obligation exists to prevent.
          </div>
        </>
      }
    >
      <div className="lbl">Module 24 · Execute &amp; govern</div>
      <h1>Claims &amp; solicitation registry</h1>
      <p className="sublede">
        A 506(c) vehicle may advertise. What it may not do is lose track of what was said, to whom,
        and on what basis — or accept money from someone it has not verified. This is the half of
        module 24 that is not the approvals queue.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Accreditation</h2>
          <span className="lbl">
            {accreditation.length - insufficient.length} of {accreditation.length} sufficient for
            their vehicle
          </span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 200 }}>Subscriber</th>
              <th style={{ width: 150 }}>Vehicle</th>
              <th style={{ width: 170 }}>Method</th>
              <th style={{ width: 150 }}>Status</th>
              <th>Sufficient?</th>
            </tr>
          </thead>
          <tbody>
            {accreditation.map((r) => (
              <tr key={r.recordId}>
                <td>
                  <Link href={`/orgs/${r.entityId}`}>
                    <b>{r.entityName}</b>
                  </Link>
                </td>
                <td className="muted">
                  {r.vehicleName}
                  <div className="mono" style={{ fontSize: 10.5 }}>
                    {r.exemption}
                  </div>
                </td>
                <td className="muted">
                  {METHOD_LABEL[r.method]}
                  {r.evidenceRef && (
                    <div className="mono" style={{ fontSize: 10.5 }}>
                      {r.evidenceRef}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`flag ${r.status === 'verified' ? 'f-ok' : 'f-ev'}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.verifiedOn && (
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                      {shortDate(r.verifiedOn)}
                      {r.expiresOn ? ` → ${shortDate(r.expiresOn)}` : ''}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`flag ${r.sufficient ? 'f-ok' : 'f-block'}`} style={{ marginBottom: 4, display: 'inline-block' }}>
                    {r.sufficient ? 'yes' : 'no'}
                  </span>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                    {r.why}
                    {r.note ? ` ${r.note}` : ''}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Whitcomb Capital is the case to look at.</b> The record is complete, signed and dated,
          and it is still not sufficient: self-certification is not reasonable steps under 506(c),
          no matter who signed it. Asking to harden that commitment is refused before a{' '}
          <code>MONEY</code> ticket is even opened.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Public claims</h2>
          <span className="lbl">every statement, and what backs it</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Statement</th>
              <th style={{ width: 110 }}>Channel</th>
              <th style={{ width: 100 }}>First used</th>
              <th style={{ width: 300 }}>Substantiation</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.claimId}>
                <td>
                  <b>{c.statement}</b>
                  {c.assetTitle && (
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {c.assetTitle}
                    </div>
                  )}
                </td>
                <td className="muted">{c.channel}</td>
                <td className="muted nowrap">{shortDate(c.firstUsedOn)}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {c.substantiation}
                  {c.substantiationRef && (
                    <div className="mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                      {c.substantiationRef}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`flag ${c.status === 'in_use' ? 'f-ok' : 'f-block'}`}>
                    {c.status.replace('_', ' ')}
                  </span>
                  {c.reviewedByName && (
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                      {c.reviewedByName}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          One claim is flagged <b>needs review</b>: &ldquo;backed by a $60M first close&rdquo; was
          used in an email on 19 September, and hard is $56.0M until the Cedar ticket is approved.
          The registry caught it because substantiation is a required field rather than a habit.
        </p>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>General solicitation</h2>
            <span className="lbl">
              {solicitations.length} events · {incidents.length} incidents
            </span>
          </div>
          {solicitations.map((s) => (
            <div className="row" key={s.eventId} style={{ alignItems: 'flex-start' }}>
              <span className={`kind ${s.incident ? 'k-send' : 'k-chore'}`} style={{ width: 96 }}>
                {s.channel}
              </span>
              <div className="t">
                <b>{s.audience}</b>
                <span style={{ display: 'block', lineHeight: 1.5 }}>{s.note}</span>
                {s.assetTitle && (
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    {s.assetTitle}
                  </span>
                )}
              </div>
              <div className="state">
                <b>{shortDate(s.occurredOn)}</b>
                {s.vehicleName} · {s.exemption}
              </div>
            </div>
          ))}
          <p className="cover">
            A 506(b) vehicle appearing in this log at all is an incident, not a row. There are{' '}
            {incidents.length}.
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Side letters</h2>
            <span className="lbl">{mfn.length} carrying MFN</span>
          </div>
          {letters.map((l) => (
            <div className="row" key={l.letterId} style={{ alignItems: 'flex-start' }}>
              <span className={`flag ${l.mfn ? 'f-block' : 'f-mute'}`} style={{ width: 54, textAlign: 'center' }}>
                {l.mfn ? 'MFN' : '—'}
              </span>
              <div className="t">
                <b>
                  {l.entityName} · {l.provision}
                </b>
                <span style={{ display: 'block', lineHeight: 1.5 }}>{l.risk}</span>
              </div>
              <div className="state">
                <b>{l.signedOn ? shortDate(l.signedOn) : 'unsigned'}</b>
                {l.reviewedByName ?? 'unreviewed'}
              </div>
            </div>
          ))}
          <p className="cover">
            The Cedar fee break triggers the Vantage MFN, and Vantage has not been told. That is a
            row here rather than a discovery in January.
          </p>
        </div>
      </div>
    </Page>
  );
}
