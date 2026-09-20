import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { usdM, multiple } from '@/lib/money';
import { ago, shortDate } from '@/lib/time';
import { modulesForKind } from '@/lib/nav';
import { KIND_CLASS, listOpenTickets } from '@/modules/governance';
import { listPursuits, RUNGS, RUNG_LABEL, rungIndex } from '@/modules/strategy';
import { listExposures, vehicleTotals } from '@/modules/pipeline';
import { listAsks, listConflicts } from '@/modules/coordination';
import { listCycles, spvRooms } from '@/modules/close';
import { recentAudit } from '@/modules/platform';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const selection = await vehicleSelection();
  const v = selection.current;

  const [totals, pursuits, tickets, asks, conflicts, cycles, rooms, audit, exposures] =
    await Promise.all([
      vehicleTotals(),
      listPursuits(v?.id ?? null),
      listOpenTickets(),
      listAsks(v?.id ?? null),
      listConflicts('open'),
      listCycles(),
      spvRooms(),
      recentAudit(6),
      listExposures(v?.id ?? null),
    ]);

  const totalsHere = v ? totals.find((t) => t.vehicleId === v.id) ?? null : null;
  const ticketsHere = v ? tickets.filter((t) => t.vehicleId === v.id) : tickets;
  const cycle = v ? cycles.find((c) => c.vehicleId === v.id) ?? null : null;
  const room = v ? rooms.find((r) => r.vehicleId === v.id) ?? null : null;
  const atRung = (i: number) => pursuits.filter((p) => rungIndex(p.rung) === i).length;

  return (
    <Page
      crumbs={[{ label: 'PL Capital' }, { label: v ? v.name : 'All vehicles' }]}
      inspector={
        <>
          <div className="lbl">{v ? 'This vehicle' : 'Every vehicle'}</div>
          <div className="ihead">{v ? v.name : 'All vehicles'}</div>
          <div className="imeta">
            {v ? `${v.kind === 'grant_rail' ? 'grants rail' : v.kind} · ${v.exemption}` : `${totals.length} vehicles`}
          </div>
          {v ? (
            <>
              <div className="kv">
                <span>Target</span>
                <span>{v.targetAmount ? usdM(v.targetAmount, 0) : 'none set'}</span>
              </div>
              <div className="kv">
                <span>Pursuits open</span>
                <span>{pursuits.length}</span>
              </div>
              <div className="kv">
                <span>Asks on file</span>
                <span>{asks.length}</span>
              </div>
              <div className="kv">
                <span>Positions</span>
                <span>{exposures.length}</span>
              </div>
              {cycle && (
                <div className="kv">
                  <span>Close target</span>
                  <span>{shortDate(cycle.targetDate)}</span>
                </div>
              )}
              {room && (
                <div className="kv">
                  <span>Days to wire</span>
                  <span>{room.daysToWire ?? 'no wire yet'}</span>
                </div>
              )}
              <div className="scope">
                <div className="lbl">Where to go next</div>
                <p>
                  The submenu in the rail is this vehicle&rsquo;s modules. Everything in it is
                  scoped to {v.name} until you pick a different one.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="scope">
                <div className="lbl">No headline here</div>
                <p>
                  Four raises chase an overlapping investor universe and one is on a different
                  exemption. A number summed across them would not be true of anything, so this
                  view shows them side by side and refuses the total.
                </p>
              </div>
              <div className="note">
                Pick a vehicle in the rail for a headline that means something.
              </div>
            </>
          )}
        </>
      }
    >
      <div className="lbl">PL Capital</div>
      <h1>{v ? v.name : 'All vehicles'}</h1>
      <p className="sublede">
        {v
          ? `Everything below is scoped to ${v.name}. The rail carries its modules.`
          : 'Every vehicle side by side, and every module reading across all of them.'}
      </p>

      {v && (
        <div className="exempt">
          <div className="ex">
            <span className="lbl">Exemption</span>
            <b>{v.exemption}</b>
          </div>
          <p>
            {v.exemption === '506(c)' ? (
              <>
                <b>General solicitation is permitted</b> — this vehicle may be discussed publicly.
                Every investor must be <b>verified</b> as accredited by reasonable steps, and a
                self-certification never counts, whoever signed it. Verification is a gate on
                hardening, not a form to file afterwards.
              </>
            ) : v.exemption === '506(b)' ? (
              <>
                <b>No general solicitation.</b> Nothing public may reference this vehicle, and
                every investor needs a pre-existing substantive relationship recorded{' '}
                <i>before</i> the offering conversation. A reasonable belief in accreditation is
                enough; a public page is not.
              </>
            ) : (
              <>
                Not a securities offering. The grants rail runs on invitations rather than
                subscriptions, and outreach is blocked until a funder invitation is on file.
              </>
            )}
          </p>
          <span className="exrefs">
            <a href="/materials">Send gate</a>
            <a href="/compliance">Compliance registry</a>
          </span>
        </div>
      )}

      {totalsHere ? (
        <div className="kpis">
          <div className="kpi">
            <span className="tag t-hard">Hard</span>
            <div className="n g">{usdM(totalsHere.hard)}</div>
            <div className="f">Signed and countersigned. {usdM(totalsHere.cash)} of it has wired.</div>
          </div>
          <div className="kpi soft">
            <span className="tag t-soft">Soft</span>
            <div className="n">{usdM(totalsHere.soft)}</div>
            <div className="f">
              {totalsHere.softCount} indications. <b>Never added to hard.</b> Convertible{' '}
              {usdM(totalsHere.convertibleSoft, 2)}.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Gap to target</div>
            <div className="n">{totalsHere.gapToTarget === null ? '—' : usdM(totalsHere.gapToTarget)}</div>
            <div className="f">Hard-only basis.</div>
          </div>
          <div className="kpi">
            <div className="lbl">Coverage</div>
            <div className="n">{totalsHere.coverage === null ? '—' : multiple(totalsHere.coverage)}</div>
            <div className="f">Pipeline depth, not money.</div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="chead">
            <h2>Each vehicle, hard only</h2>
            <span className="lbl">no total row, on purpose</span>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th style={{ width: 110 }} className="right">Hard</th>
                <th style={{ width: 110 }} className="right">Soft</th>
                <th style={{ width: 120 }} className="right">Gap</th>
                <th style={{ width: 110 }} className="right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.vehicleId}>
                  <td>
                    <b>{t.vehicleName}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>{t.exemption}</div>
                  </td>
                  <td className="right mono" style={{ color: 'var(--green)' }}>{usdM(t.hard)}</td>
                  <td className="right mono muted">{usdM(t.soft)}</td>
                  <td className="right mono">{t.gapToTarget === null ? '—' : usdM(t.gapToTarget)}</td>
                  <td className="right mono muted">{t.coverage === null ? '—' : multiple(t.coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Where the pursuits stand</h2>
            <span className="lbl">{pursuits.length} open</span>
          </div>
          <div className="cbody">
            {RUNGS.map((r, i) => (
              <div className="fact" key={r}>
                <span>{RUNG_LABEL[r]}</span>
                <span>{atRung(i)}</span>
              </div>
            ))}
          </div>
          {pursuits.length > 0 && (
            <p className="cover">
              <Link href="/targets">Open the workspaces</Link> — {pursuits.filter((p) => p.rung === 'connector_willing').length}{' '}
              are at rung one, which is a statement about a connector and nothing else.
            </p>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <h2>Waiting on a decision</h2>
            <span className="lbl">{ticketsHere.length} open</span>
          </div>
          {ticketsHere.length === 0 ? (
            <div className="cbody">
              <p className="muted">Nothing is waiting. That is an empty table, not a failed read.</p>
            </div>
          ) : (
            ticketsHere.map((t) => (
              <Link className="row" key={t.id} href={`/approvals?t=${t.id}`}>
                <span className={`kind ${KIND_CLASS[t.kind]}`} style={{ width: 138 }}>{t.kind}</span>
                <div className="t">
                  <b>{t.subjectLabel}</b>
                  <span>requested by {t.requestedByName}</span>
                </div>
                <div className="state">{ago(t.createdAt)}</div>
              </Link>
            ))
          )}
          {conflicts.length > 0 && (
            <p className="cover">
              {conflicts.length} open conflict{conflicts.length === 1 ? '' : 's'} across vehicles.
              One proceeds; the other gets a dated follow-up.
            </p>
          )}
        </div>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Modules for this vehicle</h2>
            <span className="lbl">also in the rail</span>
          </div>
          {modulesForKind(v?.kind ?? 'fund').map((mod) => (
            <Link className="row" key={mod.slug} href={mod.href}>
              <span className="kind k-chore" style={{ width: 34 }}>{mod.num}</span>
              <div className="t">
                <b>{mod.title}</b>
                <span>{mod.mechanic}</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="card">
          <div className="chead">
            <h2>What happened</h2>
            <span className="lbl">audit log · append-only</span>
          </div>
          <table className="list">
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td className="nowrap muted mono" style={{ fontSize: 10.5, width: 70 }}>
                    {ago(new Date(a.at))}
                  </td>
                  <td>
                    <b>{a.action}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {a.name ?? 'system'} · {a.subject_type}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
