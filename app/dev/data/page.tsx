import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { headers } from 'next/headers';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { lockFile } from '@/lib/db/lock';
import { ago } from '@/lib/time';
import { QUESTIONS, TEMPLATE_PATH, readInit } from '@/lib/real/init';
import { listSyncSources } from '@/modules/platform';
import { reloadInit } from './actions';

export const dynamic = 'force-dynamic';

/** The two profiles, side by side. The current one is marked; the words carry it. */
const PROFILES: Array<{ fact: string; demo: string; real: string }> = [
  { fact: 'What it is', demo: 'Fictional people, firms and amounts', real: 'The raise: Affinity’s records, and what we write about them' },
  { fact: 'Started with', demo: 'npm run dev', real: 'npm run dev:real' },
  { fact: 'Served at', demo: 'port 3000, reachable from the local network', real: '127.0.0.1:3100, this machine only' },
  { fact: 'Kept in', demo: 'data/demo/', real: 'data/real/' },
  { fact: 'Starts from', demo: 'fixtures/, seeded when the database is empty', real: 'data/real/init.jsonc, which you fill in' },
  { fact: 'Reset', demo: 'npm run demo, any time', real: 'Refused. It holds judgements that exist nowhere else' },
  { fact: 'Screenshots', demo: 'npm run shots, committed and published in the build log', real: 'Refused' },
  { fact: 'Feedback goes to', demo: 'issues/, committed with its fix', real: 'data/real/issues/, never committed' },
];

/** Every place that refuses to move real data somewhere it should not go, and where it lives. */
const GUARDS: Array<{ rule: string; where: string }> = [
  { rule: 'Git ignores everything under data/ except its README.', where: '.gitignore' },
  { rule: 'Seeding refuses the real profile. The check is in the seed itself, not only in the script.', where: 'lib/seed.ts' },
  { rule: 'db:reset and npm run demo refuse the real profile.', where: 'scripts/reset.ts' },
  { rule: 'Screenshots ask the server which data it is showing, and stop unless it says demo.', where: 'scripts/shots.ts · /api/profile' },
  { rule: 'Feedback filed from the real profile, pictures included, stays in data/real/issues/.', where: 'config.issues.dir' },
  { rule: 'The real server listens on 127.0.0.1, so nothing else on the network can reach it.', where: 'package.json · next.config.ts' },
  { rule: 'In the real profile DATABASE_URL is refused and PGLITE_DIR is ignored, so neither can move the data.', where: 'config/deployment.ts' },
  { rule: 'A second process opening the same database is refused by name instead of corrupting it.', where: 'lib/db/lock.ts' },
  { rule: 'The property harness always runs on a scratch copy of the demo.', where: 'scripts/properties.ts' },
  { rule: 'The two servers keep separate cookies, so who you are in one is not who you are in the other.', where: 'config.data.cookiePrefix' },
];

export default async function DataPage() {
  const profile = config.data.profile;
  const [host, lockPid, sources, report] = await Promise.all([
    headers().then((h) => h.get('host') ?? 'unknown'),
    getDb().then(() => readFile(join(process.cwd(), lockFile(config.db.localDir)), 'utf8').then((t) => Number(t.trim()), () => null)),
    listSyncSources(),
    profile === 'real' ? readInit() : Promise.resolve(null),
  ]);
  const initSource = sources.find((s) => s.source === 'init');
  const people = report?.init?.team.length ?? 0;
  const vehicles = report?.init?.vehicles.length ?? 0;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Data' }]}
      inspector={
        <>
          <div className="lbl">Where real data may go</div>
          <div className="ihead">This machine, and data/real/</div>
          <div className="imeta">Nowhere else, through anything in this repository.</div>
          <div className="scope">
            <div className="lbl">Never</div>
            <p>
              A commit. The changelog or the published build log. A screenshot. An issue in
              issues/. A web search. A prompt to a sub-agent. Changelog entries about real-data
              work use counts and invented examples.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Affinity is read-only</div>
            <p>
              The API key can write, and cannot be limited. So the client that arrives next
              sends GET requests only, to a fixed list of paths, and a property test proves
              that anything else throws before it leaves the machine.
            </p>
          </div>
          <div className="note">The whole plan, with your decisions, is docs/15-affinity-integration.md.</div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Data</h1>
      <p className="sublede">
        Which data this server is showing, where it is kept, and what refuses to move it. There
        are two profiles. They never share a database, a folder, a port or a cookie.
      </p>

      <div className="card">
        <div className="chead">
          <h2>This server</h2>
          <span className={`profile p-${profile}`}>{profile === 'real' ? 'Real data' : 'Demo data'}</span>
        </div>
        <div className="cbody">
          <div className="fact"><span>Profile</span><span>{profile}</span></div>
          <div className="fact"><span>Opened as</span><span className="mono">{host}</span></div>
          <div className="fact"><span>Folder</span><span className="mono">{config.data.root}/</span></div>
          <div className="fact">
            <span>Database</span>
            <span className="mono">
              {config.db.url ? 'DATABASE_URL' : config.db.localDir}
              {lockPid ? ` · held by ${lockPid === process.pid ? 'this server' : `pid ${lockPid}`}` : ''}
            </span>
          </div>
          <div className="fact"><span>Feedback</span><span className="mono">{config.issues.dir}/</span></div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The two profiles</h2>
          <span className="lbl">you are in {profile}</span>
        </div>
        <table className="list profiles">
          <thead>
            <tr>
              <th />
              <th className={profile === 'demo' ? 'here' : undefined}>Demo{profile === 'demo' ? ' · this one' : ''}</th>
              <th className={profile === 'real' ? 'here' : undefined}>Real{profile === 'real' ? ' · this one' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {PROFILES.map((p) => (
              <tr key={p.fact}>
                <td className="muted">{p.fact}</td>
                <td className={profile === 'demo' ? 'here' : undefined}>{p.demo}</td>
                <td className={profile === 'real' ? 'here' : undefined}>{p.real}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {profile === 'real' && report ? (
        <div className="card">
          <div className="chead">
            <h2>Init file</h2>
            <span className="lbl mono">{report.path}</span>
          </div>
          <div className="cbody">
            <div className="fact">
              <span>Last loaded</span>
              <span>{initSource?.lastSyncAt ? ago(initSource.lastSyncAt) : 'never'}</span>
            </div>
            <div className="fact">
              <span>In the file now</span>
              <span>
                {report.init ? `${people} ${people === 1 ? 'person' : 'people'} · ${vehicles} vehicles` : 'cannot be read'}
              </span>
            </div>
            {report.problems.length > 0 && (
              <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                <b>Not loaded — the file has {report.problems.length === 1 ? 'a problem' : `${report.problems.length} problems`}.</b>
                <ul>
                  {report.problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
                Loading is all or nothing, so the database still holds the last good load.
              </div>
            )}
            <form action={reloadInit} style={{ marginTop: 12 }}>
              <button className="btn p" type="submit">Load the file again</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
                Adds and updates. Never deletes.
              </span>
            </form>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="chead">
            <h2>Init file</h2>
            <span className="lbl">real profile only</span>
          </div>
          <div className="cbody">
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              The real profile starts from a file you fill in, not from fixtures. The first
              time <span className="mono">npm run dev:real</span> starts, it copies{' '}
              <span className="mono">{TEMPLATE_PATH}</span> to{' '}
              <span className="mono">data/real/init.jsonc</span>. Then open{' '}
              <span className="mono">http://127.0.0.1:3100/dev/data</span> to see what it still asks.
            </p>
            <div className="lbl" style={{ margin: '12px 0 6px' }}>Beyond people and vehicles, it asks</div>
            <ol className="asks">
              {Object.values(QUESTIONS).map((q) => <li key={q}>{q}</li>)}
            </ol>
          </div>
        </div>
      )}

      {profile === 'real' && report?.init && (
        <div className="card">
          <div className="chead">
            <h2>Still unanswered</h2>
            <span className="lbl">{report.open.length} open</span>
          </div>
          {report.open.length === 0 ? (
            <div className="cbody">Nothing. Every question in the file has an answer.</div>
          ) : (
            <table className="list">
              <tbody>
                {report.open.map((q) => (
                  <tr key={q.where}>
                    <td style={{ width: '36%' }} className="mono muted">{q.where}</td>
                    <td>{q.ask}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="cover">
            <b>Coverage:</b> the questions this file knows how to ask. The questions about what
            Affinity&rsquo;s fields mean come after the connection test has listed them.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>What refuses to move real data</h2>
          <span className="lbl">{GUARDS.length} guards</span>
        </div>
        <table className="list">
          <tbody>
            {GUARDS.map((g) => (
              <tr key={g.rule}>
                <td>{g.rule}</td>
                <td className="mono muted" style={{ width: '30%', fontSize: 11.5 }}>{g.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
