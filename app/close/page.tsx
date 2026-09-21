import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { usdM } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { conditionsFor, listCycles, packFor, PACK_LABEL } from '@/modules/close';
import { vehicleTotals } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

const STATUS_FLAG: Record<string, string> = {
  open: 'f-mute', satisfied: 'f-ok', waived: 'f-mute', failed: 'f-block',
};
const PACK_FLAG: Record<string, string> = {
  not_sent: 'f-mute', sent: 'f-ev', returned: 'f-ev', countersigned: 'f-ok',
};

export default async function CloseRoom() {
  const selection = await vehicleSelection();
  const cycles = await listCycles();
  const cycle = cycles[0];
  if (!cycle) {
    return (
      <Page crumbs={moduleCrumbs('close', selection.current?.name ?? null)}>
        <h1>No close cycle is open.</h1>
        <p className="sublede">A close room exists once someone opens a cycle with a target date.</p>
      </Page>
    );
  }

  const [conditions, pack, totals] = await Promise.all([
    conditionsFor(cycle.cycleId), packFor(cycle.cycleId), vehicleTotals(),
  ]);
  const money = totals.find((t) => t.vehicleId === cycle.vehicleId);
  const open = conditions.filter((c) => c.status === 'open');
  const overdue = conditions.filter((c) => c.overdue);
  const compliance = conditions.filter((c) => c.compliance && c.status === 'open');
  const signed = pack.filter((p) => p.status === 'countersigned');

  return (
    <Page
      crumbs={moduleCrumbs('close', selection.current?.name ?? null)}
      inspector={
        <>
          <div className="lbl">Committee clock</div>
          <div className="ihead">{cycle.label}</div>
          <div className="imeta">
            {cycle.vehicleName} · {cycle.exemption} · target {shortDate(cycle.targetDate)}
          </div>
          <div className="kv">
            <span>Working days left</span>
            <span style={{ color: (cycle.workingDaysLeft ?? 0) < 40 ? 'var(--clay)' : undefined }}>
              {cycle.workingDaysLeft}
            </span>
          </div>
          <div className="kv">
            <span>Conditions open</span>
            <span>
              {open.length} of {conditions.length}
            </span>
          </div>
          <div className="kv">
            <span>Overdue</span>
            <span style={{ color: overdue.length ? 'var(--clay)' : undefined }}>{overdue.length}</span>
          </div>
          <div className="kv">
            <span>Packs countersigned</span>
            <span>
              {signed.length} of {pack.length}
            </span>
          </div>
          <div className="scope">
            <div className="lbl">The working-day count</div>
            <p>
              Calendar days minus weekends minus everything the sprint calendar marks as
              suppressed. Thanksgiving and the December dead zone are already subtracted — this is
              days someone can actually work, not days on a wall.
            </p>
          </div>
          <div className="note">
            Countersigned is not cash.{' '}
            {money ? `${usdM(money.hard - money.cash)} is accepted and not yet wired.` : ''}
          </div>
        </>
      }
    >
      <div className="lbl">Module 18 · Execute &amp; govern</div>
      <h1>
        {cycle.label} — {cycle.vehicleName}
      </h1>
      <p className="sublede">
        A fund close runs on a long clock with a committee, a pack and a list of conditions that
        must be true before anything signs. Nothing here is a task list: every condition has an
        owner, a date and a piece of evidence.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className="tag t-hard">Hard</span>
          <div className="n g">{money ? usdM(money.hard) : '—'}</div>
          <div className="f">
            Against a {cycle.targetAmount ? usdM(cycle.targetAmount, 0) : '—'} target.{' '}
            {money && money.gapToTarget !== null ? `${usdM(money.gapToTarget)} to go.` : ''}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Working days left</div>
          <div className="n">{cycle.workingDaysLeft}</div>
          <div className="f">
            To {shortDate(cycle.targetDate)}, with the holiday overlay already subtracted.
          </div>
        </div>
        <div className="kpi">
          <span className={overdue.length ? 'tag t-clay' : 'tag t-plain'}>Conditions</span>
          <div className="n">{open.length}</div>
          <div className="f">
            open{overdue.length ? `, ${overdue.length} past their date` : ''}. {compliance.length} are
            compliance obligations.
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Subscription pack</div>
          <div className="n">
            {signed.length} / {pack.length}
          </div>
          <div className="f">Countersigned. Which is still not the same as wired.</div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Conditions</h2>
          <span className="lbl">each with an owner, a date and evidence</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Condition</th>
              <th style={{ width: 120 }}>Owner</th>
              <th style={{ width: 110 }}>Due</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 160 }}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((c) => (
              <tr key={c.conditionId}>
                <td>
                  <b>{c.label}</b>
                  {c.compliance && (
                    <span className="flag f-ev" style={{ marginLeft: 8 }}>
                      compliance
                    </span>
                  )}
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    {c.detail}
                    {c.entityName ? ` · ${c.entityName}` : ''}
                  </div>
                </td>
                <td className="muted">{c.ownerName ?? '—'}</td>
                <td className="mono" style={{ color: c.overdue ? 'var(--clay)' : 'var(--muted)' }}>
                  {c.dueOn ? shortDate(c.dueOn) : '—'}
                  {c.overdue && <div style={{ fontSize: 10.5 }}>overdue</div>}
                </td>
                <td>
                  <span className={`flag ${STATUS_FLAG[c.status]}`}>{c.status}</span>
                </td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {c.evidenceRef ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>What this covers:</b> conditions someone has written down. A close is also blocked by
          everything nobody recorded, and this list cannot see those.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Subscription pack</h2>
          <span className="lbl">sent → returned → countersigned → wired</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Investor</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 100 }}>Sent</th>
              <th style={{ width: 100 }}>Returned</th>
              <th style={{ width: 120 }}>Countersigned</th>
              <th style={{ width: 250 }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {pack.map((p) => (
              <tr key={p.itemId}>
                <td>
                  <Link href={`/orgs/${p.entityId}`}>
                    <b>{p.entityName}</b>
                  </Link>
                </td>
                <td>
                  <span className={`flag ${PACK_FLAG[p.status]}`}>{PACK_LABEL[p.status]}</span>
                </td>
                <td className="muted nowrap">{p.sentAt ? shortDate(p.sentAt) : '—'}</td>
                <td className="muted nowrap">{p.returnedAt ? shortDate(p.returnedAt) : '—'}</td>
                <td className="muted nowrap">{p.countersignedAt ? shortDate(p.countersignedAt) : '—'}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {p.note ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
