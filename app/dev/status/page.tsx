import Link from 'next/link';
import { Page } from '@/components/shell/Page';
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

export const dynamic = 'force-dynamic';

export default async function Status() {
  const [db, a, sink, ag, sources, signals, held, breaker, wrongWrap, pools, conflicts] =
    await Promise.all([
      getDb(), auth(), issueSink(), agent(), listSyncSources(), allSignals(), heldBack(),
      circuitBreaker(), wrongWrapSends(), poolChecks(), listConflicts('open'),
    ]);

  const migrations = await db.query<{ id: string; applied_at: Date | string }>(
    'select id, applied_at from platform.migration order by applied_at',
  );
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
    { name: 'Connectors', now: 'fixture only', ok: true, detail: 'No external source before L13, by design' },
    { name: 'Agent runtime', now: `${ag.kind} — ${ag.available ? 'available' : 'refuses'}`, ok: true, detail: ag.available ? 'A key is present' : 'No key, or no runtime: it refuses rather than guessing' },
  ];

  return (
    <Page
      crumbs={[{ label: 'Developer' }, { label: 'Status' }]}
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
                <td><b>{s.name}</b></td>
                <td className="muted">{s.now}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{s.detail}</td>
                <td>
                  <span className="flag f-ok">up</span>
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
          <h2>Sources</h2>
          <span className="lbl">no connector before L13</span>
        </div>
        {sources.map((s) => (
          <div className="row" key={s.source}>
            <span className={`flag ${s.status === 'ok' ? 'f-ok' : 'f-mute'}`} style={{ width: 110, textAlign: 'center' }}>
              {s.status.replace('_', ' ')}
            </span>
            <div className="t">
              <b>{s.label}</b>
              <span>{s.detail}</span>
            </div>
            <div className="state">{s.lastSyncAt ? ago(s.lastSyncAt) : '—'}</div>
          </div>
        ))}
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
        <table className="list">
          <tbody>
            {migrations.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.id}</td>
                <td className="muted right">{ago(new Date(m.applied_at))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
