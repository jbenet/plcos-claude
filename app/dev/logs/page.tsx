import { Page } from '@/components/shell/Page';
import { ago, shortDate } from '@/lib/time';
import { auditLog } from '@/modules/platform';

export const dynamic = 'force-dynamic';

export default async function Logs() {
  const rows = await auditLog(300);
  const byAction = new Map<string, number>();
  for (const r of rows) byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
  const actions = [...byAction.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Page
      crumbs={[{ label: 'Developer' }, { label: 'Logs' }]}
      inspector={
        <>
          <div className="lbl">Append-only</div>
          <div className="ihead">What happened, in order</div>
          <div className="imeta">{rows.length} entries · newest first</div>
          {actions.slice(0, 12).map(([action, n]) => (
            <div className="kv" key={action}>
              <span className="mono" style={{ fontSize: 11.5 }}>{action}</span>
              <span>{n}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Not event sourcing</div>
            <p>
              An append-only record of what happened, written in the same transaction as the
              change it describes — alongside tables that hold what is true, not instead of them.
              An audit row written after the fact is a lie waiting to happen.
            </p>
          </div>
          <div className="note">
            Nothing here is editable and nothing is deleted. That is the only property that makes
            it worth reading.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Logs</h1>
      <p className="sublede">
        The audit log. Every approval, every guard refusal, every rung recorded, every send
        proposed — with who did it and what it carried.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Audit log</h2>
          <span className="lbl">{rows.length} most recent</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 96 }}>When</th>
              <th style={{ width: 190 }}>Action</th>
              <th style={{ width: 120 }}>Actor</th>
              <th style={{ width: 130 }}>Subject</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="muted nowrap" style={{ fontSize: 11.5 }}>
                  {ago(r.at)}
                  <div className="mono" style={{ fontSize: 10 }}>{shortDate(r.at)}</div>
                </td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  <b>{r.action}</b>
                </td>
                <td className="muted">{r.actor ?? 'system'}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{r.subjectType}</td>
                <td className="muted mono" style={{ fontSize: 10.5, wordBreak: 'break-word' }}>
                  {Object.keys(r.detail).length ? JSON.stringify(r.detail) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
