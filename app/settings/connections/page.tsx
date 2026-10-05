import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { deployedServer } from '@/config/sign-in';
import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { dataDir, secretSource, storageWarning } from '@/lib/settings/key';
import { publicUrl, setupOpen } from '@/lib/settings/setup';
import { settingsReady, settingsView, type SettingView } from '@/lib/settings/store';
import { ago } from '@/lib/time';
import { appendAudit, listUsers } from '@/modules/platform';
import { signOutEverywhereAction } from './actions';
import { SettingRow, type RowView } from './SettingRow';
import s from './connections.module.css';

export const dynamic = 'force-dynamic';

const CHECKABLE = new Set(['anthropic.apiKey', 'affinity.apiKey']);
const REMOVE_WARNING: Record<string, string> = {
  'google.clientId': 'Remove the Google client ID? Nobody can sign in without it, you included: the server goes back to first-run setup, with a new code in its log.',
  'google.clientSecret': 'Remove the Google client secret? Nobody can sign in without it, you included: the server goes back to first-run setup, with a new code in its log.',
  'app.publicUrl': 'Remove the saved public address? The app falls back to Railway’s domain, then the address each request came to.',
};

/**
 * Settings → Connections (docs/deploy/railway.md §3), Admins only. Every setting the app keeps, where its
 * value comes from (the environment, the app, or nowhere), Replace and Remove, and a check where it is
 * cheap. A stored secret is never sent to the browser: the page shows •••• and its last four characters.
 */
export default async function ConnectionsPage() {
  const user = await (await auth()).currentUser();
  if (!can(user, 'admin')) {
    await appendAudit({ actorId: user.id, action: 'authz.refused', subjectType: 'page', subjectId: '/settings/connections', detail: { access: user.access } }).catch(() => undefined);
    redirect('/access-denied');
  }
  await settingsReady();
  const h = await headers();
  const base = publicUrl(h);
  const rows = settingsView();
  const by = (group: SettingView['group']) => rows.filter((r) => r.group === group).map((r): RowView => ({
    ...r, checkable: CHECKABLE.has(r.key), removeWarning: REMOVE_WARNING[r.key] ?? null,
  }));
  const key = secretSource();
  const storage = storageWarning();
  const people = (await listUsers()).filter((p) => p.email);

  return (
    <Page
      crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Connections' }]}
      inspector={
        <>
          <div className="lbl">How these are kept</div>
          <div className="kv"><span>Sign-in</span><span>{config.auth.provider === 'google' ? 'Google' : config.auth.provider === 'labos' ? 'LabOS' : 'user switcher'}</span></div>
          <div className="kv"><span>Set up</span><span>{config.auth.provider !== 'google' ? 'not needed' : setupOpen() ? 'open' : 'done'}</span></div>
          <div className="kv"><span>Encryption key</span><span>{key.source === 'env' ? 'PLCOS_SECRET' : key.source === 'volume' ? 'on the volume' : 'dev file'}</span></div>
          <div className="kv"><span>Stored here</span><span>{rows.filter((r) => r.source === 'app').length} of {rows.length}</span></div>
          <div className="scope">
            <div className="lbl">The environment wins</div>
            <p>A value set in the server&rsquo;s environment overrides the one kept here, and cannot be changed from this page. That keeps the Mac&rsquo;s Keychain wrappers working and a sealed Railway variable sealed.</p>
          </div>
          <div className="note">Every change is in the audit log by field name, never by value. A non-admin who tries is refused and logged.</div>
        </>
      }
    >
      <div className="lbl">Settings</div>
      <h1>Connections</h1>
      <p className="sublede">
        The address, Google sign-in, and the keys this server uses to reach other services. Secrets are encrypted with
        PLCOS_SECRET and never shown again in full. Your own preferences are in <Link href="/settings">Preferences</Link>.
      </p>

      {storage && <div className="warn" style={{ marginBottom: 16 }}><b>Storage.</b><p>{storage}</p></div>}
      {key.source === 'volume' && (
        <div className="warn" style={{ marginBottom: 16 }}>
          <b>The encryption key is on the volume.</b>
          <p>PLCOS_SECRET is not set, so the server made one at <span className="mono">{key.file}</span>, next to the data. Anyone with a copy of the volume could decrypt the keys below. Copy it into a sealed PLCOS_SECRET variable on Railway (<span className="mono">railway ssh</span>, then <span className="mono">cat {key.file}</span>), redeploy, and then delete the file.</p>
        </div>
      )}

      <div className="card">
        <div className="chead"><h2>Address and sign-in</h2><span className="lbl">Google OAuth client</span></div>
        <div className="cbody" style={{ paddingTop: 0 }}>
          {by('address').map((r) => <SettingRow key={r.key} v={r} />)}
          <div className={s.row}>
            <b>Redirect URI</b>
            <p className={s.help}>Enter this under Authorized redirect URIs on the Google client. It follows the public address.</p>
            <div className={s.copy}><code>{base}/auth/google/callback</code></div>
          </div>
          {by('signin').map((r) => <SettingRow key={r.key} v={r} />)}
          {by('session').map((r) => <SettingRow key={r.key} v={r} />)}
        </div>
      </div>

      <div className="card">
        <div className="chead"><h2>Connectors</h2><span className="lbl">read-only · optional</span></div>
        <div className="cbody" style={{ paddingTop: 0 }}>{by('connectors').map((r) => <SettingRow key={r.key} v={r} />)}</div>
      </div>

      <div className="card">
        <div className="chead"><h2>Tokens</h2><span className="lbl">for the Mac</span></div>
        <div className="cbody" style={{ paddingTop: 0 }}>{by('tokens').map((r) => <SettingRow key={r.key} v={r} />)}</div>
      </div>

      <div className="card">
        <div className="chead"><h2>People and sessions</h2><span className="lbl">{people.length} with an address</span></div>
        <div className="cbody">
          <p>Who can sign in: an active person on the roster whose address is a verified Google Workspace account. Sign out everywhere ends every session that person holds, on every device.</p>
          <table className={s.people}>
            <thead><tr><th>Person</th><th>Address</th><th>Access</th><th /></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b>{p.id === user.id && <span className="flag f-ok" style={{ marginLeft: 8 }}>you</span>}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{p.email}</td>
                  <td>{p.access}</td>
                  <td>
                    <form action={signOutEverywhereAction}>
                      <input type="hidden" name="userId" value={p.id} />
                      <button className="btn">Sign out everywhere</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="chead"><h2>Only in the environment</h2><span className="lbl">two values</span></div>
        <div className="cbody">
          <div className="fact"><span>PLCOS_SECRET</span><span>{key.source === 'env' ? 'set' : key.source === 'volume' ? 'not set: a key on the volume' : 'not set: a dev key in this checkout'}</span></div>
          <div className="fact"><span>Database</span><span>{config.db.url ? 'DATABASE_URL' : 'local PGlite'}</span></div>
          <div className="fact"><span>Data folder</span><span className="mono" style={{ fontSize: 11.5 }}>{deployedServer() ? dataDir() : 'data/ in this checkout'}</span></div>
        </div>
        <p className="cover"><b>Why these two stay out.</b> PLCOS_SECRET encrypts everything above, so a page cannot set it; the database connection is how this server finds the page at all. Keep a copy of PLCOS_SECRET in a password manager: without it a restored database&rsquo;s keys must be entered again.{rows.some((r) => r.updatedAt) ? ` Last change here ${ago(new Date(rows.map((r) => r.updatedAt ?? '').sort().pop()!))}.` : ''}</p>
      </div>
    </Page>
  );
}
