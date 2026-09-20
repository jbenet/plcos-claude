import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { issues as issueSink, SLA, type IssuePriority } from '@/lib/issues';
import { ago } from '@/lib/time';

export const dynamic = 'force-dynamic';

const ORDER: IssuePriority[] = ['P0', 'P1', 'P2', 'P3'];

export default async function Issues() {
  const sink = await issueSink();
  const all = await sink.list();
  const open = all.filter((i) => i.status !== 'done');
  const byPriority = ORDER.map((p) => ({ p, n: open.filter((i) => i.priority === p).length }));

  return (
    <Page
      crumbs={[{ label: 'Issues' }]}
      inspector={
        <>
          <div className="lbl">Triage ladder</div>
          <div className="ihead">What each priority promises</div>
          <div className="imeta">issues/README.md · the same four rows the frontmatter uses</div>
          {ORDER.map((p) => (
            <div className="kv" key={p}>
              <span>{p}</span>
              <span>
                {SLA[p].triage}
                <br />
                <span className="muted" style={{ fontWeight: 400 }}>
                  fix: {SLA[p].fix}
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
            <div className="f">
              Triaged {SLA[p].triage}. Fixed {SLA[p].fix}.
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>All issues</h2>
          <span className="lbl">
            {all.length} file{all.length === 1 ? '' : 's'} · {open.length} open
          </span>
        </div>
        {all.length === 0 ? (
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
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 52 }}>Id</th>
                <th>Title</th>
                <th style={{ width: 90 }}>Kind</th>
                <th style={{ width: 62 }}>Priority</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 96 }}>Filed</th>
              </tr>
            </thead>
            <tbody>
              {all.map((i) => (
                <tr key={i.id} className="clickable">
                  <td className="mono muted">{i.id}</td>
                  <td>
                    <Link href={`/issues/${i.id}`}>
                      <b>{i.title}</b>
                    </Link>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {i.reporter} · {i.page}
                    </div>
                  </td>
                  <td>
                    <span className={`kind k-${i.kind}`}>{i.kind}</span>
                  </td>
                  <td className="mono">{i.priority}</td>
                  <td>
                    <span className="flag f-mute">{i.status}</span>
                  </td>
                  <td className="muted nowrap">{i.created ? ago(new Date(i.created)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
