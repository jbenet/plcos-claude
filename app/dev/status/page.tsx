import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { agent } from '@/lib/agent';
import { ago } from '@/lib/time';
import { listSyncSources } from '@/modules/platform';
import { MODULES } from '@/modules/manifest';
import { allSignals, heldBack } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';
import { circuitBreaker } from '@/modules/agents';
import { wrongWrapSends } from '@/modules/content';
import { poolChecks } from '@/modules/pipeline';
import { listConflicts } from '@/modules/coordination';
import { loadLedger } from '@/lib/workflows/view';
import { dakotaStatus, polarisStatus, type SourceState } from '@/lib/dev/sources';
import { responsivenessSnapshot } from '@/lib/responsiveness';
import st from './status.module.css';

const STATE_FLAG: Record<SourceState | string, string> = { ok: 'f-ok', partial: 'f-ev', failed: 'f-block', not_attached: 'f-mute' };
const STATE_WORD: Record<SourceState | string, string> = { ok: 'ok', partial: 'partial', failed: 'failed', not_attached: 'not attached' };

export const dynamic = 'force-dynamic';

async function Status() {
  const [db, a, sink, ag, sources, signals, held, breaker, wrongWrap, pools, conflicts] =
    await Promise.all([
      getDb(), auth(), issueSink(), agent(), listSyncSources(), allSignals(), heldBack(),
      circuitBreaker(), wrongWrapSends(), poolChecks(), listConflicts('open'),
    ]);

  const [migrations, ledger] = await Promise.all([
    db.query<{ id: string; applied_at: Date | string }>('select id, applied_at from platform.migration order by applied_at'),
    loadLedger(),
  ]);
  const [dakota, polaris] = await Promise.all([dakotaStatus(), polarisStatus(ledger.runs)]);
  const lastMigration = migrations.at(-1);
  const over = pools.filter((p) => p.status === 'over');

  /** Anything a person should look at, computed rather than curated. */
  const problems = [
    wrongWrap > 0 && { label: 'Wrong-wrap sends', detail: `${wrongWrap} sent despite a refusal. This is an incident, not a warning.`, href: '/materials' },
    breaker.frozen && { label: 'Agent autonomy frozen', detail: breaker.statement, href: '/agents' },
    over.length > 0 && { label: 'Conserved pool', detail: `${over.length} actor${over.length === 1 ? '' : 's'} committed beyond a verified budget.`, href: '/forecast' },
    conflicts.length > 0 && { label: 'Open conflicts', detail: `${conflicts.length} waiting on adjudication. Each needs a winner, a reason and a dated follow-up.`, href: '/operations' },
  ].filter(Boolean) as Array<{ label: string; detail: string; href: string }>;

  const services = [
    { name: 'Database', now: db.kind === 'pglite' ? 'PGlite, file on disk' : 'Postgres', ok: true, detail: `${migrations.length} migrations applied` },
    { name: 'Auth', now: `${a.kind} — user switcher`, ok: true, detail: a.switchable ? 'Switchable; no password simulated' : 'Fixed identity' },
    { name: 'Issue sink', now: sink.kind, ok: true, detail: sink.destination },
    config.data.profile === 'real'
      ? { name: 'Connectors', now: 'Affinity, read-only', ok: true, detail: 'The one connector this server runs (N38); Dakota and the warehouse reach it through workflows, below' }
      : { name: 'Connectors', now: 'fixture only', ok: true, detail: 'The demo attaches no external source; its Affinity is a fixture' },
    { name: 'Agent runtime', now: `${ag.kind} — ${ag.available ? 'available' : 'refuses'}`, ok: true, detail: ag.available ? 'A key is present' : 'No key, or no runtime: it refuses rather than guessing' },
    {
      name: 'Workflow ledger', now: ledger.where === 'demo' ? 'invented runs' : 'runs.jsonl, append-only', ok: !ledger.error,
      detail: ledger.error ?? `${ledger.runs.length} runs from ${ledger.label}${ledger.lastWrite ? ` · last write ${ago(ledger.lastWrite)}` : ''}${ledger.issues.length ? ` · ${ledger.issues.length} lines need review` : ''}`,
      href: '/dev/workflows',
    },
  ];
  const extra = [dakota, polaris];
  const responsiveness = responsivenessSnapshot();

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Status' }]}
      inspector={
        <>
          <div className="lbl">Right now</div>
          <div className="ihead">
            {problems.length === 0 ? 'Nothing needs attention' : `${problems.length} things to look at`}
          </div>
          <div className="imeta">Computed from the data, not from a checklist</div>
          <div className="kv">
            <span>Wrong-wrap sends</span>
            <span style={{ color: wrongWrap > 0 ? 'var(--clay)' : 'var(--green)' }}>{wrongWrap}</span>
          </div>
          <div className="kv">
            <span>Agent autonomy</span>
            <span>{breaker.frozen ? 'frozen' : 'not frozen'}</span>
          </div>
          <div className="kv">
            <span>Correction budget</span>
            <span>
              {breaker.hoursThisWeek.toFixed(1)} / {breaker.budgetHours} h
            </span>
          </div>
          {[...sources.map((x) => ({ k: x.source, label: x.label, w: x.status.replace('_', ' ') })), ...extra.map((x) => ({ k: x.key, label: x.label.replace(' (Polaris)', ''), w: STATE_WORD[x.state] }))].map((x) => (
            <div className="kv" key={x.k}>
              <span>{x.label}</span>
              <span>{x.w}</span>
            </div>
          ))}
          <div className="kv">
            <span>Module schemas</span>
            <span>{MODULES.length}</span>
          </div>
          <div className="kv">
            <span>Signals held back</span>
            <span>{held.length} of {signals.length}</span>
          </div>
          <div className="note">
            A threshold nobody can see is indistinguishable from a bug, so what the signal rules
            held back is listed below rather than dropped silently.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Status</h1>
      <p className="sublede">
        What is running, what is attached, and what a person should look at. The problems list is
        computed from the hard rules rather than maintained by hand.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Server responsiveness</h2>
          <span className="lbl">main event loop · measured locally</span>
        </div>
        <div className="cbody">
          {responsiveness ? <>
            <div className="fact"><span>Event-loop delay, p99</span><span>{responsiveness.p99Ms.toFixed(1)} ms</span></div>
            <div className="fact"><span>Longest delay</span><span>{responsiveness.maxMs.toFixed(1)} ms</span></div>
            <div className="fact"><span>Window</span><span>{(responsiveness.windowMs / 1000).toFixed(0)} s · ended {ago(new Date(responsiveness.at))}</span></div>
            <p className="muted">{responsiveness.p99Ms >= config.responsiveness.alertP99Ms
              ? 'The event loop exceeded the 200 ms p99 budget. Check recent imports and the server activity log.'
              : 'The event loop stayed within the 200 ms p99 budget for this window.'}
              {' '}This measures event-loop delay, not page or database response time. Refresh to see the next window.</p>
          </> : <p className="muted">Collecting the first {config.responsiveness.reportIntervalMs / 1000}-second window. Refresh after that interval to see the measured delay.</p>}
        </div>
        <p className="cover">P99 and maximum delay are recorded once per window in the local activity log. The monitor needs no database connection.</p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>{problems.length === 0 ? 'Nothing needs attention' : 'Needs attention'}</h2>
          <span className="lbl">derived from the domain rules</span>
        </div>
        {problems.length === 0 ? (
          <div className="cbody">
            <p className="muted">
              No wrong-wrap send, no frozen autonomy, no pool violation, no unadjudicated conflict.
              This is the computed state, not an assurance that nothing is wrong.
            </p>
          </div>
        ) : (
          problems.map((p) => (
            <Link className="row" key={p.label} href={p.href}>
              <span className="flag f-block" style={{ width: 150, textAlign: 'center' }}>{p.label}</span>
              <div className="t">
                <b style={{ fontWeight: 400, lineHeight: 1.5 }}>{p.detail}</b>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Sources</h2>
          <span className="lbl">every source read-only · {sources.length + extra.length} attached or expected</span>
        </div>
        <div className={st.scroll}>
          <table className={`list ${st.sources}`}>
            <thead>
              <tr>
                <th style={{ width: 118 }}>State</th>
                <th>Source</th>
                <th className={st.hideS}>What is here</th>
                <th className="right" style={{ width: 110 }}>Last</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((x) => (
                <tr key={x.source}>
                  <td><span className={`flag ${x.status === 'ok' ? 'f-ok' : x.status === 'stale' ? 'f-ev' : x.status === 'failed' ? 'f-block' : 'f-mute'} ${st.state}`}>{x.status.replace('_', ' ')}</span></td>
                  <td>
                    <b className={st.name}>{x.label}</b>
                    <div className={st.access}>{x.source === 'init' ? 'Our own file, read at start' : x.source === 'seed' ? 'Invented fixtures' : x.source === 'affinity' && x.status !== 'not_connected' ? 'Read-only · synced by this server' : 'Planned · nothing reads it yet'}</div>
                    <div className={`${st.facts} ${st.showS}`}>{x.detail}</div>
                  </td>
                  <td className={`${st.hideS} ${st.facts}`}>{x.detail}</td>
                  <td className={`right ${st.when}`}>{x.lastSyncAt ? ago(x.lastSyncAt) : '—'}</td>
                </tr>
              ))}
              {extra.map((x) => (
                <tr key={x.key}>
                  <td><span className={`flag ${STATE_FLAG[x.state]} ${st.state}`}>{STATE_WORD[x.state]}</span></td>
                  <td>
                    <b className={st.name}>{x.label}</b>
                    <div className={st.access}>{x.access}</div>
                    <ul className={`${st.factlist} ${st.showS}`}>{x.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                  </td>
                  <td className={st.hideS}>
                    <ul className={st.factlist}>{x.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                    <div className={st.fnote}>{x.note}</div>
                  </td>
                  <td className={`right ${st.when}`}>
                    {x.lastAt ? ago(x.lastAt) : '—'}
                    {x.lastWhat && <div className={st.what}>{x.lastWhat}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cover">
          <b>Nothing here writes back.</b> Affinity is synced by this server through its read-only client; Dakota and the
          warehouse are read by workflows, recorded on <Link href="/dev/workflows">Workflows</Link>, and land in files first.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Services</h2>
          <span className="lbl">what each seam resolved to</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Service</th>
              <th style={{ width: 260 }}>Running</th>
              <th>Detail</th>
              <th style={{ width: 90 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name}>
                <td><b>{'href' in s && s.href ? <Link href={s.href}>{s.name}</Link> : s.name}</b></td>
                <td className="muted">{s.now}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{s.detail}</td>
                <td>
                  <span className={`flag ${s.ok ? 'f-ok' : 'f-mute'}`}>{s.ok ? 'up' : 'unavailable'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <Link href="/dev/connectors">Connectors</Link> has the detail on what each seam swaps to
          and why the swap stays cheap.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Signal thresholds</h2>
          <span className="lbl">
            {signals.length} observed · {held.length} held back by a rule
          </span>
        </div>
        <div className="cbody">
          <div className="fact">
            <span>Minimum confidence</span>
            <span>{config.signals.minConfidence} · GUESS</span>
          </div>
          <div className="fact">
            <span>Freshness window</span>
            <span>{config.signals.freshDays} days · GUESS</span>
          </div>
          <div className="fact">
            <span>Personnel: decision-makers only</span>
            <span>{config.signals.decisionMakerOnly ? 'yes' : 'no'} · GUESS</span>
          </div>
        </div>
        {held.map((s) => (
          <div key={s.signalId}>
            <div className="lbl" style={{ padding: '10px 15px 0', color: 'var(--clay)' }}>
              Held back by {s.confidence === 'low' ? 'the confidence floor' : 'the freshness window'}
            </div>
            <SignalRow signal={s} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Migrations</h2>
          <span className="lbl">manifest order, then filename order</span>
        </div>
        <div className="cbody">
          <p className={st.mline}>
            <b>{migrations.length} applied</b>
            {lastMigration && <> · the latest, <code>{lastMigration.id}</code>, {ago(new Date(lastMigration.applied_at))}</>}.
            {' '}Applied migrations are never edited; a change is a new file.
          </p>
        </div>
        <details className={st.more}>
          <summary>Every migration, in the order applied</summary>
          <table className={`list ${st.migrations}`}>
            <tbody>
              {migrations.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  <td className="muted right">{ago(new Date(m.applied_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Page>
  );
}

export default coalescePage('/dev/status', Status);
