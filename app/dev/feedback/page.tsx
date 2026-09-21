import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { shortDate } from '@/lib/time';
import { listFeedback } from '@/modules/platform';
import { issues as issueSink } from '@/lib/issues';

export const dynamic = 'force-dynamic';

export default async function DevFeedback() {
  const [rows, sink] = await Promise.all([listFeedback(), issueSink()]);
  const files = await sink.list();
  const orphaned = files.filter((f) => !rows.some((r) => r.issueRef === f.id));

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Feedback' }]}
      inspector={
        <>
          <div className="lbl">Two records, one complaint</div>
          <div className="ihead">The row and the file</div>
          <div className="imeta">Written together, read apart</div>
          <div className="kv">
            <span>Feedback rows</span>
            <span>{rows.length}</span>
          </div>
          <div className="kv">
            <span>Issue files</span>
            <span>{files.length}</span>
          </div>
          <div className="kv">
            <span>Files with no row</span>
            <span>{orphaned.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">Why both</div>
            <p>
              The row records that somebody complained, with the context captured at that moment.
              The file is the tracker a coding agent reads. The row survives{' '}
              <code>git checkout</code>; the file survives <code>npm run db:reset</code>.
            </p>
          </div>
          <div className="note">
            {orphaned.length > 0
              ? `${orphaned.length} file${orphaned.length === 1 ? '' : 's'} have no row — they were filed before the last database reset, which is exactly the case files exist for.`
              : 'Every file has a row behind it.'}
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Feedback</h1>
      <p className="sublede">
        Everything filed through the box, with the context captured at the moment the button was
        pressed. <Link href="/issues">Issues</Link> shows the markdown files these produce.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Submitted</h2>
          <span className="lbl">{rows.length} rows in platform.feedback</span>
        </div>
        {rows.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                No rows
              </span>
              <h3>Nothing has been filed since the last database reset.</h3>
              <p>
                {files.length > 0
                  ? `${files.length} issue file${files.length === 1 ? '' : 's'} still exist in the repository, because files survive a reset and rows do not. That is the whole argument for keeping issues as files.`
                  : 'And no issue files exist either.'}
              </p>
            </div>
          </div>
        ) : (
          rows.map((r) => (
            <div className="row" key={r.id} style={{ alignItems: 'flex-start' }}>
              <span className={`kind k-${r.kind}`} style={{ width: 84 }}>
                {r.priority} · {r.kind}
              </span>
              <div className="t">
                <b>{r.title}</b>
                <span style={{ display: 'block', lineHeight: 1.5 }}>{r.body}</span>
                <pre className="block" style={{ marginTop: 8, fontSize: 10.5 }}>
                  {JSON.stringify(r.context, null, 2)}
                </pre>
              </div>
              <div className="state" style={{ width: 150 }}>
                <b>{r.issueRef ? `issue ${r.issueRef}` : 'no file'}</b>
                {r.reporterName} · {shortDate(r.createdAt)}
                <div className="mono" style={{ fontSize: 10, marginTop: 3 }}>
                  {r.page}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {orphaned.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Files with no row behind them</h2>
            <span className="lbl">filed before a reset — and still here</span>
          </div>
          {orphaned.map((f) => (
            <Link className="row" key={f.id} href={`/issues/${f.id}`}>
              <span className="mono muted" style={{ width: 44 }}>{f.id}</span>
              <div className="t">
                <b>{f.title}</b>
                <span>
                  {f.reporter} · {f.page} · {f.location}
                </span>
              </div>
              <div className="state">
                <span className="flag f-mute">{f.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
