import { Page } from '@/components/shell/Page';
import { usdM, multiple } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { poolChecks, vehicleTotals } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

export default async function Forecast() {
  const [totals, pools] = await Promise.all([vehicleTotals(), poolChecks()]);
  const over = pools.filter((p) => p.status === 'over');
  const unverified = pools.filter((p) => p.status === 'unverified');
  const noBudget = pools.filter((p) => p.status === 'no_budget');
  const neurotech = totals.find((t) => t.vehicleSlug === 'neurotech');

  return (
    <Page
      crumbs={[{ label: 'Execute & govern' }, { label: 'Forecast' }]}
      inspector={
        <>
          <div className="lbl">Conserved capital pool</div>
          <div className="ihead">One budget per actor</div>
          <div className="imeta">Across every vehicle they appear in</div>
          <div className="kv">
            <span>Actors with exposure</span>
            <span>{pools.length}</span>
          </div>
          <div className="kv">
            <span>Budget verified</span>
            <span>{pools.filter((p) => p.budgetVerified).length}</span>
          </div>
          <div className="kv">
            <span>Over budget</span>
            <span style={{ color: over.length ? 'var(--clay)' : undefined }}>{over.length}</span>
          </div>
          <div className="kv">
            <span>Excluded from the check</span>
            <span>{unverified.length + noBudget.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">Who does the arithmetic</div>
            <p>
              Code does. An agent may propose a budget and where it came from; the sum, the
              comparison and the overage are computed deterministically and can be re-derived from
              the rows below.
            </p>
          </div>
          <div className="note">
            An unverified budget is excluded rather than guessed at. Excluding it is visible on the
            row — it is not quietly treated as infinite.
          </div>
        </>
      }
    >
      <div className="lbl">Module 21 · Execute &amp; govern</div>
      <h1>Forecast</h1>
      <p className="sublede">
        Hard-only headline per vehicle, and a deterministic check that the same dollar has not been
        counted in two places. A scenario engine that lets one actor&rsquo;s money appear in two
        vehicles is worse than no scenario engine.
      </p>

      {neurotech && (
        <div className="kpis">
          <div className="kpi">
            <span className="tag t-hard">Hard · Neurotech</span>
            <div className="n g">{usdM(neurotech.hard)}</div>
            <div className="f">Signed and countersigned. {usdM(neurotech.cash)} of it has wired.</div>
          </div>
          <div className="kpi">
            <div className="lbl">Gap to first close</div>
            <div className="n">{neurotech.gapToTarget === null ? '—' : usdM(neurotech.gapToTarget)}</div>
            <div className="f">
              Hard-only basis, against {neurotech.target ? usdM(neurotech.target, 0) : '—'}.
            </div>
          </div>
          <div className="kpi soft">
            <span className="tag t-soft">Soft · not counted</span>
            <div className="n">{usdM(neurotech.soft)}</div>
            <div className="f">
              Convertible estimate {usdM(neurotech.convertibleSoft, 2)}. Neither figure reduces the
              gap above.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Pool violations</div>
            <div className="n" style={{ color: over.length ? 'var(--clay)' : 'var(--ink)' }}>
              {over.length}
            </div>
            <div className="f">
              {over.length === 0
                ? 'No actor is committed beyond a verified budget.'
                : `${usdM(over.reduce((a, p) => a + p.over, 0))} counted in more than one place.`}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Per vehicle, hard only</h2>
          <span className="lbl">no total, on purpose</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th style={{ width: 100 }} className="right">
                Target
              </th>
              <th style={{ width: 100 }} className="right">
                Hard
              </th>
              <th style={{ width: 100 }} className="right">
                Gap
              </th>
              <th style={{ width: 110 }} className="right">
                Coverage
              </th>
              <th style={{ width: 170 }}>Soft, kept separate</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.vehicleId}>
                <td>
                  <b>{t.vehicleName}</b>
                </td>
                <td className="right mono muted">{t.target ? usdM(t.target, 0) : '—'}</td>
                <td className="right mono" style={{ color: 'var(--green)' }}>
                  {usdM(t.hard)}
                </td>
                <td className="right mono">{t.gapToTarget === null ? '—' : usdM(t.gapToTarget)}</td>
                <td className="right mono muted">{t.coverage === null ? '—' : multiple(t.coverage)}</td>
                <td className="muted">
                  {usdM(t.soft)} soft · {usdM(t.convertibleSoft, 2)} convertible
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          Coverage is (hard + soft) ÷ target — a measure of pipeline depth, not of money.{' '}
          <b>
            It is the only place on this page where the two tracks appear in one expression, and it
            is labelled a ratio rather than an amount.
          </b>
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Conserved capital pool</h2>
          <span className="lbl">deterministic check · {pools.length} actors with exposure</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Actor</th>
              <th style={{ width: 110 }} className="right">
                Committed
              </th>
              <th style={{ width: 110 }} className="right">
                Budget
              </th>
              <th style={{ width: 90 }} className="right">
                Over
              </th>
              <th style={{ width: 300 }}>Where it is committed</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={p.entityId}>
                <td>
                  <b>{p.entityName}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {p.budgetSource ?? 'No budget on file'}
                  </div>
                </td>
                <td className="right mono">{usdM(p.total)}</td>
                <td className="right mono muted">
                  {p.budget === null ? '—' : usdM(p.budget)}
                  {p.status === 'unverified' && (
                    <div>
                      <span className="flag f-ev">unverified</span>
                    </div>
                  )}
                </td>
                <td className="right mono" style={{ color: p.over > 0 ? 'var(--clay)' : undefined }}>
                  {p.over > 0 ? usdM(p.over) : '—'}
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {p.committed
                    .map((c) => `${c.vehicleName} ${usdM(c.amount)} ${c.track}`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Excluded from the check:</b> {unverified.length} actor
          {unverified.length === 1 ? '' : 's'} whose budget is unverified
          {unverified.length ? ` (${unverified.map((p) => p.entityName).join(', ')})` : ''}, and{' '}
          {noBudget.length} with no budget on file. Excluding them is not the same as clearing them —
          the check simply has nothing to compare against, and says so rather than assuming the
          budget is large enough.
        </p>
      </div>

      {over.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>What to do about the overage</h2>
            <span className="lbl">arithmetic, not advice</span>
          </div>
          <div className="cbody">
            {over.map((p) => (
              <div key={p.entityId} style={{ marginBottom: 14 }}>
                <b style={{ fontSize: 13.5, fontWeight: 500 }}>
                  {p.entityName} is {usdM(p.over)} over a {usdM(p.budget ?? 0)} budget.
                </b>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, margin: '4px 0 0' }}>
                  {p.committed.map((c) => `${usdM(c.amount)} on ${c.vehicleName} (${c.track})`).join(' and ')}.
                  Either one of those numbers is wrong or the budget is stale. The budget on file
                  says: &ldquo;{p.budgetSource}&rdquo;. The system will not choose which; it keeps
                  showing both until someone does.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
