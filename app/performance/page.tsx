import { Page } from '@/components/shell/Page';
import { listSyncSources } from '@/modules/platform';
import { listAssets, listSends } from '@/modules/content';
import { listPursuits, RUNG_LABEL } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

export default async function Performance() {
  const [assets, sends, sources, pursuits] = await Promise.all([
    listAssets(), listSends(), listSyncSources(), listPursuits(),
  ]);
  const sent = sends.filter((s) => s.status === 'sent');
  const docsend = sources.find((s) => s.source === 'docsend');

  return (
    <Page
      crumbs={[{ label: 'Create & substantiate' }, { label: 'Content performance' }]}
      inspector={
        <>
          <div className="lbl">What can be attributed</div>
          <div className="ihead">Almost nothing, honestly</div>
          <div className="imeta">And that is the useful finding</div>
          <div className="kv">
            <span>Sends recorded</span>
            <span>{sent.length}</span>
          </div>
          <div className="kv">
            <span>View data available</span>
            <span>none</span>
          </div>
          <div className="kv">
            <span>DocSend</span>
            <span>{docsend?.status.replace('_', ' ') ?? 'unknown'}</span>
          </div>
          <div className="scope">
            <div className="lbl">Views are not commitment</div>
            <p>
              When DocSend does arrive, it reports opens and page time. Neither is evidence that
              anyone decided anything, and both correlate with curiosity rather than intent. Any
              number here will be labelled partial at the point it is rendered.
            </p>
          </div>
          <div className="note">
            DocSend is forward-only through a Zapier webhook: no backfill, no guarantees, no
            signature. History will have to be a manual CSV, and will be marked as such.
          </div>
        </>
      }
    >
      <div className="lbl">Module 15 · Create &amp; substantiate</div>
      <h1>Content performance</h1>
      <p className="sublede">
        This page exists to say what cannot be measured yet, because the alternative is a chart of
        something adjacent that looks like an answer.
      </p>

      <div className="card">
        <div className="chead">
          <h2>What is measurable today</h2>
          <span className="lbl">no connector before L13</span>
        </div>
        <div className="cbody">
          <div className="empty">
            <span className="stat unavailable">
              <i />
              Source unavailable
            </span>
            <h3>There is no view data, so there are no view metrics.</h3>
            <p>
              {sent.length} send{sent.length === 1 ? ' has' : 's have'} been recorded through the
              gate. What happened after each one is not in this system and will not be until a
              connector exists.
            </p>
            <dl>
              <dt>What is known</dt>
              <dd>What was sent, to whom, on behalf of which vehicle, and when.</dd>
              <dt>What is not</dt>
              <dd>Whether it was opened, read, forwarded, or had any effect at all.</dd>
              <dt>Safe next step</dt>
              <dd>Read the consent ladder. It records what people actually did, which is the only attribution this system trusts.</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The attribution we do have</h2>
          <span className="lbl">the ladder, not the analytics</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Target</th>
              <th style={{ width: 150 }}>Vehicle</th>
              <th style={{ width: 200 }}>Reached</th>
              <th style={{ width: 280 }}>On what evidence</th>
            </tr>
          </thead>
          <tbody>
            {pursuits.map((p) => {
              const latest = p.events[p.events.length - 1];
              return (
                <tr key={p.pursuitId}>
                  <td>
                    <b>{p.entityName}</b>
                  </td>
                  <td className="muted">{p.vehicleName}</td>
                  <td className="muted">{p.rung ? RUNG_LABEL[p.rung] : 'nothing on file'}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {latest?.evidenceNote ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="cover">
          <b>This is the honest version of content attribution.</b> A rung was reached, and a
          specific piece of evidence justified it. Nothing here claims a document caused it —
          claiming that would require an experiment nobody is going to run.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Assets in circulation</h2>
        </div>
        <table className="list">
          <tbody>
            {assets
              .filter((a) => a.status === 'approved' && a.parentId)
              .map((a) => (
                <tr key={a.assetId}>
                  <td>
                    <b>{a.title}</b>
                  </td>
                  <td className="right muted" style={{ width: 180 }}>
                    {sent.filter((s) => s.assetTitle === a.title).length} send
                    {sent.filter((s) => s.assetTitle === a.title).length === 1 ? '' : 's'} recorded
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
