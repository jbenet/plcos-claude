import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { SendGate } from '@/components/content/SendGate';
import { shortDate } from '@/lib/time';
import { listEntities } from '@/modules/identity';
import { listVehicles } from '@/modules/platform';
import {
  AUDIENCE_LABEL, listAssets, listSends, listWrapRules, USE_LABEL, wrongWrapSends,
} from '@/modules/content';

export const dynamic = 'force-dynamic';

const INSTRUMENTS = ['lp_commitment', 'spv', 'grant', 'pri', 'mri', 'direct'];

const SEND_FLAG: Record<string, string> = {
  proposed: 'f-ev', approved: 'f-ev', sent: 'f-ok', refused: 'f-block',
};

export default async function Materials() {
  const selection = await vehicleSelection();
  const [assets, rules, sends, entities, vehicles, wrongWrap] = await Promise.all([
    listAssets(), listWrapRules(), listSends(), listEntities(), listVehicles(), wrongWrapSends(),
  ]);
  const sendable = assets.filter((a) => a.parentId !== null);
  const refused = sends.filter((s) => s.status === 'refused');

  return (
    <Page
      crumbs={moduleCrumbs('materials', selection.current?.name ?? null)}
      inspector={
        <>
          <div className="lbl">Hard KPI</div>
          <div className="ihead">Wrong-wrap sends</div>
          <div className="imeta">Sent despite a refusal. Target: zero, always.</div>
          <div
            className="n"
            style={{
              fontFamily: 'var(--display)', fontSize: 42, fontWeight: 600,
              color: wrongWrap === 0 ? 'var(--green)' : 'var(--clay)', margin: '8px 0 4px',
            }}
          >
            {wrongWrap}
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            {wrongWrap === 0
              ? 'Nothing has gone out under a wrap that forbids it. The number is meaningful because refusals are recorded rather than discarded.'
              : 'Something went out that the matrix refused. This is not a warning; it is an incident.'}
          </p>
          <div className="kv">
            <span>Sends requested</span>
            <span>{sends.length}</span>
          </div>
          <div className="kv">
            <span>Refused by the matrix</span>
            <span>{refused.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">Why refusals are kept</div>
            <p>
              A refusal that is discarded makes the KPI unfalsifiable. Every refused request stays
              on the record with the reason, so the zero can be checked.
            </p>
          </div>
        </>
      }
    >
      <div className="lbl">Module 16 · Create &amp; substantiate</div>
      <h1>Materials &amp; send gate</h1>
      <p className="sublede">
        What may be said depends on the vehicle and the instrument, and it is checked before the
        approval rather than after the send. A 506(b) SPV cannot carry a public primer, and the
        grants rail is never framed as an investment offering.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Propose a send</h2>
          <span className="lbl">the wrap check runs first</span>
        </div>
        <SendGate
          assets={sendable.map((a) => ({
            id: a.assetId,
            label: `${a.title} · ${a.audience ? AUDIENCE_LABEL[a.audience] : ''} · ${USE_LABEL[a.permittedUse]} · ${a.status}`,
          }))}
          entities={entities.map((e) => ({ id: e.entityId, label: e.displayName }))}
          vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.name} · ${v.exemption}` }))}
          instruments={INSTRUMENTS.map((i) => ({ id: i, label: i.replace('_', ' ') }))}
        />
      </div>

      <div className="card">
        <div className="chead">
          <h2>The wrong-wrap matrix</h2>
          <span className="lbl">vehicle × instrument → what may be said</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Exemption</th>
              <th style={{ width: 130 }}>Instrument</th>
              <th>Allowed audiences</th>
              <th style={{ width: 130 }}>Travels at most</th>
              <th style={{ width: 320 }}>Why</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId}>
                <td className="mono">{r.exemption}</td>
                <td className="muted">{r.instrument.replace('_', ' ')}</td>
                <td>
                  {r.allowedAudiences.map((a) => (
                    <span key={a} className="flag f-mute" style={{ marginRight: 4, marginBottom: 3, display: 'inline-block' }}>
                      {AUDIENCE_LABEL[a]}
                    </span>
                  ))}
                </td>
                <td className="muted">{USE_LABEL[r.maxPermittedUse]}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {r.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>The matrix is a closed set.</b> A combination no rule covers is refused rather than
          assumed to be fine — an uncovered case is a gap in the rules, and guessing at it is how a
          506(b) exemption gets broken for a whole raise.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Send log</h2>
          <span className="lbl">including everything the matrix refused</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Material</th>
              <th style={{ width: 160 }}>To</th>
              <th style={{ width: 150 }}>On behalf of</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 340 }}>Refusal</th>
            </tr>
          </thead>
          <tbody>
            {sends.map((s) => (
              <tr key={s.sendId}>
                <td>
                  <b>{s.assetTitle}</b>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {s.audience ? AUDIENCE_LABEL[s.audience] : ''} · {s.instrument.replace('_', ' ')}
                  </div>
                </td>
                <td className="muted">{s.entityName}</td>
                <td className="muted">{s.vehicleName}</td>
                <td>
                  <span className={`flag ${SEND_FLAG[s.status]}`}>{s.status}</span>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                    {s.sentAt ? shortDate(s.sentAt) : shortDate(s.requestedAt)}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {s.refusal ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
