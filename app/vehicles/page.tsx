import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { usdM, multiple } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { INSTRUMENT_LABEL, listExposures, vehicleTotals } from '@/modules/pipeline';
import { STATUSES, STATUS_LABEL, impliedRung, listPursuits, RUNG_LABEL, rungIndex } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { fund: 'Fund', spv: 'SPV', grant_rail: 'Grants rail' };

export default async function Vehicles() {
  const selection = await vehicleSelection();
  const [totals, exposures, pursuits] = await Promise.all([
    vehicleTotals(), listExposures(), listPursuits(),
  ]);
  // Two thousand rows help nobody: the ones furthest along — by status, then by evidence, then
  // by what the source's word says happened.
  const statusRank = (p: (typeof pursuits)[number]) => STATUSES.findIndex((s) => s.id === p.status);
  const open = pursuits.filter((p) => !p.closedAt);
  const openCount = open.length;
  const furthest = [...open]
    .sort((a, b) =>
      statusRank(b) - statusRank(a) || rungIndex(b.rung) - rungIndex(a.rung) ||
      rungIndex(impliedRung(b.implied)) - rungIndex(impliedRung(a.implied)) || a.entityName.localeCompare(b.entityName))
    .slice(0, 25);

  return (
    <Page
      crumbs={moduleCrumbs('vehicles', selection.current?.name ?? null)}
      inspector={
        <>
          <div className="lbl">Why there is no total</div>
          <div className="ihead">Four raises, four numbers</div>
          <div className="imeta">Neurotech, Rails, the SPVs, the grants rail</div>
          <div className="scope">
            <p>
              No blended AUM figure across these vehicles appears anywhere in this system. Not on
              this page, not in a tooltip, not in an export. They have different targets, different
              instruments, different investors and — in one case — a different exemption.
            </p>
          </div>
          <div className="kv">
            <span>506(c) vehicles</span>
            <span>{totals.filter((t) => t.exemption === '506(c)').length}</span>
          </div>
          <div className="kv">
            <span>506(b) vehicles</span>
            <span>{totals.filter((t) => t.exemption === '506(b)').length}</span>
          </div>
          <div className="note">
            One 506(b) SPV among four 506(c) vehicles is open question 4 — integration risk, and a
            conversation for counsel rather than a data model.
          </div>
        </>
      }
    >
      <div className="lbl">Module 09 · Convert &amp; coordinate</div>
      <h1>Vehicle status</h1>
      <p className="sublede">
        Per vehicle, hard-only headline, soft beside it and never inside it. Coverage is a pipeline
        measure — hard plus soft over target — and is labelled as such rather than read as money.
      </p>

      <div className="card">
        <div className="chead">
          <h2>All vehicles</h2>
          <span className="lbl">{totals.length} · no row sums the others</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th style={{ width: 90 }}>Kind</th>
              <th style={{ width: 80 }}>Exemption</th>
              <th style={{ width: 90 }} className="right">
                Hard
              </th>
              <th style={{ width: 90 }} className="right">
                Soft
              </th>
              <th style={{ width: 90 }} className="right">
                Cash
              </th>
              <th style={{ width: 90 }} className="right">
                Gap
              </th>
              <th style={{ width: 90 }} className="right">
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.vehicleId}>
                <td>
                  <b>{t.vehicleName}</b>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    target {t.target ? usdM(t.target, 0) : 'none set'} ·{' '}
                    {(() => {
                      const mine = pursuits.filter((p) => p.vehicleId === t.vehicleId);
                      // A historical vehicle's pursuits are history, not work in progress.
                      return t.historical
                        ? `history · ${mine.length} pursuits`
                        : `${mine.filter((p) => !p.closedAt).length} pursuits open`;
                    })()}
                  </div>
                </td>
                <td className="muted">{KIND_LABEL[t.kind]}</td>
                <td className="mono muted">{t.exemption}</td>
                <td className="right mono" style={{ color: 'var(--green)' }}>
                  {usdM(t.hard)}
                </td>
                <td className="right mono muted">{usdM(t.soft)}</td>
                <td className="right mono muted">{usdM(t.cash)}</td>
                <td className="right mono">{t.gapToTarget === null ? '—' : usdM(t.gapToTarget)}</td>
                <td className="right mono muted">{t.coverage === null ? '—' : multiple(t.coverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>There is no total row.</b> Adding these together would produce a number that is not
          true of anything — four raises chasing an overlapping investor universe, one of them on a
          different exemption, one of them a grants rail with no dollar target at all.
        </p>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Where the pursuits stand</h2>
            <span className="lbl">furthest along, by status</span>
          </div>
          {furthest.map((p) => (
            <Link className="row" key={p.pursuitId} href={`/targets/${p.pursuitId}`}>
              <div className="t">
                <b>{p.entityName}</b>
                <span>
                  {p.vehicleName} · owner {p.ownerSaid ?? p.ownerName}
                </span>
              </div>
              <div className="state">
                <b>{STATUS_LABEL[p.status]}</b>
                {p.rung ? `${RUNG_LABEL[p.rung]} on the ladder` : 'nothing on the ladder'}
                {p.stageSaid && p.source !== 'us' ? <> · Affinity: {p.stageSaid}</> : <> · opened {shortDate(p.openedAt)}</>}
              </div>
            </Link>
          ))}
          {openCount > furthest.length && (
            <p className="cover">
              The {furthest.length} furthest along of {openCount.toLocaleString('en-US')} open pursuits,
              by status. The ladder is what is evidenced; the status is our plan, and the word beside
              it is what the source says. The gap between them is work to do.
            </p>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <h2>Largest positions</h2>
            <span className="lbl">hard track only</span>
          </div>
          {exposures
            .filter((x) => x.track === 'hard')
            .slice(0, 8)
            .map((x) => (
              <div className="row" key={x.exposureId}>
                <div className="t">
                  <b>{x.entityName}</b>
                  <span>
                    {x.vehicleName} · {INSTRUMENT_LABEL[x.instrument]} · {x.evidenceRef}
                  </span>
                </div>
                <div className="state">
                  <b>{usdM(x.amount)}</b>
                  {x.cashReceivedAt ? `wired ${shortDate(x.cashReceivedAt)}` : 'not yet wired'}
                </div>
              </div>
            ))}
        </div>
      </div>
    </Page>
  );
}
