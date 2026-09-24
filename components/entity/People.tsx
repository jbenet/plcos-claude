import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { AFFIL_LABEL, AFFIL_MEANS, type Affiliation } from '@/modules/identity';
import { EntityLink } from './EntityLink';

const KIND_FLAG: Record<string, string> = {
  principal: 'f-ok', decision_maker: 'f-ok', contact: 'f-ev',
  adviser: 'f-mute', board: 'f-mute', staff: 'f-mute',
};

const CERT_CLASS: Record<string, string> = {
  known: 'c-known', inferred: 'c-inferred', guess: 'c-guess',
};

function Dates({ a }: { a: Affiliation }) {
  const from = a.startedOn ? shortDate(a.startedOn) : null;
  const to = a.endedOn ? shortDate(a.endedOn) : null;
  if (!from && !to) return <span className="muted">no dates on file</span>;
  return (
    <span className="mono" style={{ fontSize: 10.5 }}>
      {from ?? '—'} → {to ?? 'now'}
    </span>
  );
}

/**
 * The people who act for an organisation.
 *
 * Former roles are shown, not hidden. A route planned through a seat somebody left
 * eighteen months ago is the stale-graph failure this section exists to prevent, and the
 * only way to prevent it is to make the leaving visible.
 */
export function PeopleAt({
  people, orgName, elsewhere,
}: {
  people: Affiliation[];
  orgName: string;
  /** Every other organisation these people also act for. */
  elsewhere: Affiliation[];
}) {
  const current = people.filter((p) => p.current);
  const former = people.filter((p) => !p.current);
  const others = (personId: string) =>
    elsewhere.filter((x) => x.personId === personId && x.orgId !== people[0]?.orgId);

  return (
    <div className="card">
      <div className="chead">
        <h2>People</h2>
        <span className="lbl">
          {current.length} current
          {former.length > 0 ? ` · ${former.length} former` : ''}
        </span>
      </div>

      {people.length === 0 ? (
        <div className="cbody">
          <div className="empty">
            <span className="stat unavailable"><i />Nobody on file</span>
            <h3>No person is recorded as acting for {orgName}.</h3>
            <p>
              Which means every route to them is a route to an institution rather than to a
              human being. That is usually the reason an approach goes nowhere, and it is a gap
              in our record rather than a fact about them.
            </p>
          </div>
        </div>
      ) : (
        <table className="list affil">
          <thead>
            <tr>
              <th style={{ width: 210 }}>Who</th>
              <th style={{ width: 128 }}>Capacity</th>
              <th style={{ width: 178 }}>Role as they state it</th>
              <th style={{ width: 128 }}>Held</th>
              <th>What the capacity means here</th>
            </tr>
          </thead>
          <tbody>
            {people.map((a) => {
              const also = others(a.personId);
              return (
                <tr key={a.affiliationId} className={a.current ? undefined : 'past'}>
                  <td>
                    <EntityLink id={a.personId} name={a.personName} />
                    {also.length > 0 && (
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                        also{' '}
                        {also.map((x, i) => (
                          <span key={x.affiliationId}>
                            {i > 0 && ', '}
                            <Link href={`/orgs/${x.orgId}`}>{x.orgName}</Link>
                            {!x.current && ' (former)'}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`flag ${KIND_FLAG[a.kind]}`}>{AFFIL_LABEL[a.kind]}</span>
                    {!a.current && <div className="flag f-mute" style={{ marginTop: 4 }}>former</div>}
                  </td>
                  <td>{a.role}</td>
                  <td><Dates a={a} /></td>
                  <td className="muted">
                    {a.note ?? AFFIL_MEANS[a.kind]}
                    <span className={`cert ${CERT_CLASS[a.certainty] ?? 'c-known'}`} style={{ marginLeft: 6 }}>
                      {a.certainty}
                    </span>
                    <span className="mono asof">{shortDate(a.asOf)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="cover">
        <b>Capacity is recorded, not inferred from a title.</b> &ldquo;Decides&rdquo; means
        somebody confirmed they sign; a head-of-investments who has never been asked is{' '}
        <i>works there</i>. <b>Former roles stay visible</b> — a route through a seat somebody
        left is the quiet way a relationship graph goes wrong, and hiding the leaving is what
        makes it quiet.
      </p>
    </div>
  );
}

/** Where one person sits. More than one organisation is normal, not a data error. */
export function OrgsFor({ affiliations, personName }: { affiliations: Affiliation[]; personName: string }) {
  if (affiliations.length === 0) return null;
  const current = affiliations.filter((a) => a.current);

  return (
    <div className="card">
      <div className="chead">
        <h2>Where they sit</h2>
        <span className="lbl">
          {current.length} current
          {affiliations.length > current.length ? ` · ${affiliations.length - current.length} former` : ''}
        </span>
      </div>
      <table className="list affil">
        <thead>
          <tr>
            <th style={{ width: 230 }}>Organisation</th>
            <th style={{ width: 128 }}>Capacity</th>
            <th style={{ width: 178 }}>Role</th>
            <th style={{ width: 128 }}>Held</th>
            <th>Why it matters</th>
          </tr>
        </thead>
        <tbody>
          {affiliations.map((a) => (
            <tr key={a.affiliationId} className={a.current ? undefined : 'past'}>
              <td>
                <Link href={`/orgs/${a.orgId}`}><b>{a.orgName}</b></Link>
                <div className="muted" style={{ fontSize: 11 }}>{a.orgType}</div>
              </td>
              <td>
                <span className={`flag ${KIND_FLAG[a.kind]}`}>{AFFIL_LABEL[a.kind]}</span>
                {!a.current && <div className="flag f-mute" style={{ marginTop: 4 }}>former</div>}
              </td>
              <td>{a.role}</td>
              <td><Dates a={a} /></td>
              <td className="muted">
                {a.note ?? AFFIL_MEANS[a.kind]}
                <span className={`cert ${CERT_CLASS[a.certainty] ?? 'c-known'}`} style={{ marginLeft: 6 }}>
                  {a.certainty}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cover">
        <b>{personName} can act for more than one organisation, and the table says which hat.</b>{' '}
        An ask lands on a person; the mandate, the cheque and the restriction land on an
        institution. Collapsing the two is how an approach gets made in the wrong capacity.
      </p>
    </div>
  );
}
