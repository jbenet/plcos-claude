import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { HardenForm } from '@/components/pipeline/HardenForm';
import { vehicleSelection } from '@/lib/session';
import { usdM, pct } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { INSTRUMENT_LABEL, listExposures, vehicleTotals } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

export default async function SoftHard() {
  const selection = await vehicleSelection();
  const [totals, exposures] = await Promise.all([
    vehicleTotals(),
    listExposures(selection.current?.id ?? null),
  ]);
  // With no vehicle selected there is no headline, because a headline across four raises
  // would be a blended figure and this system does not produce one.
  const focus = selection.current
    ? totals.find((t) => t.vehicleId === selection.current!.id) ?? null
    : null;
  const withMoney = totals.filter((t) => t.hard > 0 || t.soft > 0);
  const soft = exposures.filter((x) => x.track === 'soft');
  const hard = exposures.filter((x) => x.track === 'hard');

  return (
    <Page
      crumbs={[
        { label: selection.current ? selection.current.name : 'All vehicles' },
        { label: 'Soft → Hard' },
      ]}
      inspector={
        <>
          <div className="lbl">The rule</div>
          <div className="ihead">Soft and hard never blend</div>
          <div className="imeta">Not in a view, not in a KPI, not for convenience</div>
          <div className="scope">
            <div className="lbl">What hard means</div>
            <p>
              Signed and countersigned, with the document referenced on the row. A hard row with
              no evidence reference cannot be written — the database refuses it.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">What convertible soft means</div>
            <p>
              Σ soft × P(commit). It is an estimate about a population, it is shown so nobody has
              to compute it in their head, and it is never added to hard anywhere.
            </p>
          </div>
          <div className="note">
            Moving a row from soft to hard takes an approved <code>MONEY</code> ticket. There is no
            other path — not an edit, not an import, not a script.
          </div>
        </>
      }
    >
      <div className="lbl">Module 08 · Convert &amp; coordinate</div>
      <h1>Soft → Hard</h1>
      <p className="sublede">
        Two tracks that never meet. The headline is hard-only; the soft track is labelled, kept
        beside it, and carries a convertible estimate that is shown and never summed in.
      </p>

      {focus ? (
        <div className="kpis">
          <div className="kpi">
            <span className="tag t-hard">Hard</span>
            <div className="n g">{usdM(focus.hard)}</div>
            <div className="f">
              {focus.hardCount} signed and countersigned. The only number that appears in a headline.
            </div>
          </div>
          <div className="kpi soft">
            <span className="tag t-soft">Soft</span>
            <div className="n">{usdM(focus.soft)}</div>
            <div className="f">
              {focus.softCount} indications. <b>Never added to hard.</b> Convertible estimate{' '}
              {usdM(focus.convertibleSoft, 2)}.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Cash received</div>
            <div className="n">{usdM(focus.cash)}</div>
            <div className="f">
              A separate state from an accepted commitment. {usdM(focus.hard - focus.cash)} accepted
              and not yet wired.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Gap to target</div>
            <div className="n">{focus.gapToTarget === null ? '—' : usdM(focus.gapToTarget)}</div>
            <div className="f">
              Hard-only basis, against a {focus.target ? usdM(focus.target, 0) : '—'} target.
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="chead">
            <h2>Every vehicle, side by side</h2>
            <span className="lbl">no headline here — pick a vehicle in the rail for one</span>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th style={{ width: 110 }} className="right">Hard</th>
                <th style={{ width: 110 }} className="right">Soft</th>
                <th style={{ width: 130 }} className="right">Convertible soft</th>
                <th style={{ width: 110 }} className="right">Cash</th>
              </tr>
            </thead>
            <tbody>
              {withMoney.map((t) => (
                <tr key={t.vehicleId}>
                  <td><b>{t.vehicleName}</b></td>
                  <td className="right mono" style={{ color: 'var(--green)' }}>{usdM(t.hard)}</td>
                  <td className="right mono muted">{usdM(t.soft)}</td>
                  <td className="right mono muted">{usdM(t.convertibleSoft, 2)}</td>
                  <td className="right mono muted">{usdM(t.cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            <b>There is no total row and no headline on this view.</b> Adding these columns down
            would produce a blended figure across four raises chasing an overlapping investor
            universe — the one number CLAUDE.md says must never appear. Select a vehicle in the
            rail to see a headline that means something.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>The soft track</h2>
          <span className="lbl">must convert · each with its own probability</span>
        </div>
        {soft.length === 0 ? (
          <div className="cbody">
            <p className="muted">Nothing on the soft track for this vehicle.</p>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Actor</th>
                <th style={{ width: 130 }}>Vehicle</th>
                <th style={{ width: 120 }}>Instrument</th>
                <th style={{ width: 90 }} className="right">
                  Amount
                </th>
                <th style={{ width: 80 }} className="right">
                  P(commit)
                </th>
                <th style={{ width: 100 }} className="right">
                  Convertible
                </th>
                <th style={{ width: 230 }}>Hardening</th>
              </tr>
            </thead>
            <tbody>
              {soft.map((x) => (
                <tr key={x.exposureId}>
                  <td>
                    <Link href={`/orgs/${x.entityId}`}>
                      <b>{x.entityName}</b>
                    </Link>
                  </td>
                  <td className="muted">{x.vehicleName}</td>
                  <td className="muted">{INSTRUMENT_LABEL[x.instrument]}</td>
                  <td className="right mono">{usdM(x.amount)}</td>
                  <td className="right mono muted">{x.probability === null ? '—' : pct(x.probability)}</td>
                  <td className="right mono muted">
                    {x.probability === null ? '—' : usdM(x.amount * x.probability, 2)}
                  </td>
                  <td>
                    <HardenForm exposureId={x.exposureId} entityName={x.entityName} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>What convertible soft is:</b> Σ soft × P(commit), computed per vehicle.{' '}
          {focus
            ? `For ${focus.vehicleName} that is ${usdM(focus.convertibleSoft, 2)}.`
            : 'No figure is given here because these rows span four vehicles, and summing across them would be the blended number this system does not produce.'}{' '}
          <b>It is not money, and it is not added to the hard total anywhere.</b>
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The hard track</h2>
          <span className="lbl">every row names the document that makes it hard</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Actor</th>
              <th style={{ width: 130 }}>Vehicle</th>
              <th style={{ width: 90 }} className="right">
                Amount
              </th>
              <th style={{ width: 170 }}>Evidence</th>
              <th style={{ width: 110 }}>Countersigned</th>
              <th style={{ width: 130 }}>Cash</th>
            </tr>
          </thead>
          <tbody>
            {hard.map((x) => (
              <tr key={x.exposureId}>
                <td>
                  <b>{x.entityName}</b>
                </td>
                <td className="muted">{x.vehicleName}</td>
                <td className="right mono">{usdM(x.amount)}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {x.evidenceRef}
                </td>
                <td className="muted nowrap">{x.hardenedAt ? shortDate(x.hardenedAt) : '—'}</td>
                <td>
                  {x.cashReceivedAt ? (
                    <span className="flag f-ok">received {shortDate(x.cashReceivedAt)}</span>
                  ) : (
                    <span className="flag f-ev">not yet wired</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Conversion rate by cohort is not shown</b> because there is no history to compute it
          from — this system has been keeping records for less than a day. A rate computed over
          four rows would be a decoration.
        </p>
      </div>
    </Page>
  );
}
