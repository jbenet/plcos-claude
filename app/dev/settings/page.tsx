import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { PrefsReset } from '@/components/shell/PrefsReset';
import { config, GUESSED_CONSTANTS } from '@/config/deployment';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Settings() {
  const a = await auth();
  const [user, users] = await Promise.all([a.currentUser(), a.listUsers()]);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Settings' }]}
      inspector={
        <>
          <div className="lbl">Who you are</div>
          <div className="ihead">{user.name}</div>
          <div className="imeta">{user.role}</div>
          <div className="kv">
            <span>Provider</span>
            <span>{a.kind}</span>
          </div>
          <div className="kv">
            <span>Switchable</span>
            <span>{a.switchable ? 'yes' : 'no'}</span>
          </div>
          <div className="kv">
            <span>People on file</span>
            <span>{users.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">This is not a login</div>
            <p>
              Identity is a cookie holding a handle. No password is checked and none is simulated,
              because a simulated one is the thing that would quietly survive into a deployment.
            </p>
          </div>
          <div className="note">
            Switch user from the rail. Routes, briefs and asks all recompute — the graph is
            asymmetric, so the answers genuinely differ per person.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Settings</h1>
      <p className="sublede">
        Every deferred decision lives in one file. {GUESSED_CONSTANTS.length} of these values are
        guesses and every one of them says so — none should survive two weeks of real data.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Constants that are guesses</h2>
          <span className="lbl">config/deployment.ts · {GUESSED_CONSTANTS.length}</span>
        </div>
        {GUESSED_CONSTANTS.map((g) => (
          <div className="row" key={g.path} style={{ alignItems: 'flex-start' }}>
            <span className="kind k-stage" style={{ width: 54, marginTop: 2 }}>GUESS</span>
            <div className="t">
              <b className="mono" style={{ fontSize: 12 }}>
                {g.path} = {g.value}
              </b>
              <span>{g.why}</span>
            </div>
          </div>
        ))}
        <p className="cover">
          <b>Coverage:</b> every constant explicitly marked as a guess. It does not certify that
          other numbers came from somewhere solid — only that these are known not to have.
        </p>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Deployment</h2>
            <span className="lbl">deferred decisions</span>
          </div>
          <div className="cbody">
            <div className="fact">
              <span>Auth provider</span>
              <span>{config.auth.provider}</span>
            </div>
            <div className="fact">
              <span>Issue sink</span>
              <span>{config.issues.provider} → {config.issues.dir}/</span>
            </div>
            <div className="fact">
              <span>Database</span>
              <span>{config.db.url ? 'DATABASE_URL' : config.db.localDir}</span>
            </div>
            <div className="fact">
              <span>Affinity tier</span>
              <span>{String(config.affinity.tier)} · {config.affinity.syncMode}</span>
            </div>
            <div className="fact">
              <span>Warehouse</span>
              <span>{config.warehouse.enabled ? 'enabled' : 'off'} · {config.warehouse.canonMode}</span>
            </div>
            <div className="fact">
              <span>Agent API key</span>
              <span>{config.agentRuntime.apiKey ? 'present' : 'not set'}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Browser preferences</h2>
            <span className="lbl">this browser only</span>
          </div>
          <div className="cbody">
            <PrefsReset />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>People</h2>
          <span className="lbl">local user switcher</span>
        </div>
        <table className="list">
          <tbody>
            {users.map((u) => (
              <tr key={u.handle}>
                <td>
                  <b>{u.name}</b>
                  {u.id === user.id && <span className="flag f-ok" style={{ marginLeft: 8 }}>you</span>}
                </td>
                <td className="muted">{u.role}</td>
                <td className="muted mono" style={{ fontSize: 11.5 }}>{u.handle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
