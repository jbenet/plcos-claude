import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago } from '@/lib/time';
import { ALLOWED, affinityReady, readScopes } from '@/lib/connectors/affinity';
import { discovered } from '@/lib/connectors/affinity/discover';
import { latestConnectionTest, recentRequests, requestsThisMonth, type RateWindow } from '@/modules/sources';
import { runConnectionTest } from './actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');

function resetIn(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

function Window({ label, w, unit }: { label: string; w: RateWindow; unit: string }) {
  const pct = w.limit > 0 ? Math.min(100, Math.round((w.used / w.limit) * 100)) : 0;
  return (
    <div className="budgetrow">
      <div className="bt">
        <span>{label}</span>
        <span className="mono">{n(w.used)} of {n(w.limit)} used · {n(w.remaining)} left · resets in {resetIn(w.reset)}</span>
      </div>
      <div className="bbar" role="img" aria-label={`${pct}% of the ${unit} budget used`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AffinityPage() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [test, log, ours, lists] = await Promise.all([
    latestConnectionTest('affinity'),
    recentRequests('affinity', 40),
    requestsThisMonth('affinity'),
    discovered().then((d) => ({ run: d.run, count: d.lists.length })),
  ]);
  const month = test?.perMonth ?? null;
  const share = month ? Math.floor(month.limit * config.affinity.monthlyShare) : null;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity' }]}
      inspector={
        <>
          <div className="lbl">Read-only</div>
          <div className="ihead">GET, to {ALLOWED.length} paths, and nothing else</div>
          <div className="imeta">Enforced in lib/connectors/affinity/fetch.ts</div>
          <div className="scope">
            <div className="lbl">Why in code</div>
            <p>
              The key can write, and Affinity has no way to limit a key. So the one function
              that sends requests refuses any method but GET, any body, any host but
              Affinity&rsquo;s and any redirect — before <code>fetch</code> is called. The
              property harness proves it on every run.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">A better credential, later</div>
            <p>
              Affinity&rsquo;s OAuth has an <code>api.read</code> scope: a token Affinity itself
              refuses to write with. If an OAuth client can be registered for this tool, that
              would make read-only true on both sides.
            </p>
          </div>
          <div className="note">The plan and the decisions behind it: docs/15-affinity-integration.md.</div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Affinity, read-only</h1>
      <p className="sublede">
        What this server may ask Affinity, what it has asked, and what Affinity said about the
        key and the budget. Nothing is written back.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>
            This page is talking to a fake Affinity served from <code>fixtures/affinity/</code>,
            with an invented account. Nothing in the demo profile can reach Affinity: the client
            refuses to build an HTTPS transport here.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Connection</h2>
          <span className={`flag ${ready.ready ? 'f-ok' : 'f-block'}`}>{ready.ready ? (demo ? 'fake, ready' : 'key present') : 'no key'}</span>
        </div>
        <div className="cbody">
          <p style={{ margin: '0 0 12px', fontSize: 13 }}>{ready.why}</p>
          <form action={runConnectionTest}>
            <button className="btn p" type="submit" disabled={!ready.ready}>Test the connection</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              Two GET requests: <code>/v2/auth/whoami</code> and <code>/v2/rate-limit</code>.
            </span>
          </form>

          {test && (
            <div style={{ marginTop: 16 }}>
              <div className="fact">
                <span>Last test</span>
                <span>
                  {test.ok ? 'answered' : 'failed'} · {ago(test.at)}{test.testedByName ? ` · by ${test.testedByName}` : ''}
                </span>
              </div>
              {test.ok ? (
                <>
                  <div className="fact"><span>Account</span><span>{test.tenant?.name} · {test.tenant?.subdomain}.affinity.co</span></div>
                  <div className="fact">
                    <span>Whose key</span>
                    <span>{[test.keyUser?.firstName, test.keyUser?.lastName].filter(Boolean).join(' ')} · {test.keyUser?.emailAddress}</span>
                  </div>
                  <div className="fact">
                    <span>What it may do</span>
                    <span>{test.grant?.type} · {test.grant?.scopes.join(', ') || 'no scopes listed'}</span>
                  </div>
                  {test.grant && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>{readScopes(test.grant.scopes)}</p>}
                  <div className="fact"><span>Plan tier</span><span>{test.tier ?? 'not read'}</span></div>
                </>
              ) : (
                <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                  <b>{test.error}</b>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2><Link href="/dev/affinity/lists">Lists</Link></h2>
          <span className="lbl">{lists.run ? `discovered ${ago(lists.run.startedAt)}` : 'not discovered yet'}</span>
        </div>
        <div className="cbody">
          <p style={{ margin: 0, fontSize: 13 }}>
            {lists.run
              ? `${lists.count} lists this key can see. `
              : 'Which lists the key can see, their fields, and how they match the init file. '}
            <Link href="/dev/affinity/lists">Open the lists →</Link>{' '}
            <Link href="/dev/affinity/slice">The first slice →</Link>{' '}
            <Link href="/dev/affinity/notes">Notes →</Link>{' '}
            <Link href="/dev/affinity/inventory">Inventory →</Link>{' '}
            <Link href="/dev/affinity/mapping">Mapping →</Link>
          </p>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Budget</h2>
          <span className="lbl">{test?.ok ? `as read ${ago(test.at)}` : 'not read yet'}</span>
        </div>
        <div className="cbody">
          {test?.perMinute && <Window label="This key, per minute" w={test.perMinute} unit="per-minute" />}
          {month ? (
            <Window label="The whole account, this month" w={month} unit="monthly" />
          ) : test?.ok ? (
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>No monthly cap on this account.</p>
          ) : null}
          <div className="fact">
            <span>This tool, this month</span>
            <span>{n(ours)} requests{share !== null ? ` of its ${n(share)} share (${Math.round(config.affinity.monthlyShare * 100)}%)` : ''}</span>
          </div>
          <div className="fact">
            <span>Stops when</span>
            <span>
              the account has under {Math.round(config.affinity.monthlyFloor * 100)}% of its month left, or this tool has used its share
            </span>
          </div>
          <div className="fact"><span>Pace</span><span>at most {config.affinity.maxPerMinute} a minute, a third of Affinity&rsquo;s limit</span></div>
          <p className="cover">
            <b>Coverage:</b> the account&rsquo;s numbers are Affinity&rsquo;s, from the last test.
            This tool&rsquo;s count is from its own request log. The share, the floor and the pace
            are guesses in <code>config/deployment.ts</code>, and say so on Developer → Settings.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>What this server may ask</h2>
          <span className="lbl">GET only · {ALLOWED.length} paths</span>
        </div>
        <table className="list">
          <tbody>
            {ALLOWED.map((e) => (
              <tr key={e.template}>
                <td className="mono" style={{ width: '44%', fontSize: 12 }}>
                  GET {e.template}
                  {e.beta && <span className="flag f-mute" style={{ marginLeft: 8 }}>beta</span>}
                </td>
                <td>{e.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Anything else is refused before it leaves the machine</b>, and the refusal is logged
          below. The paths come from Affinity&rsquo;s OpenAPI description (v2, 2026-07-15). The
          entries on a list, and notes, are added in the versions that read them.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Request log</h2>
          <span className="lbl">last {log.length} · path, status, time — never a body</span>
        </div>
        {log.length === 0 ? (
          <div className="cbody">Nothing has been asked yet.</div>
        ) : (
          <table className="list">
            <thead>
              <tr><th>When</th><th>Outcome</th><th>Endpoint</th><th>Status</th><th>Time</th><th>Left this minute</th></tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{ago(r.at)}</td>
                  <td>
                    <span className={`flag ${r.outcome === 'sent' && r.status && r.status < 300 ? 'f-ok' : r.outcome === 'refused' ? 'f-block' : 'f-mute'}`}>
                      {r.outcome.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {r.endpoint}
                    {r.note && <div className="muted" style={{ fontFamily: 'var(--sans)', fontSize: 11.5 }}>{r.note}</div>}
                  </td>
                  <td className="mono">{r.status ?? '—'}</td>
                  <td className="mono">{r.durationMs !== null ? `${r.durationMs} ms` : '—'}</td>
                  <td className="mono">{r.userRemaining ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
