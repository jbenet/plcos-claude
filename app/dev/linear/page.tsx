import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { ago } from '@/lib/time';
import { QUERIES } from '@/lib/connectors/linear/queries';
import { linearLiveServer, linearSource, rawDir } from '@/lib/connectors/linear/sync';
import { linearKeyPresent } from '@/lib/connectors/linear/key';
import { linearOverview, linearSyncState, type LinearOverview } from '@/lib/connectors/linear/view';
import { LinearSync } from './LinearSync';
import s from './linear.module.css';
import { ImportJobs } from '@/components/import-jobs/ImportJobs';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
const pct = (x: number, of: number) => (of ? `${Math.round((x / of) * 100)}%` : '—');
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—');
const STATUS_FLAG: Record<string, string> = { started: 'f-ok', planned: 'f-ev', backlog: 'f-mute', completed: 'f-mute', canceled: 'f-mute', paused: 'f-ev' };
const STATE_WORD: Record<string, string> = { backlog: 'Backlog', unstarted: 'To do', started: 'In progress', completed: 'Done', canceled: 'Canceled', duplicate: 'Duplicate', triage: 'Triage', unknown: 'Unknown state' };

function Replica({ o }: { o: LinearOverview }) {
  const all = o.totals.issues;
  return (
    <div className="card">
      <div className="chead">
        <h2>In the replica</h2>
        <span className="lbl">{o.oldest && o.newest ? `issues created from ${o.oldest.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · last change ${ago(o.newest)}` : 'counts'}</span>
      </div>
      <div className={s.strip}>
        {([['Teams', o.totals.teams], ['Projects', o.totals.projects], ['Issues', o.totals.issues], ['Comments', o.totals.comments], ['Members', o.totals.members], ['Labels', o.totals.labels]] as const).map(([k, v]) => (
          <div key={k} className={s.stat}><span className={s.k}>{k}</span><span className={s.v}>{n(v)}</span></div>
        ))}
      </div>
      <p className={s.fill}>
        Of {n(all)} issues: <b>{pct(o.fill.assignee, all)}</b> have an owner · <b>{pct(o.fill.project, all)}</b> a project ·{' '}
        <b>{pct(o.fill.labels, all)}</b> labels · <b>{pct(o.fill.due, all)}</b> a due date · <b>{pct(o.fill.parent, all)}</b> a parent ·{' '}
        <b>{pct(o.fill.estimate, all)}</b> an estimate · <b>{pct(o.fill.cycle, all)}</b> a cycle · <b>{pct(o.fill.milestone, all)}</b> a milestone.
      </p>
      <div className={s.scroll}>
        <table className={`list ${s.table}`}>
          <thead>
            <tr>
              <th>Team</th>
              <th className={s.num}>Issues</th>
              <th className={s.num}>Open</th>
              <th className={`${s.num} ${s.hideS}`}>Done</th>
              <th className={`${s.num} ${s.hideS}`}>Canceled</th>
              <th className={s.num}>Projects</th>
              <th className={`${s.num} ${s.hideS}`}>Last change</th>
            </tr>
          </thead>
          <tbody>
            {o.teams.map((t) => (
              <tr key={t.id}>
                <td><b className={s.name}>{t.name ?? 'Unnamed team'}</b> <span className={s.key}>{t.key}</span></td>
                <td className={s.num}>{n(t.issues)}</td>
                <td className={s.num}>{n(t.open)}</td>
                <td className={`${s.num} ${s.hideS}`}>{n(t.done)}</td>
                <td className={`${s.num} ${s.hideS}`}>{n(t.canceled)}</td>
                <td className={s.num}>{n(t.projects)}</td>
                <td className={`${s.num} ${s.hideS}`}>{t.lastUpdated ? ago(t.lastUpdated) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cover">
        <b>By state:</b> {o.states.map((x) => `${STATE_WORD[x.type] ?? x.type} ${n(x.issues)}`).join(' · ') || 'none'}. Open is backlog, to do and in progress. Archived issues are kept in the replica and left out of these counts.
      </p>
    </div>
  );
}

function Projects({ o }: { o: LinearOverview }) {
  return (
    <div className="card">
      <div className="chead">
        <h2>Projects</h2>
        <span className="lbl">{o.projects.length} · in progress first, then by open issues</span>
      </div>
      {o.projects.length === 0 ? <div className="cbody"><p className="muted">No projects in the replica.</p></div> : (
        <div className={s.scroll}>
          <table className={`list ${s.table}`}>
            <thead>
              <tr>
                <th>Project</th>
                <th style={{ width: 110 }}>Status</th>
                <th className={s.hideS}>Lead</th>
                <th className={`${s.hideS} ${s.num}`}>Target</th>
                <th className={s.num}>Open / all</th>
              </tr>
            </thead>
            <tbody>
              {o.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b className={s.name}>{p.name ?? 'Unnamed project'}</b> <span className={s.key}>{p.teams}</span>
                    {p.milestones > 0 && <span className={s.sub}>{p.milestones} milestone{p.milestones === 1 ? '' : 's'}</span>}
                    <span className={`${s.sub} ${s.showS}`}>{p.lead ?? 'No lead'}{p.target ? ` · target ${day(p.target)}` : ''}</span>
                  </td>
                  <td><span className={`flag ${STATUS_FLAG[p.statusType ?? ''] ?? 'f-mute'}`}>{p.statusName ?? 'No status'}</span></td>
                  <td className={s.hideS}>{p.lead ?? <span className="muted">No lead</span>}{p.lead && !p.leadOurs && <span className={s.sub}>not matched to our team</span>}</td>
                  <td className={`${s.hideS} ${s.num}`}>{day(p.target)}</td>
                  <td className={s.num}>{n(p.open)} / {n(p.issues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cover">Linear keeps its timeline here: start and target dates on projects, and target dates on milestones. Issues rarely carry due dates.</p>
    </div>
  );
}

function Mapping({ o }: { o: LinearOverview }) {
  return (
    <div className="card">
      <div className="chead">
        <h2>How it maps to our world</h2>
        <span className="lbl">a reading by name · nothing is linked yet</span>
      </div>
      <div className={s.scroll}>
        <table className={`list ${s.table}`}>
          <thead><tr><th>Vehicle</th><th className={s.num}>Projects</th><th className={s.num}>Issues</th><th className={s.num}>Open</th><th className={s.hideS}>Matched on</th></tr></thead>
          <tbody>
            {o.vehicles.map((v) => (
              <tr key={v.slug}>
                <td><b className={s.name}>{v.name}</b></td>
                <td className={s.num}>{n(v.projects)}</td>
                <td className={s.num}>{n(v.issues)}</td>
                <td className={s.num}>{n(v.open)}</td>
                <td className={`${s.hideS} ${s.terms}`}>{v.terms.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cbody">
        <div className="fact"><span>Our team in Linear</span><span>{n(o.ours.matched)} of {n(o.ours.members)} referenced members matched to our team by email</span></div>
        <div className="fact"><span>Open issues</span><span>{n(o.ours.openAssigned)} owned by our team · {n(o.ours.openAssignedElsewhere)} by others · {n(o.ours.openUnassigned)} unowned</span></div>
        <div className="fact"><span>LPs named in titles</span><span>{o.lpTitles.issues === 0 ? 'No issue title names an LP we are pursuing' : `${n(o.lpTitles.issues)} issue${o.lpTitles.issues === 1 ? '' : 's'} name${o.lpTitles.issues === 1 ? 's' : ''} ${n(o.lpTitles.lps)} LP${o.lpTitles.lps === 1 ? '' : 's'} we are pursuing`}</span></div>
      </div>
      <p className="cover">
        <b>Unconfirmed.</b> A vehicle counts a project or issue whose title holds one of its names; an LP counts when its name appears in a title. Names
        collide and go unmentioned, so none of this links anything. The linking model waits on the plan in docs/24-linear.md.
      </p>
    </div>
  );
}

async function LinearPage() {
  const db = await getDb();
  const demo = config.data.profile === 'demo';
  const src = linearSource();
  const refused = 'refused' in src ? src.refused : null;
  const [state, overview] = await Promise.all([
    linearSyncState(db, rawDir()),
    linearOverview(db).then((o) => ({ ok: true as const, o }), () => ({ ok: false as const })),
  ]);
  const last = state.last, complete = state.lastComplete;
  const stopped = Boolean(last && !last.complete);
  const flag = !last ? ['f-mute', 'Not synced'] : stopped ? ['f-block', 'Last sync stopped'] : ['f-ok', 'Synced'];
  const queries = Object.entries(QUERIES);
  const synced = Boolean(overview.ok && overview.o.totals.issues + overview.o.totals.teams > 0);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Linear' }]}
      inspector={
        <>
          <div className="lbl">Read-only</div>
          <div className="ihead">Queries only, {queries.length} of them</div>
          <div className="imeta">Enforced in lib/connectors/linear/client.ts</div>
          <div className="scope">
            <div className="lbl">Why in code</div>
            <p>
              A Linear personal key can write, and the same endpoint takes mutations. So the client sends only queries from
              its allowlist, checks each text for a mutation before sending, and has no other way out. The property harness
              proves it on every run.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">What Linear holds</div>
            <p>
              No custom fields on issues. Its structure is teams, projects with dates and milestones, and labels in groups.
              Customer requests are not enabled in this workspace.
            </p>
          </div>
          <div className="kv"><span>Key on this server</span><span>{demo ? 'demo: none needed' : linearKeyPresent() ? 'present' : 'absent'}</span></div>
          <div className="kv"><span>Allowed teams</span><span>{config.linear.teams.join(', ') || 'None'}</span></div>
          <div className="kv"><span>Page size</span><span>{config.linear.pageSize} · GUESS</span></div>
          <div className="kv"><span>Waits below</span><span>{n(config.linear.minRequestsLeft)} requests left · GUESS</span></div>
          <div className="note">The plan, and what would come next: docs/24-linear.md.</div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Linear, read-only</h1>
      <p className="sublede">
        A local copy of the allowed Linear teams: {config.linear.teams.join(', ') || 'none'}. Sync status and counts by team, project and state. Nothing is written back to Linear.
      </p>

      {/* The imports this page starts, while they run or need a look (issue 0114). */}
      <ImportJobs compact />

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>
            This page syncs an invented workspace from <code>fixtures/linear/</code>, through the same client and the same
            allowlist. The demo never reaches Linear.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Sync</h2>
          <span className={`flag ${flag[0]}`}>{flag[1]}</span>
        </div>
        <div className="cbody">
          {last ? (
            <>
              <div className="fact"><span>Last sync</span><span>{ago(new Date(last.at))} · {last.since ? 'changes only' : 'all allowed-team records'} · {n(last.records)} records in {n(last.requests)} requests</span></div>
              {stopped && (
                <div className="warn" style={{ margin: '8px 0', fontSize: 12.5 }}>
                  <b>It stopped before every kind of record was read.</b> What it read is kept and translated. The next sync asks again
                  from {complete ? `the last complete one, ${ago(new Date(complete.at))}` : 'the beginning'}. Anyone can retry below.
                </div>
              )}
              {complete && complete !== last && <div className="fact"><span>Last complete</span><span>{ago(new Date(complete.at))}</span></div>}
              {last.budget?.requestsLeft != null && last.budget.requestsLimit != null && (
                <div className="fact"><span>Hourly budget after it</span><span>{n(last.budget.requestsLeft)} of {n(last.budget.requestsLimit)} requests · {last.budget.complexityLeft != null ? `${n(last.budget.complexityLeft)} complexity points` : 'complexity not read'}</span></div>
              )}
              <div className="fact"><span>Replica</span><span>{state.manifests} pull{state.manifests === 1 ? '' : 's'} · {n(state.files)} files translated</span></div>
            </>
          ) : (
            <p className={s.lede}>Nothing has been read from Linear here yet. The first sync reads only the allowed teams and their projects, issues and related records.</p>
          )}
          <LinearSync refused={refused} rebuildRefused={!demo && !linearLiveServer()} synced={Boolean(complete)} />
        </div>
      </div>

      {!overview.ok ? (
        <div className="card">
          <div className="chead"><h2>The replica can’t be read</h2><span className="flag f-mute">Source unavailable</span></div>
          <div className="cbody"><p className="muted">The counts did not load. Nothing is shown as zero. Reload; if it persists, the migration for the linear schema may not have run.</p></div>
        </div>
      ) : synced ? (
        <>
          <Replica o={overview.o} />
          <Projects o={overview.o} />
          <Mapping o={overview.o} />
        </>
      ) : null}

      <div className="card">
        <div className="chead">
          <h2>What this server may ask</h2>
          <span className="lbl">GraphQL queries only · {queries.length}</span>
        </div>
        <table className={`list ${s.table}`}>
          <tbody>
            {queries.map(([name, q]) => (
              <tr key={name}>
                <td className="mono" style={{ width: '32%', fontSize: 12 }}>{name}</td>
                <td>{q.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover"><b>Anything else is refused before it leaves the machine.</b> Each query asks only for the fields the replica keeps; the texts are in lib/connectors/linear/queries.ts.</p>
      </div>
    </Page>
  );
}

export default coalescePage('/dev/linear', LinearPage);
