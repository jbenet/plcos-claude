import { relative } from 'node:path';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { SettingsLayout } from '@/components/settings/SettingsNav';
import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { deployedServer } from '@/config/sign-in';
import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { dataDir, secretSource, storageWarning } from '@/lib/settings/key';
import { publicUrl, setupOpen } from '@/lib/settings/setup';
import { settingsReady, settingsView, type SettingView } from '@/lib/settings/store';
import { ago } from '@/lib/time';
import { docsendConnection, listSpaces } from '@/modules/docsend';
import { appendAudit, auditSince, listUsers, listVehicles } from '@/modules/platform';
import { disconnectDocsendAction, finishDocsendPasteAction, mapDocsendSpaceAction, syncDocsendAction } from './actions';
import { signInReturnsToLoopback } from '@/lib/connectors/docsend/connection';
import { SettingRow, type RowView } from './SettingRow';
import s from './connections.module.css';

export const dynamic = 'force-dynamic';

const CHECKABLE = new Set(['anthropic.apiKey', 'affinity.apiKey']);
const REMOVE_WARNING: Record<string, string> = {
  'google.clientId': 'Remove the Google client ID? Nobody can sign in again until a new one is entered here. Setup does not reopen: if every admin is signed out, the sign-in variables on the service are the way back in.',
  'google.clientSecret': 'Remove the Google client secret? Nobody can sign in again until a new one is entered here. Setup does not reopen: if every admin is signed out, the sign-in variables on the service are the way back in.',
  'app.publicUrl': 'Remove the saved public address? The app falls back to Railway’s domain, then the address each request came to.',
};

/**
 * Settings → Connections (docs/deploy/railway.md §3), Admins only. Every setting the app keeps, where its
 * value comes from (the environment, the app, or nowhere), Replace and Remove, and a check where it is
 * cheap. A stored secret is never sent to the browser: the page shows •••• and its last four characters.
 */
const DOCSEND_OUTCOME: Record<string, string> = {
  connected: 'DocSend is connected. The first read takes the whole history; press Read now, or it runs tonight.',
  declined: 'DocSend sign-in was cancelled.',
  expired: 'The DocSend sign-in took too long or came from another browser. Connect again.',
  failed: 'DocSend refused the sign-in.',
  unavailable: 'DocSend’s sign-in could not be reached from this server.',
  'pasted-wrong': 'That is not the address DocSend sent your browser to. It starts with http://localhost:8976/callback or http://127.0.0.1:8976/callback.',
};

export default async function ConnectionsPage({ searchParams }: { searchParams?: Promise<{ docsend?: string }> } = {}) {
  const user = await (await auth()).currentUser();
  if (!can(user, 'admin')) {
    await appendAudit({ actorId: user.id, action: 'authz.refused', subjectType: 'page', subjectId: '/settings/connections', detail: { access: user.access } }).catch(() => undefined);
    redirect('/access-denied');
  }
  await settingsReady();
  const h = await headers();
  const base = publicUrl(h);
  const rows = settingsView();
  // Under the Mac's user switcher anyone on the network can pick an admin: nothing is changed from here.
  const readOnly = config.auth.provider !== 'google' && config.auth.provider !== 'labos';
  const by = (group: SettingView['group']) => rows.filter((r) => r.group === group).map((r): RowView => ({
    ...r, checkable: CHECKABLE.has(r.key), removeWarning: REMOVE_WARNING[r.key] ?? null, readOnly,
  }));
  const key = secretSource();
  const storage = storageWarning();
  const people = (await listUsers()).filter((p) => p.email);
  const [docsend, spaces, vehicles, docsendPaste] = await Promise.all([docsendConnection(), listSpaces(), listVehicles(), signInReturnsToLoopback(user.id)]);
  const docsendParam = (await searchParams)?.docsend ?? '';
  const docsendOutcome = DOCSEND_OUTCOME[docsendParam] ?? null;
  // The reason the last sign-in failed, from the audit log, so nobody has to go and look it up.
  const docsendWhy = docsendParam === 'failed' || docsendParam === 'unavailable'
    ? String((await auditSince(['docsend.connect_failed'], new Date(Date.now() - 3_600_000)))[0]?.detail.why ?? '') || null : null;

  return (
    <Page
      crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Connections' }]}
      inspector={
        <>
          <div className="lbl">How these are kept</div>
          <div className="kv"><span>Sign-in</span><span>{config.auth.provider === 'google' ? 'Google' : config.auth.provider === 'labos' ? 'LabOS' : 'user switcher'}</span></div>
          <div className="kv"><span>Set up</span><span>{config.auth.provider !== 'google' ? 'not needed' : setupOpen() ? 'open' : 'closed for good'}</span></div>
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
      <SettingsLayout current="connections" admin>
      <div className="lbl">Settings</div>
      <h1>Connections</h1>
      <p className="sublede">
        The address, Google sign-in, and the keys this server uses to reach other services. Secrets are encrypted with
        PLCOS_SECRET and never shown again in full. Your own preferences are in <Link href="/settings">Preferences</Link>.
      </p>

      {readOnly && (
        <div className="scope" style={{ marginTop: 0 }}>
          <b>Read-only on this server.</b>
          <p>It uses the user switcher, so anyone on the network could pick an admin: settings are changed only on a deployed server with sign-in. Here the keys come from the environment, through the Keychain wrappers.</p>
        </div>
      )}
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

      <div className="card" id="docsend">
        <div className="chead"><h2>DocSend</h2><span className="lbl">read-only · data-room visits</span></div>
        <div className="cbody">
          {docsendOutcome && <p className="note">{docsendOutcome}{docsendWhy && <> The reason: {docsendWhy}</>}</p>}
          <p className={s.help}>
            Who opened each data room, for how long and how far, read nightly through DocSend&rsquo;s own MCP server (docs/32).
            Only its two read tools are called; nothing in DocSend is changed. It sees what the connected person&rsquo;s DocSend account sees.
          </p>
          {docsend ? (
            <>
              <div className="fact"><span>Signed in as</span><span>{docsend.userName ?? 'an Admin'}, {ago(docsend.connectedAt)}</span></div>
              {docsend.lastError && <div className="warn"><b>Last read failed.</b><p>{docsend.lastError}</p></div>}
              {!readOnly && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <form action={syncDocsendAction}><button className="btn p" type="submit">Read now</button></form>
                  <a className="btn" href="/api/connectors/docsend/connect">Connect again</a>
                  <form action={disconnectDocsendAction}><button className="btn" type="submit">Disconnect</button></form>
                </div>
              )}
            </>
          ) : readOnly ? <p>Connect DocSend on the deployed server.</p> : (
            <a className="btn p" href="/api/connectors/docsend/connect">Connect DocSend</a>
          )}
          {docsendPaste && !readOnly && docsendParam !== 'connected' && (
            <form action={finishDocsendPasteAction} style={{ marginTop: 12 }}>
              <p className={s.help}>
                DocSend sends its sign-in back to this computer&rsquo;s own address, so after you approve, your browser lands on a page
                that does not load. Copy that page&rsquo;s whole address from the address bar and paste it here within ten minutes.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input name="url" type="url" required placeholder="http://localhost:8976/callback?code=…" style={{ flex: 1 }} autoComplete="off" />
                <button className="btn p" type="submit">Finish connecting</button>
              </div>
            </form>
          )}
          {spaces.length > 0 && (
            <>
              <div className="lbl" style={{ marginTop: 16 }}>Data rooms and their vehicle</div>
              {spaces.map((sp) => (
                <form key={sp.spaceId} action={mapDocsendSpaceAction} className={s.row}>
                  <input type="hidden" name="spaceId" value={sp.spaceId} />
                  <b>{sp.name}</b>
                  <p className={s.help}>{sp.visits} visits by {sp.viewers} people{sp.readAt ? `, read ${ago(sp.readAt)}` : ', not read yet'}.</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select name="vehicleId" defaultValue={sp.vehicleId ?? ''} disabled={readOnly}>
                      <option value="">No vehicle</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    {!readOnly && <button className="btn" type="submit">Save</button>}
                  </div>
                </form>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chead"><h2>Tokens</h2><span className="lbl">for the Mac</span></div>
        <div className="cbody" style={{ paddingTop: 0 }}>{by('tokens').map((r) => <SettingRow key={r.key} v={r} />)}</div>
      </div>

      <div className="card">
        <div className="chead"><h2>People</h2><span className="lbl">{people.length} with an address</span></div>
        <div className="cbody">
          <p>Who can sign in, their access, deactivation and Sign out everywhere are in <Link href="/settings/people">Settings → People</Link>.</p>
        </div>
      </div>

      <div className="card">
        <div className="chead"><h2>Only in the environment</h2><span className="lbl">two values</span></div>
        <div className="cbody">
          <div className="fact"><span>PLCOS_SECRET</span><span>{key.source === 'env' ? 'set' : key.source === 'volume' ? 'not set: a key on the volume' : 'not set: a dev key in this checkout'}</span></div>
          <div className="fact"><span>Database</span><span>{config.db.url ? 'DATABASE_URL' : 'local PGlite'}</span></div>
          <div className="fact"><span>Data folder</span><span className="mono" style={{ fontSize: 11.5 }}>{deployedServer() ? `${relative(process.cwd(), dataDir()) || '.'}/ in the app folder` : 'data/ in this checkout'}</span></div>
        </div>
        <p className="cover"><b>Why these two stay out.</b> PLCOS_SECRET encrypts everything above, so a page cannot set it; the database connection is how this server finds the page at all. Keep a copy of PLCOS_SECRET in a password manager: without it a restored database&rsquo;s keys must be entered again.{rows.some((r) => r.updatedAt) ? ` Last change here ${ago(new Date(rows.map((r) => r.updatedAt ?? '').sort().pop()!))}.` : ''}</p>
      </div>
      </SettingsLayout>
    </Page>
  );
}
