import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { usdM } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { bandwidthAlerts, spvRooms, SPV_STAGES, SPV_STAGE_LABEL } from '@/modules/close';

export const dynamic = 'force-dynamic';

const STAGE_FLAG: Record<string, string> = {
  invited: 'f-mute', ioi: 'f-ev', allocated: 'f-ev', wired: 'f-ok', passed: 'f-mute',
};

export default async function SpvWarRoom() {
  const [rooms, alerts] = await Promise.all([spvRooms(), bandwidthAlerts()]);
  const wiredDays = rooms.map((r) => r.daysToWire).filter((d): d is number => d !== null);
  const headline = wiredDays.length ? Math.round(wiredDays.reduce((a, b) => a + b, 0) / wiredDays.length) : null;
  const openSeats = rooms.flatMap((r) => r.seats).filter((s) => s.stage !== 'wired' && s.stage !== 'passed');

  return (
    <Page
      crumbs={[{ label: 'Execute & govern' }, { label: 'SPV war room' }]}
      inspector={
        <>
          <div className="lbl">Bandwidth</div>
          <div className="ihead">What the SPVs are taking</div>
          <div className="imeta">An SPV clock is shorter, so it wins by default</div>
          {alerts.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              Nobody is split between an SPV clock and the fund close.
            </p>
          ) : (
            alerts.map((a, i) => (
              <div className="prov" key={i}>
                <div className="p1">
                  <b style={{ fontWeight: 500 }}>{a.name}</b>{' '}
                  <span className="flag f-mute" style={{ marginLeft: 4 }}>
                    {a.kind}
                  </span>
                </div>
                <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
                  {a.detail}
                </div>
              </div>
            ))
          )}
          <div className="scope">
            <div className="lbl">Why this is not a block</div>
            <p>
              Naming the steal is most of the fix. The system will not stop anyone working an SPV
              during a fund close — it will just refuse to let that happen without anyone noticing.
            </p>
          </div>
          <div className="note">
            Days-to-wire is a median over seats that actually wired. Two data points is not a
            benchmark, and the number is shown with its denominator for that reason.
          </div>
        </>
      }
    >
      <div className="lbl">Module 19 · Execute &amp; govern</div>
      <h1>SPV war room</h1>
      <p className="sublede">
        invite → IOI → allocate → wire, on a days-scale clock. This is deliberately not the fund
        close room: an SPV has no committee, no subscription pack and no long calendar, and giving
        it the fund&rsquo;s interface would have been a real mistake.
      </p>

      <div className="kpis">
        <div className="kpi">
          <div className="lbl">Days to wire</div>
          <div className="n">{headline ?? '—'}</div>
          <div className="f">
            Median across {wiredDays.length} wired seat{wiredDays.length === 1 ? '' : 's'}. Two data
            points is not a benchmark.
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Open seats</div>
          <div className="n">{openSeats.length}</div>
          <div className="f">
            Invited, IOI or allocated. Oldest has been open{' '}
            {Math.max(0, ...openSeats.map((s) => s.days))} days.
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Seats wired</div>
          <div className="n">
            {rooms.flatMap((r) => r.seats).filter((s) => s.wired).length} of{' '}
            {rooms.flatMap((r) => r.seats).length}
          </div>
          <div className="f">
            A count, not an amount. Wired dollars are shown per SPV below — there is no
            cross-vehicle total here either.
          </div>
        </div>
        <div className="kpi">
          <span className={alerts.length ? 'tag t-clay' : 'tag t-plain'}>Bandwidth alerts</span>
          <div className="n">{alerts.length}</div>
          <div className="f">People and investors serving an SPV clock and the fund close at once.</div>
        </div>
      </div>

      {rooms.map((room) => (
        <div className="card" key={room.vehicleId}>
          <div className="chead">
            <h2>{room.vehicleName}</h2>
            <span className="lbl">
              {room.target ? `${usdM(room.target, 0)} target` : 'no target'} ·{' '}
              {usdM(room.allocated)} allocated · {usdM(room.wired)} wired ·{' '}
              {room.daysToWire === null ? 'no wire yet' : `${room.daysToWire} days to wire`}
            </span>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>Seat</th>
                <th style={{ width: 300 }}>invite → IOI → allocate → wire</th>
                <th style={{ width: 90 }} className="right">
                  Amount
                </th>
                <th style={{ width: 90 }} className="right">
                  Days
                </th>
                <th style={{ width: 100 }}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {room.seats.map((s) => (
                <tr key={s.seatId}>
                  <td>
                    <Link href={`/orgs/${s.entityId}`}>
                      <b>{s.entityName}</b>
                    </Link>
                    <div style={{ marginTop: 4 }}>
                      <span className={`flag ${STAGE_FLAG[s.stage]}`}>{SPV_STAGE_LABEL[s.stage]}</span>
                    </div>
                    {s.note && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {s.note}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {SPV_STAGES.map((stage) => {
                        const at =
                          stage === 'invited' ? s.invitedAt
                          : stage === 'ioi' ? s.ioiAt
                          : stage === 'allocated' ? s.allocatedAt
                          : s.wiredAt;
                        return (
                          <span
                            key={stage}
                            title={SPV_STAGE_LABEL[stage]}
                            style={{
                              flex: 1, height: 6, borderRadius: 3,
                              background: at ? 'var(--green)' : s.stage === 'passed' ? '#EDEAE2' : '#EDEAE2',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="muted mono" style={{ fontSize: 10.5, marginTop: 5 }}>
                      {shortDate(s.invitedAt)}
                      {s.ioiAt ? ` → ${shortDate(s.ioiAt)}` : ''}
                      {s.allocatedAt ? ` → ${shortDate(s.allocatedAt)}` : ''}
                      {s.wiredAt ? ` → ${shortDate(s.wiredAt)}` : ''}
                    </div>
                  </td>
                  <td className="right mono">{s.amount === null ? '—' : usdM(s.amount)}</td>
                  <td className="right mono" style={{ color: !s.wired && s.days > 30 ? 'var(--clay)' : undefined }}>
                    {s.days}
                    <div className="muted" style={{ fontSize: 10 }}>
                      {s.wired ? 'to wire' : s.stage === 'passed' ? 'closed' : 'open'}
                    </div>
                  </td>
                  <td className="muted">{s.ownerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {alerts.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Bandwidth steal</h2>
            <span className="lbl">named, not blocked</span>
          </div>
          {alerts.map((a, i) => (
            <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
              <span className="kind k-stage" style={{ width: 80 }}>
                {a.kind}
              </span>
              <div className="t">
                <b>{a.name}</b>
                <span>{a.detail}</span>
              </div>
            </div>
          ))}
          <p className="cover">
            An SPV closes in weeks and a fund closes in months, so the SPV always feels more urgent.
            That is usually correct and occasionally catastrophic. The system says who is split; it
            does not decide for them.
          </p>
        </div>
      )}
    </Page>
  );
}
