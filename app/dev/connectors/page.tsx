import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { agent } from '@/lib/agent';
import { ago } from '@/lib/time';
import { listSyncSources } from '@/modules/platform';
import { allSignals } from '@/modules/signals';

export const dynamic = 'force-dynamic';

const INVARIANTS = [
  {
    rule: 'Everything lands raw first',
    detail:
      'Normalization is a separate, replayable step. When a mapping is wrong — and it will be — ' +
      're-normalize from what landed rather than re-fetching from a rate-limited API.',
  },
  {
    rule: 'Idempotent on (source, source_id, source_updated_at)',
    detail: 'Re-delivery is free. The signals ingest already relies on this and can be run twice.',
  },
  {
    rule: 'onWebhook returns invalidations, never data',
    detail:
      'Even for signed sources. One code path, and the source that cannot be trusted to push ' +
      'correct data becomes the default rather than the exception.',
  },
];

export default async function Connectors() {
  const [db, a, sink, ag, sources, signals] = await Promise.all([
    getDb(), auth(), issueSink(), agent(), listSyncSources(), allSignals(),
  ]);

  const seams = [
    {
      name: 'Db',
      now: db.kind === 'pglite' ? 'PGlite, file on disk' : 'Postgres via DATABASE_URL',
      later: 'Managed Postgres — the swap is a connection string',
      cheap: `${config.db.url ? 'DATABASE_URL set' : config.db.localDir} · nothing outside lib/db imports a driver`,
    },
    {
      name: 'AuthProvider',
      now: `${a.kind} — user switcher in the rail`,
      later: 'PL LabOS kit at D1',
      cheap: 'Identity is a cookie holding a handle. No password is simulated.',
    },
    {
      name: 'IssueSink',
      now: `${sink.kind} — ${sink.destination}`,
      later: 'GitHubIssueSink at D2',
      cheap: 'The feedback box calls create(). It knows nothing about either implementation.',
    },
    {
      name: 'Connector<T>',
      now: `fixture — ${signals.length} signals ingested through it`,
      later: 'Affinity, Linear, Drive, DocSend at L13',
      cheap: 'The three invariants below are fixed now, so a real source changes the connector and nothing above it.',
    },
    {
      name: 'Agent',
      now: `${ag.kind} — ${ag.available ? 'available' : 'refuses'}`,
      later: 'A live model, once a prompt has passed the protected set',
      cheap: 'Refuses by name rather than returning a plausible-looking answer.',
    },
  ];

  return (
    <Page
      crumbs={[{ label: 'Developer' }, { label: 'Connectors' }]}
      inspector={
        <>
          <div className="lbl">Open questions</div>
          <div className="ihead">Still unanswered</div>
          <div className="imeta">These change the connector design, not just the schedule</div>
          <div className="prov">
            <div className="p1">Affinity plan tier</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              Data Share (Enterprise) versus poll-first. Currently{' '}
              <code>{config.affinity.syncMode}</code>, tier {String(config.affinity.tier)}.
            </div>
          </div>
          <div className="prov">
            <div className="p1">Warehouse access</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              Own schema with write permission for canon tables? Currently{' '}
              <code>{config.warehouse.canonMode}</code>.
            </div>
          </div>
          <div className="prov">
            <div className="p1">Linear custom fields</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              UNVERIFIED in all three design packages. Check the live GraphQL schema before
              anything depends on it.
            </div>
          </div>
          <div className="note">
            Nothing in the system depends on any of these yet, which is the point of answering
            them before building rather than after.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Connectors</h1>
      <p className="sublede">
        Five external dependencies, each behind an interface with a local implementation and a
        second implementation that refuses with a sentence rather than falling back silently.
      </p>

      <div className="card">
        <div className="chead">
          <h2>The five seams</h2>
          <span className="lbl">local now · live later</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 130 }}>Seam</th>
              <th style={{ width: 250 }}>Running now</th>
              <th style={{ width: 240 }}>Swaps to</th>
              <th>How the swap stays cheap</th>
            </tr>
          </thead>
          <tbody>
            {seams.map((s) => (
              <tr key={s.name}>
                <td className="mono"><b>{s.name}</b></td>
                <td>{s.now}</td>
                <td className="muted">{s.later}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{s.cheap}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The connector contract</h2>
          <span className="lbl">three invariants, fixed from L1</span>
        </div>
        {INVARIANTS.map((i) => (
          <div className="row" key={i.rule} style={{ alignItems: 'flex-start' }}>
            <div className="t">
              <b>{i.rule}</b>
              <span style={{ display: 'block', lineHeight: 1.55 }}>{i.detail}</span>
            </div>
          </div>
        ))}
        <p className="cover">
          The signals ingest is the only thing that uses this today, and it reads a fixture. That
          is deliberate: proving the product against the contract rather than against a vendor is
          what makes the ninth external database cheap instead of bespoke.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Sources</h2>
          <span className="lbl">{sources.filter((s) => s.status === 'ok').length} of {sources.length} attached</span>
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
            <div className="state">{s.lastSyncAt ? ago(s.lastSyncAt) : 'never'}</div>
          </div>
        ))}
      </div>
    </Page>
  );
}
