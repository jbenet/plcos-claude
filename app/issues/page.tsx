import { IssueList } from '@/components/issues/IssueList';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { issues as issueSink, PRIORITY, type IssuePriority } from '@/lib/issues';

export const dynamic = 'force-dynamic';

const ORDER: IssuePriority[] = ['P0', 'P1', 'P2', 'P3'];

export default async function Issues() {
  const sink = await issueSink();
  const all = await sink.list();
  const open = all.filter((i) => i.status !== 'done');
  const byPriority = ORDER.map((p) => ({ p, n: open.filter((i) => i.priority === p).length }));

  return (
    <Page
      crumbs={[{ label: SECTION.overview }, { label: 'Issues' }]}
      inspector={
        <>
          <div className="lbl">Priority</div>
          <div className="ihead">What each one means</div>
          <div className="imeta">An order, not a delivery date — the queue decides the date</div>
          {ORDER.map((p) => (
            <div className="kv" key={p}>
              <span>{p}</span>
              <span>
                {PRIORITY[p].means}
                <br />
                <span className="muted" style={{ fontWeight: 400 }}>
                  {PRIORITY[p].detail}
                </span>
              </span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Where these live</div>
            <p>{sink.destination}</p>
          </div>
          <div className="note" style={{ marginTop: 0 }}>
            The sink is an interface. <code>GitHubIssueSink</code> drops in at D2 by changing one
            line in <code>config/deployment.ts</code> — no caller changes, and the files stay
            readable either way.
          </div>
        </>
      }
    >
      <div className="lbl">Feedback loop</div>
      <h1>Issues</h1>
      <p className="sublede">
        One markdown file per issue, git-tracked, written by the feedback box. The complaint and
        its fix travel in the same pull request, and <code>git log issues/</code> is free triage
        history.
      </p>

      <div className="kpis">
        {byPriority.map(({ p, n }) => (
          <div className="kpi" key={p}>
            <span className={`tag ${p === 'P0' || p === 'P1' ? 't-clay' : 't-plain'}`}>{p}</span>
            <div className="n">{n}</div>
            <div className="f">{PRIORITY[p].means}. {PRIORITY[p].detail}</div>
          </div>
        ))}
      </div>

      {all.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nothing filed
              </span>
              <h3>No issues have been filed yet.</h3>
              <p>
                Press <b>Give feedback</b> in the bar above. It writes{' '}
                <code>issues/NNNN-slug.md</code> with the route, the user and the active filters
                captured at the moment you pressed it.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <IssueList issues={all} />
      )}

    </Page>
  );
}
