import { headers } from 'next/headers';
import { disconnectGmailAction } from '@/app/email/actions';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { gmailStatus } from '@/modules/email';
import { PasteConsent } from './PasteConsent';
import s from './email.module.css';

const OUTCOME: Record<string, string> = {
  connected: 'Connected.',
  declined: 'Google says the request was declined. Nothing was stored.',
  mismatch: 'That answer did not match the connect started in this browser, so it was ignored. Start again.',
  failed: 'Google’s answer could not be used — the grant was wider than asked for, or had no refresh token. Nothing was stored; start again.',
  off: 'Gmail drafts are off on this server.',
  viewer: 'Viewers do not write drafts, so there is nothing to connect.',
};

/**
 * Preferences → Email (docs/25 §Per-user OAuth): connect your own Gmail so drafts can be moved
 * into it, see what was granted, and disconnect — which revokes the grant at Google and forgets it.
 */
export async function GmailConnect({ outcome }: { outcome?: string }) {
  const user = await (await auth()).currentUser();
  const h = await headers();
  const g = await gmailStatus(user, `http://${h.get('host') ?? 'localhost'}`);
  return (
    <div className="card" id="email">
      <div className="chead">
        <h2>Email</h2>
        <span className="lbl">your Gmail · drafts only · {g.mode === 'fake' ? 'the demo’s fake Google' : g.mode === 'google' ? 'Google' : 'off'}</span>
      </div>
      <div className="cbody">
        {outcome && OUTCOME[outcome] && <p role="status" style={{ marginTop: 0, color: outcome === 'connected' ? 'var(--green)' : 'var(--clay)' }}>{OUTCOME[outcome]}</p>}
        {g.mode === 'off' ? (
          <p style={{ marginTop: 0 }}>{g.why}</p>
        ) : g.email ? (
          <>
            <div className="fact"><span>Connected</span><span>{g.email}{g.connectedAt ? ` · since ${shortDate(new Date(g.connectedAt))}` : ''}</span></div>
            <div className="fact"><span>May</span><span>make and update drafts{g.threads ? ', and read the headers of a thread to reply in it' : ''}. It cannot send: this tool has no send in it.</span></div>
            <form action={disconnectGmailAction} style={{ marginTop: 10 }}>
              <button className="btn" type="submit">Disconnect</button>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>Revokes the grant at Google and forgets it here. Drafts already in Gmail stay there.</span>
            </form>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Connect your own Gmail to move drafts written here into your Drafts folder, where you review and send them
              yourself. Google will ask to let this tool &ldquo;manage drafts and send emails&rdquo; — that is the narrowest
              permission Gmail offers for drafts. This tool only makes drafts; it has no way to send.
              {g.threads ? ' It also asks to read message headers (never bodies), so a follow-up lands in its thread.' : ''}
            </p>
            <a className="btn p" href="/api/email/google/start">Connect Gmail{g.mode === 'fake' ? ' (fake, for the demo)' : ''}</a>
            {g.mode === 'google' && (
              <div className={s.paste}>
                <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 0', flexBasis: '100%' }}>
                  On another device, Google sends you back to a localhost page that will not load. Copy that page&rsquo;s whole
                  address and paste it here to finish.
                </p>
                <PasteConsent />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
