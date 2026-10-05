import { redirect } from 'next/navigation';
import { config } from '@/config/deployment';
import { setupOpen } from '@/lib/settings/setup';
import { settingsReady } from '@/lib/settings/store';
import s from '../setup/setup.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Sign in · ${config.product.name}` };

/** What each refusal from /auth/google/callback means, in words. The audit log has the details. */
const WHY: Record<string, string> = {
  'oauth-state': 'The sign-in took too long or was started in another tab. Try again.',
  'oauth-code': 'Google did not send a sign-in code back. Try again.',
  'oauth-exchange': 'Google did not confirm the sign-in. Try again in a minute.',
  'google-error': 'Google stopped the sign-in, or it was cancelled.',
  'not-configured': 'Google sign-in is not configured on this server yet.',
  'email-unverified': 'Google has not verified that address.',
  'not-workspace': 'Sign in with your organization’s Google Workspace account, not a personal Google account.',
  'not-on-roster': 'That address is not on this app’s roster, or the person is inactive. Ask an admin to add you.',
  'ambiguous-email': 'More than one person here has that address. Ask an admin to fix the roster.',
};

/** Sign in with Google (docs/deploy/railway.md §3). No self-sign-up: only people already on the roster. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; signedOut?: string }> }) {
  const { error, signedOut } = await searchParams;
  await settingsReady().catch(() => undefined);
  if (config.auth.provider === 'google' && setupOpen()) redirect('/setup');
  const local = config.auth.provider !== 'google';
  return (
    <main className={s.page}>
      <div className={s.narrow} style={{ maxWidth: 440, paddingTop: '8vh' }}>
        <a className={s.brand} href="/"><span className={s.mark}>{config.product.mark}</span><span><b>{config.product.name}</b><span>{config.data.profile === 'real' ? 'Real data' : 'Demo data'}</span></span></a>
        <div className={s.card}>
          <div className={s.head}>
            <h1>{local ? 'No sign-in here' : 'Sign in'}</h1>
            <p>{local
              ? 'This server uses the local user switcher. Pick who you are from the bottom of the rail.'
              : 'With your organization’s Google Workspace account. Only people on the roster can sign in.'}</p>
            {signedOut && !error && <p className={s.ok}>You are signed out.</p>}
            {error && <p className={s.error} role="alert"><b>Not signed in.</b> {WHY[error] ?? 'The sign-in was refused.'}</p>}
          </div>
          <div className={s.body} style={{ paddingTop: 8 }}>
            {local
              ? <a className={`${s.btn} ${s.primary}`} href="/today">Open the app</a>
              : (
                <a className={`${s.btn} ${s.google}`} href="/auth/google" style={{ width: '100%', justifyContent: 'center', boxSizing: 'border-box' }}>
                  <svg viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
                  Continue with Google
                </a>
              )}
          </div>
        </div>
      </div>
    </main>
  );
}
