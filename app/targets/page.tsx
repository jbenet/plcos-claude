import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { listPursuits, RUNGS, RUNG_LABEL, rungIndex } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

export default async function Targets() {
  const selection = await vehicleSelection();
  const pursuits = await listPursuits(selection.current?.id ?? null);

  const atRung = (i: number) => pursuits.filter((p) => rungIndex(p.rung) === i).length;

  return (
    <Page
      crumbs={[
        { label: selection.current ? selection.current.name : 'All vehicles' },
        { label: 'Conversion strategy' },
      ]}
      inspector={
        <>
          <div className="lbl">The ladder</div>
          <div className="ihead">Six states, no implicit transitions</div>
          <div className="imeta">Each step up requires a specific evidence record</div>
          {RUNGS.map((r, i) => (
            <div className="kv" key={r}>
              <span>{RUNG_LABEL[r]}</span>
              <span>{atRung(i)}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">The failure it prevents</div>
            <p>
              A connector replying &ldquo;happy to ask&rdquo; becomes, three hops of summarising
              later, &ldquo;the target is interested&rdquo;. The first rung is a statement about
              the connector and nothing else.
            </p>
          </div>
          <div className="note">
            The rung is derived from the evidence records, not stored. There is no column anyone
            can set to &ldquo;interested&rdquo;.
          </div>
        </>
      }
    >
      <div className="lbl">Module 04 · Discover &amp; qualify</div>
      <h1>Conversion strategy</h1>
      <p className="sublede">
        One workspace per target per vehicle. The ladder below each name is what the evidence
        supports — not what anyone hopes, and not what a summary said.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Pursuits</h2>
          <span className="lbl">
            {pursuits.length} open · {selection.current ? selection.current.name : 'all vehicles'}
          </span>
        </div>
        {pursuits.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nothing open
              </span>
              <h3>No pursuit is open for this vehicle.</h3>
              <p>A pursuit opens when someone decides to work a target. Nothing has been decided here.</p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Target</th>
                <th style={{ width: 140 }}>Vehicle</th>
                <th style={{ width: 100 }}>Owner</th>
                <th style={{ width: 300 }}>Ladder</th>
                <th style={{ width: 100 }}>Opened</th>
              </tr>
            </thead>
            <tbody>
              {pursuits.map((p) => (
                <tr key={p.pursuitId} className="clickable">
                  <td>
                    <Link href={`/targets/${p.pursuitId}`}>
                      <b>{p.entityName}</b>
                    </Link>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {p.headline}
                    </div>
                  </td>
                  <td className="muted">{p.vehicleName}</td>
                  <td className="muted">{p.ownerName}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      {RUNGS.map((r, i) => {
                        const ev = p.events.find((e) => e.rung === r);
                        const na = ev?.evidenceKind === 'not_applicable';
                        return (
                          <span
                            key={r}
                            title={RUNG_LABEL[r]}
                            style={{
                              width: 26, height: 6, borderRadius: 3,
                              background: ev ? (na ? 'var(--line)' : 'var(--green)') : '#EDEAE2',
                              outline: i === rungIndex(p.rung) + 1 ? '1.5px solid var(--clay)' : undefined,
                              outlineOffset: 1,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
                      {p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file'}
                    </div>
                  </td>
                  <td className="muted nowrap">{shortDate(p.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>What this covers:</b> pursuits recorded in this system. A target that somebody is
          working without opening a pursuit does not appear here, which is a gap in the record
          rather than an absence of activity.
        </p>
      </div>
    </Page>
  );
}
