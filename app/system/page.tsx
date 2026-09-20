import { Page } from '@/components/shell/Page';
import { config, GUESSED_CONSTANTS } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { agent } from '@/lib/agent';
import { listSyncSources } from '@/modules/platform';
import { MODULES } from '@/modules/manifest';
import { allSignals, heldBack } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';
import { ago } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function System() {
  const [db, a, sink, ag, sources, signals, held] = await Promise.all([
    getDb(), auth(), issueSink(), agent(), listSyncSources(), allSignals(), heldBack(),
  ]);
  const migrations = await db.query<{ id: string; applied_at: Date | string }>(
    'select id, applied_at from platform.migration order by applied_at',
  );
  const counts = await db.query<{ table_name: string; n: string }>(
    `select 'app_user' as table_name, count(*)::text as n from platform.app_user
     union all select 'vehicle', count(*)::text from platform.vehicle
     union all select 'feedback', count(*)::text from platform.feedback
     union all select 'audit_log', count(*)::text from platform.audit_log
     union all select 'source_sync', count(*)::text from platform.source_sync`,
  );

  const seams = [
    {
      name: 'Db',
      now: db.kind === 'pglite' ? 'PGlite, file on disk' : 'Postgres via DATABASE_URL',
      later: 'Managed Postgres — the swap is a connection string',
      detail: `${config.db.url ? 'DATABASE_URL set' : config.db.localDir} · nothing outside lib/db imports a driver`,
      ok: true,
    },
    {
      name: 'AuthProvider',
      now: `${a.kind} — user switcher in the rail`,
      later: 'PL LabOS kit at D1',
      detail: a.switchable ? 'Identity is a cookie holding a handle. No password is simulated.' : 'Switching disabled',
      ok: true,
    },
    {
      name: 'IssueSink',
      now: `${sink.kind} — ${sink.destination}`,
      later: 'GitHubIssueSink at D2',
      detail: 'The feedback box calls create(). It knows nothing about either implementation.',
      ok: true,
    },
    {
      name: 'Connector<T>',
      now: 'fixture only',
      later: 'Affinity, Linear, Drive, DocSend at L13',
      detail: 'Contract exists from L1: land raw first, idempotent on (source, source_id, source_updated_at), webhooks return invalidations.',
      ok: true,
    },
    {
      name: 'Agent',
      now: `${ag.kind} — ${ag.available ? 'available' : 'refuses'}`,
      later: 'Work envelopes, run pinning and the regression harness at L13',
      detail: ag.available
        ? 'A key is present.'
        : 'No key, or no runtime. It refuses by name rather than returning a plausible-looking answer.',
      ok: true,
    },
  ];

  return (
    <Page
      crumbs={[{ label: 'System & seams' }]}
      inspector={
        <>
          <div className="lbl">Database</div>
          <div className="ihead">{db.kind}</div>
          <div className="imeta">{migrations.length} migration{migrations.length === 1 ? '' : 's'} applied</div>
          {counts.map((c) => (
            <div className="kv" key={c.table_name}>
              <span className="mono" style={{ fontSize: 11.5 }}>
                platform.{c.table_name}
              </span>
              <span>{c.n}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Modules</div>
            <p>
              {MODULES.length} registered, one Postgres schema each. Cross-module joins are meant
              to fail rather than be frowned upon.
            </p>
          </div>
          <div className="note" style={{ marginTop: 0 }}>
            Reset with <code>npm run db:reset</code>. Issues are files, so they survive it.
          </div>
        </>
      }
    >
      <div className="lbl">L1 · the part that has to be right before twelve more stages sit on it</div>
      <h1>System &amp; seams</h1>
      <p className="sublede">
        Five external dependencies, each behind an interface with a local implementation. This page
        exists so that &ldquo;the seam is real&rdquo; is a thing you can check rather than a thing
        someone claims.
      </p>

      <div className="card">
        <div className="chead">
          <h2>The five seams</h2>
          <span className="lbl">local now · live later</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Seam</th>
              <th style={{ width: 240 }}>Running now</th>
              <th style={{ width: 240 }}>Swaps to</th>
              <th>How the swap stays cheap</th>
            </tr>
          </thead>
          <tbody>
            {seams.map((s) => (
              <tr key={s.name}>
                <td className="mono">
                  <b>{s.name}</b>
                </td>
                <td>{s.now}</td>
                <td className="muted">{s.later}</td>
                <td className="muted">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Constants that are guesses</h2>
            <span className="lbl">config/deployment.ts</span>
          </div>
          {GUESSED_CONSTANTS.map((g) => (
            <div className="row" key={g.path} style={{ alignItems: 'flex-start' }}>
              <span className="kind k-stage" style={{ width: 54, marginTop: 2 }}>
                GUESS
              </span>
              <div className="t">
                <b className="mono" style={{ fontSize: 12 }}>
                  {g.path} = {g.value}
                </b>
                <span>{g.why}</span>
              </div>
            </div>
          ))}
          <div className="cover">
            <b>Coverage:</b> this lists every constant explicitly marked as a guess in{' '}
            <code>config/deployment.ts</code>. It does not certify that other numbers in the system
            came from somewhere solid — only that these are known not to have.
          </div>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Sources</h2>
            <span className="lbl">no connector before L13</span>
          </div>
          {sources.map((s) => (
            <div className="row" key={s.source}>
              <span className={`flag ${s.status === 'ok' ? 'f-ok' : 'f-mute'}`} style={{ width: 104, textAlign: 'center' }}>
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
        <p className="cover">
          <b>These were observed and not shown on Today.</b> A threshold nobody can see is
          indistinguishable from a bug, so what it held back is listed here rather than dropped
          silently.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Migrations</h2>
          <span className="lbl">applied in manifest order, then filename order</span>
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
