import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { AudienceVariants } from '@/components/content/AudienceVariants';
import { shortDate } from '@/lib/time';
import { AUDIENCE_LABEL, listAssets, USE_LABEL } from '@/modules/content';

export const dynamic = 'force-dynamic';

export default async function ContentStudio() {
  const assets = await listAssets();
  const canonicals = assets.filter((a) => a.parentId === null);
  const flagged = assets.filter((a) => a.flags.length > 0);

  return (
    <Page
      crumbs={[{ label: SECTION.other }, { label: 'Content studio' }]}
      inspector={
        <>
          <div className="lbl">Lineage</div>
          <div className="ihead">A changed claim invalidates its derivatives</div>
          <div className="imeta">Not elapsed time — a changed fact</div>
          <div className="kv">
            <span>Canonical assets</span>
            <span>{canonicals.length}</span>
          </div>
          <div className="kv">
            <span>Variants</span>
            <span>{assets.length - canonicals.length}</span>
          </div>
          <div className="kv">
            <span>Approved</span>
            <span>{assets.filter((a) => a.status === 'approved').length}</span>
          </div>
          <div className="kv">
            <span>Needing refresh</span>
            <span style={{ color: flagged.length ? 'var(--clay)' : undefined }}>{flagged.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">Why lineage rather than dates</div>
            <p>
              A deck goes wrong because a fact underneath it changed, not because ninety days
              passed. Each variant records the claims it rests on, and superseding one of those
              claims flags every derivative — transitively, so a canonical change reaches the
              variants too.
            </p>
          </div>
          <div className="note">
            A variant with no claims recorded would never be flagged. The studio says so on the
            variant rather than leaving the gap silent.
          </div>
        </>
      }
    >
      <div className="lbl">Module 14 · Create &amp; substantiate</div>
      <h1>Content studio</h1>
      <p className="sublede">
        One canonical asset per thesis, and a variant per audience. The variants sit side by side
        on purpose: seeing the LP memo next to the public primer is what stops the same sentence
        appearing in both when only one of them may carry it.
      </p>

      {canonicals.map((c) => (
        <AudienceVariants
          key={c.assetId}
          canonical={c}
          variants={assets.filter((a) => a.parentId === c.assetId)}
        />
      ))}

      <div className="card">
        <div className="chead">
          <h2>Every asset</h2>
          <span className="lbl">status, audience and how far it may travel</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Asset</th>
              <th style={{ width: 140 }}>Audience</th>
              <th style={{ width: 130 }}>Permitted use</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 110 }}>Approved</th>
              <th style={{ width: 90 }} className="right">
                Claims
              </th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.assetId}>
                <td>
                  <b>{a.title}</b>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {a.summary}
                  </div>
                </td>
                <td className="muted">{a.audience ? AUDIENCE_LABEL[a.audience] : 'canonical'}</td>
                <td className="muted">{USE_LABEL[a.permittedUse]}</td>
                <td>
                  <span className={`flag ${a.status === 'approved' ? 'f-ok' : a.status === 'needs_refresh' ? 'f-block' : 'f-mute'}`}>
                    {a.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="muted nowrap">{a.approvedAt ? shortDate(a.approvedAt) : '—'}</td>
                <td className="right mono">{a.claims.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
