import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { ago } from '@/lib/time';
import { gitLog } from '@/lib/dev/git';
import {
  FAMILY_LABEL, fmtTokens, listNotes, loadLedger, timeline, workflowStats,
  type Family, type RunView,
} from '@/lib/workflows/view';
import { OUTCOME_WORD, Outcome, OutcomeBar, Timeline, fmtDay, fmtHour } from './parts';
import s from './workflows.module.css';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const FAMILIES: Family[] = ['research', 'import', 'dev'];
const ROWS = 60;

function query(base: SP, patch: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const k of ['family', 'w', 'all', 'run']) {
    const v = k in patch ? patch[k] : one(base[k]);
    if (v) q.set(k, v);
  }
  const text = q.toString();
  return `/dev/workflows${text ? `?${text}` : ''}`;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const minutes = (r: RunView) =>
  r.startedAt && r.endedAt ? Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60e3)) : null;
const dur = (m: number | null) => (m === null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());
const when = (d: Date | null) => (d ? `${fmtDay(d)} ${fmtHour(d)}` : 'time not recorded');

function RunInspector({ run, all, sp }: { run: RunView; all: RunView[]; sp: SP }) {
  const parent = run.parentRunId ? all.find((r) => r.runId === run.parentRunId) : undefined;
  const children = all.filter((r) => r.parentRunId === run.runId);
  const c = run.counts;
  return (
    <>
      <div className="lbl">Run · {run.workflow}</div>
      <div className="ihead">{run.operation}</div>
      <div className="imeta">{run.name} · {when(run.startedAt)}</div>
      <Outcome outcome={run.outcome} />
      {run.reason && <p className={s.reason}>{run.reason}</p>}
      <div style={{ marginTop: 12 }}>
        <div className="kv"><span>Who</span><span>{run.agent}</span></div>
        <div className="kv"><span>Source · model</span><span>{run.source} · {run.model ?? 'not recorded'}</span></div>
        <div className="kv"><span>Worked in</span><span className="mono">{run.folder}</span></div>
        <div className="kv"><span>Protocol</span><span>{run.version ?? 'unversioned'}</span></div>
        <div className="kv"><span>Duration</span><span>{run.finished ? dur(minutes(run)) : 'no finish recorded'}</span></div>
        <div className="kv"><span>Planned</span><span>{run.planned}</span></div>
        {c ? (
          <>
            <div className="kv"><span>Written · valid</span><span>{c.written ?? '—'} · {c.valid ?? '—'}</span></div>
            <div className="kv"><span>Failed · skipped</span><span>{c.failed ?? '—'} · {c.skipped ?? '—'}</span></div>
          </>
        ) : (
          <div className="kv"><span>Counts</span><span>unknown until it finishes</span></div>
        )}
        <div className="kv">
          <span>Tokens in · out</span>
          <span>
            {run.usage && run.usage.source !== 'unknown' && (run.usage.input || run.usage.output)
              ? `${fmtTokens(run.usage.input)} · ${fmtTokens(run.usage.output)} ${run.usage.source}`
              : 'unknown'}
          </span>
        </div>
        {run.usage && run.usage.cacheRead > 0 && (
          <div className="kv"><span>Cache read</span><span>{fmtTokens(run.usage.cacheRead)}</span></div>
        )}
        {run.usage?.cost != null && <div className="kv"><span>Cost</span><span>${run.usage.cost.toFixed(2)}</span></div>}
      </div>
      {run.checks.list.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Checks · {run.checks.pass} of {run.checks.list.length} passed</div>
          <ul className={s.checks}>
            {run.checks.list.map((ch, i) => (
              <li key={i}>
                <span className={`flag ${ch.status === 'pass' ? 'f-ok' : ch.status === 'fail' ? 'f-block' : 'f-mute'}`}>
                  {ch.status === 'pass' ? 'pass' : ch.status === 'fail' ? 'fail' : 'not run'}
                </span>
                <span>{ch.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(parent || children.length > 0) && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Related runs</div>
          <ul className={s.checks}>
            {parent && (
              <li><span className="muted">parent</span><Link href={query(sp, { run: parent.runId })}>{parent.workflow} · {parent.operation}</Link></li>
            )}
            {children.map((ch) => (
              <li key={ch.runId}><span className="muted">child</span><Link href={query(sp, { run: ch.runId })}>{ch.workflow} · {ch.operation}</Link></li>
            ))}
          </ul>
        </>
      )}
      {run.usage?.method && <div className="note">Usage: {run.usage.method}</div>}
      <div className="note">
        Run <span className="mono">{run.runId}</span> · batch <span className="mono">{run.batchId}</span>.{' '}
        <Link href={query(sp, { run: null })}>Close</Link>
      </div>
    </>
  );
}

async function Workflows({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ledger, protocolLog] = await Promise.all([
    loadLedger(),
    gitLog({ limit: 14, paths: ['docs/workflows', '.claude/agents', 'lib/workflows'] }),
  ]);
  const notes = await listNotes(ledger.notesRoot);
  const all = ledger.runs;
  const family = FAMILIES.includes(one(sp.family) as Family) ? (one(sp.family) as Family) : null;
  const wf = one(sp.w) || null;
  const scoped = all.filter((r) => (!family || r.family === family) && (!wf || r.workflow === wf));
  const stats = workflowStats(all);
  const scopedStats = workflowStats(scoped);
  const picked = wf ? stats.find((x) => x.workflow === wf) ?? null : null;
  const { buckets, hours } = timeline(scoped);
  const selected = one(sp.run) ? all.find((r) => r.runId === one(sp.run)) ?? null : null;
  const showAll = one(sp.all) === '1';
  const rows = showAll ? scoped : scoped.slice(0, ROWS);
  const byId = new Map(all.map((r) => [r.runId, r]));

  const count = (f: (r: RunView) => boolean) => scoped.filter(f).length;
  const done = count((r) => r.outcome === 'succeeded');
  const partial = count((r) => r.outcome === 'partial');
  const bad = count((r) => ['failed', 'refused', 'cancelled', 'unavailable'].includes(r.outcome));
  const open = count((r) => r.outcome === 'unknown');
  const measured = scoped.filter((r) => r.usage?.source === 'measured' && (r.usage.input || r.usage.output));
  const estimated = scoped.filter((r) => r.usage?.source === 'estimated' && (r.usage.input || r.usage.output));
  const sum = (rs: RunView[]) => rs.reduce((n, r) => n + (r.usage ? r.usage.input + r.usage.output : 0), 0);
  const scripts = count((r) => r.source === 'script');
  const unknownUsage = scoped.length - measured.length - estimated.length - scripts;
  const written = scoped.reduce((n, r) => n + (r.counts?.written ?? 0), 0);
  const checksAll = scoped.reduce((n, r) => n + r.checks.list.length, 0);
  const checksPass = scoped.reduce((n, r) => n + r.checks.pass, 0);
  const sources = ['claude-code', 'chatgpt', 'script', 'app'].map((k) => [k, all.filter((r) => r.source === k).length] as const).filter(([, n]) => n);
  const folders = [...all.reduce((m, r) => m.set(r.folder, (m.get(r.folder) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const versioned = (picked ? [picked] : stats.filter((x) => x.versions.length > 1)).slice(0, 8);
  const noteCount = notes.dates.reduce((n, d) => n + d.notes.length, 0);
  const scopeWords = [family ? FAMILY_LABEL[family].toLowerCase() : null, wf ? `${wf}${picked ? ` ${picked.name}` : ''}` : null].filter(Boolean).join(' · ');

  const inspector = selected ? <RunInspector run={selected} all={all} sp={sp} /> : (
    <>
      <div className="lbl">The ledger</div>
      <div className="ihead">
        {ledger.error ? 'Not readable here' : ledger.issues.length ? 'History incomplete' : `${all.length} runs, folded cleanly`}
      </div>
      <div className="imeta">
        {ledger.where === 'demo' ? 'Demo: invented runs, not a record of anything' : ledger.label}
      </div>
      {!ledger.error && (
        <>
          <div className="kv"><span>Lines</span><span>{ledger.lines}</span></div>
          <div className="kv"><span>Last write</span><span>{ledger.lastWrite ? ago(ledger.lastWrite) : ledger.where === 'demo' ? 'fixed' : '—'}</span></div>
          <div className="kv"><span>Started, never finished</span><span>{all.filter((r) => !r.finished).length}</span></div>
          {sources.map(([k, n]) => (
            <div className="kv" key={k}><span>{k === 'claude-code' ? 'Claude Code' : k === 'chatgpt' ? 'ChatGPT' : k === 'script' ? 'Scripts' : 'The app'}</span><span>{n}</span></div>
          ))}
        </>
      )}
      {ledger.issues.length > 0 && (
        <div className="scope">
          <div className="lbl" style={{ color: 'var(--clay)' }}>Needs an operator</div>
          <p>{ledger.issues.length} line{ledger.issues.length === 1 ? '' : 's'} did not fold: {ledger.issues[0]} Counts below are at least these; nothing is repaired automatically.</p>
        </div>
      )}
      {folders.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Where they ran</div>
          {folders.slice(0, 8).map(([f, n]) => (
            <div className="kv" key={f}><span className="mono" style={{ fontSize: 11.5 }}>{f}</span><span>{n}</span></div>
          ))}
        </>
      )}
      <div className="note">
        Every run appends a start and a finish to one file, whoever runs it and from whichever folder
        (<code>scripts/workflow-run.ts</code>, docs/20). A start with no finish is shown as open, never as success.
        Usage is measured, estimated from local session metadata, or unknown — and unknown is not zero.
        Select a run for its checks, counts and usage.
      </div>
    </>
  );

  return (
    <Page crumbs={[{ label: SECTION.developer }, { label: 'Workflows' }]} inspector={inspector}>
      <div className="lbl">Developer</div>
      <h1>Workflows</h1>
      <p className="sublede">
        Every workflow run — research, imports and dev tasks — from the one ledger that Claude, ChatGPT and scripts
        all append to, wherever they ran: what ran, what it produced and cost, what each iteration learned, and how
        the protocols changed.
      </p>

      {ledger.error ? (
        <div className={`card ${s.state}`}>
          <div className="chead"><h2>The run ledger can’t be read here</h2><Outcome outcome="unavailable" /></div>
          <div className="cbody">
            <div className={s.facts}>
              <span>What is known</span><span>{ledger.error}</span>
              <span>Who can act</span><span>Claude or ChatGPT, from the live folder, where runs are recorded.</span>
              <span>Safe next step</span><span>Nothing is shown as zero: the counts are not loaded, not empty. Record runs with <code>scripts/workflow-run.ts begin|finish</code>.</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <nav className={s.filters} aria-label="Which runs">
            <Link href={query(sp, { family: null, w: null, run: null })} className={`${s.chip} ${!family && !wf ? s.on : ''}`}>All <b>{all.length}</b></Link>
            {FAMILIES.map((f) => {
              const n = all.filter((r) => r.family === f).length;
              return n ? (
                <Link key={f} href={query(sp, { family: f, w: null, run: null })} className={`${s.chip} ${family === f && !wf ? s.on : ''}`}>
                  {FAMILY_LABEL[f]} <b>{n}</b>
                </Link>
              ) : null;
            })}
            {wf && (
              <Link href={query(sp, { w: null, run: null })} className={`${s.chip} ${s.on}`} aria-label={`Clear the ${wf} filter`}>
                {wf}{picked ? ` · ${picked.name}` : ''} <span aria-hidden>×</span>
              </Link>
            )}
          </nav>

          <div className={`kpis ${s.kpis}`}>
            <div className="kpi">
              <div className="lbl">Runs</div>
              <div className="n">{scoped.length}</div>
              <div className="f">{scoped.filter((r) => !r.parentRunId).length} top-level, {scoped.filter((r) => r.parentRunId).length} inside another run{scopeWords ? ` · ${scopeWords}` : ''}</div>
            </div>
            <div className="kpi">
              <div className="lbl">Succeeded</div>
              <div className="n g">{done}<span className="of"> · {pct(done, scoped.length)}</span></div>
              <div className="f">{partial} partly done, {bad} failed or refused, {open} with no finish recorded.</div>
            </div>
            <div className="kpi">
              <div className="lbl">Items written</div>
              <div className="n">{written.toLocaleString('en-GB')}</div>
              <div className="f">Summed over runs, so an item rewritten counts again. Checks passed: {checksPass} of {checksAll} ({pct(checksPass, checksAll)}).</div>
            </div>
            <div className="kpi">
              <div className="lbl">Tokens in + out</div>
              <div className="n">{fmtTokens(sum(measured) + sum(estimated))}</div>
              <div className="f">
                {fmtTokens(sum(measured))} measured on {measured.length} runs, {fmtTokens(sum(estimated))} estimated on {estimated.length};
                {' '}{Math.max(0, unknownUsage)} unknown, {scripts} scripts with none.
              </div>
            </div>
          </div>

          {buckets.length > 0 && (
            <section className="card">
              <div className="chead">
                <h2>Over time</h2>
                <span className="lbl">{when(scoped.at(-1)?.startedAt ?? null)} – {when(scoped[0]?.startedAt ?? null)}</span>
              </div>
              <div className="cbody">
                <Timeline buckets={buckets} hours={hours} />
              </div>
            </section>
          )}

          <section className="card" id="by-workflow">
            <div className="chead">
              <h2>By workflow</h2>
              <span className="lbl">{scopedStats.length} workflows · newest first</span>
            </div>
            <div className={s.scroll}>
              <table className={`list ${s.table}`}>
                <thead>
                  <tr>
                    <th className={s.colName}>Workflow</th>
                    <th className={s.num}>Runs</th>
                    <th className={s.colOutcome}>Outcomes</th>
                    <th className={`${s.num} ${s.hideS}`}>Written</th>
                    <th className={`${s.num} ${s.hideS}`}>Checks</th>
                    <th className={`${s.num} ${s.hideM}`}>Tokens</th>
                    <th className={s.hideM}>Protocol</th>
                    <th className={s.num}>Last</th>
                  </tr>
                </thead>
                {FAMILIES.map((f) => {
                  const group = scopedStats.filter((x) => x.family === f);
                  if (!group.length) return null;
                  return (
                    <tbody key={f}>
                      <tr className={s.group}><td colSpan={8}><span className="lbl">{FAMILY_LABEL[f]}</span></td></tr>
                      {group.map((x) => (
                        <tr key={x.workflow} className={wf === x.workflow ? 'sel' : undefined}>
                          <td className={s.colName}>
                            <Link href={query(sp, { w: x.workflow, run: null, family: null })} className={s.wname}>
                              <span className={s.wkey}>{x.workflow}</span> {x.name !== x.workflow ? x.name : ''}
                            </Link>
                            <div className={s.sub}>{x.agents.slice(0, 2).join(', ')}{x.agents.length > 2 ? ` +${x.agents.length - 2}` : ''}</div>
                          </td>
                          <td className={s.num}>{x.runs}{x.runs !== x.top ? <div className={s.sub}>{x.top} top</div> : null}</td>
                          <td className={s.colOutcome}><OutcomeBar outcomes={x.outcomes} total={x.runs} /></td>
                          <td className={`${s.num} ${s.hideS}`}>{x.written.toLocaleString('en-GB')}</td>
                          <td className={`${s.num} ${s.hideS}`}>{x.checksAll ? pct(x.checksPass, x.checksAll) : '—'}<div className={s.sub}>{x.checksAll ? `${x.checksPass}/${x.checksAll}` : 'none'}</div></td>
                          <td className={`${s.num} ${s.hideM}`}>
                            {x.tokens.runsWithUsage ? fmtTokens(x.tokens.estimated + x.tokens.measured) : '—'}
                            <div className={s.sub}>{x.tokens.runsWithUsage ? `${x.tokens.runsWithUsage} of ${x.runs} known` : 'unknown'}</div>
                          </td>
                          <td className={s.hideM}>
                            <span className={`${s.ver} ${s.vcell}`}>{x.versions.at(-1)?.version}</span>
                            {x.versions.length > 1 && <div className={s.sub}>{x.versions.length} versions</div>}
                          </td>
                          <td className={`${s.num} nowrap`}>{x.last ? ago(x.last) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
            <p className="cover">
              <b>Outcome is the runner’s own report.</b> It is not acceptance: a run that succeeded wrote proposals, and a person
              still accepts them (AGENTS.md, invariant 4). Tokens are input plus output; cache reads are shown per run.
            </p>
          </section>

          <div className={s.two}>
            <section className="card">
              <div className="chead">
                <h2>How the protocols changed</h2>
                <span className="lbl">versions, in the order first used</span>
              </div>
              {versioned.length === 0 ? (
                <div className="cbody"><p className="muted">No workflow here has run on more than one protocol version.</p></div>
              ) : versioned.map((x) => (
                <div key={x.workflow} className={s.vrow}>
                  <Link href={query(sp, { w: x.workflow, run: null, family: null })} className={s.wname}>
                    <span className={s.wkey}>{x.workflow}</span> {x.name !== x.workflow ? x.name : ''}
                  </Link>
                  <ol className={s.versions}>
                    {x.versions.slice(-8).map((v) => (
                      <li key={v.version}>
                        <span className={s.ver}>{v.version}</span>
                        <span className={s.vmeta}>
                          {v.runs} run{v.runs === 1 ? '' : 's'}
                          {v.outcomes.succeeded !== v.runs ? ` · ${v.outcomes.succeeded} done` : ''}
                          {v.first ? ` · ${fmtDay(v.first)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {x.versions.length > 8 && <div className={s.sub}>and {x.versions.length - 8} earlier</div>}
                </div>
              ))}
            </section>

            <section className="card">
              <div className="chead">
                <h2>Protocol and runner changes</h2>
                <span className="lbl">commits · docs/workflows, agents, ledger</span>
              </div>
              {protocolLog.error ? (
                <div className="cbody"><p className="muted">Git history is not available on this server: {protocolLog.error}.</p></div>
              ) : protocolLog.commits.length === 0 ? (
                <div className="cbody"><p className="muted">No commit has touched the protocols yet.</p></div>
              ) : (
                <ul className={s.commits}>
                  {protocolLog.commits.map((c) => (
                    <li key={c.hash}>
                      <span className={s.when}>{fmtDay(c.at)}</span>
                      <span className={s.subject}>{c.subject}</span>
                      <span className={s.hash}>{c.short}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card" id="iterations">
            <div className="chead">
              <h2>Iterations and what they learned</h2>
              <span className="lbl">{noteCount} notes · enrich/log</span>
            </div>
            {notes.error ? (
              <div className="cbody"><p className="muted">{notes.error}</p></div>
            ) : noteCount === 0 ? (
              <div className="cbody">
                <p className="muted">No iteration notes here yet. Each research iteration writes one under <code>enrich/log/&lt;date&gt;/</code>: what it tried, what it found, what changes next.</p>
              </div>
            ) : notes.dates.map((d, di) => {
              const list = (d.notes).map((n) => {
                const run = n.runId ? byId.get(n.runId) : undefined;
                return (
                  <li key={n.file} className={s.note}>
                    <div className={s.ntitle}>
                      <Link href={`/dev/workflows/notes/${d.date}/${n.file}`}>{n.title}</Link>
                    </div>
                    {n.lede && <p className={s.lede}>{n.lede}</p>}
                    {run && (
                      <div className={s.nrun}>
                        <Outcome outcome={run.outcome} />
                        <Link href={query(sp, { run: run.runId })}>{run.workflow} · {run.operation}</Link>
                      </div>
                    )}
                  </li>
                );
              });
              const head = <><span className={s.day}>{fmtDay(new Date(`${d.date}T12:00:00`))}</span><span className="muted">{d.notes.length} note{d.notes.length === 1 ? '' : 's'}</span></>;
              return di === 0 ? (
                <div key={d.date} className={s.nday}>
                  <div className={s.dayhead}>{head}</div>
                  <ol className={s.notes} reversed>{[...list].reverse().slice(0, 12)}</ol>
                  {list.length > 12 && (
                    <details className={s.more}>
                      <summary>The {list.length - 12} earlier notes from this day</summary>
                      <ol className={s.notes}>{[...list].reverse().slice(12)}</ol>
                    </details>
                  )}
                </div>
              ) : (
                <details key={d.date} className={`${s.nday} ${s.more}`}>
                  <summary className={s.dayhead}>{head}</summary>
                  <ol className={s.notes}>{[...list].reverse()}</ol>
                </details>
              );
            })}
          </section>

          <section className="card" id="runs">
            <div className="chead">
              <h2>Runs</h2>
              <span className="lbl">{rows.length} of {scoped.length} · newest first</span>
            </div>
            {scoped.length === 0 ? (
              <div className="cbody"><p className="muted">No run matches this filter. That is the filter, not an empty ledger: <Link href={query(sp, { family: null, w: null })}>show every run</Link>.</p></div>
            ) : (
              <div className={s.scroll}>
                <table className={`list ${s.table}`}>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Run</th>
                      <th className={s.hideS}>Who</th>
                      <th>Outcome</th>
                      <th className={`${s.num} ${s.hideS}`}>Written</th>
                      <th className={`${s.num} ${s.hideM}`}>Checks</th>
                      <th className={`${s.num} ${s.hideM}`}>Tokens</th>
                      <th className={`${s.num} ${s.hideM}`}>Took</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.runId} className={selected?.runId === r.runId ? 'sel' : undefined}>
                        <td className="nowrap">
                          <span className={s.time}>{r.startedAt ? fmtHour(r.startedAt) : '—'}</span>
                          <div className={s.sub}>{r.startedAt ? fmtDay(r.startedAt) : 'not recorded'}</div>
                        </td>
                        <td>
                          <Link href={query(sp, { run: r.runId })} className={s.runlink}>
                            {r.parentRunId && <span className={s.child} aria-label="inside another run">↳</span>}
                            <span className={s.wkey}>{r.workflow}</span> {r.operation}
                          </Link>
                          <div className={s.sub}>{r.version ?? 'unversioned'}</div>
                        </td>
                        <td className={s.hideS}>{r.agent}<div className={s.sub}>{r.folder}</div></td>
                        <td><Outcome outcome={r.outcome} /></td>
                        <td className={`${s.num} ${s.hideS}`}>{r.counts?.written ?? '—'}<span className={s.of}>/{r.planned}</span></td>
                        <td className={`${s.num} ${s.hideM}`}>{r.checks.list.length ? `${r.checks.pass}/${r.checks.list.length}` : '—'}</td>
                        <td className={`${s.num} ${s.hideM}`}>
                          {r.usage && r.usage.source !== 'unknown' && (r.usage.input || r.usage.output)
                            ? <>{fmtTokens(r.usage.input + r.usage.output)}<div className={s.sub}>{r.usage.source}</div></>
                            : <span className="muted">{r.source === 'script' ? 'none' : 'unknown'}</span>}
                        </td>
                        <td className={`${s.num} ${s.hideM}`}>{r.finished ? dur(minutes(r)) : <span className="muted">open</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!showAll && scoped.length > ROWS && (
              <p className="cover"><Link href={query(sp, { all: '1' })}>Show all {scoped.length} runs</Link> — the newest {ROWS} are above.</p>
            )}
          </section>

          <p className="note">
            {OUTCOME_WORD.unknown} means a start without a finish: the run may still be going, or its launcher stopped.
            Check its output before retrying (docs/20). <Link href="/developer/agents">Agents</Link> is the app’s own runtime, which
            has not run a workflow yet; <Link href="/dev/logs">Logs</Link> shows these runs among commits and imports.
          </p>
        </>
      )}
    </Page>
  );
}

export default coalescePage('/dev/workflows', Workflows);
