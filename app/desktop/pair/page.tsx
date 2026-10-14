import { config } from '@/config/deployment';
import { currentUser } from '@/lib/auth';
import { normalizeCode, pendingPairing } from '@/lib/desktop/pair';
import s from '../../setup/setup.module.css';
import { decidePairingAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Desktop app · ${config.product.name}` };

/**
 * Where the desktop app sends you to pair it (docs/31 §2). You are signed in here already; Allow lets the app on
 * that Mac act as you, with a session like this browser's.
 */
export default async function DesktopPairPage({ searchParams }: { searchParams: Promise<{ code?: string; done?: string }> }) {
  const { code: raw, done } = await searchParams;
  const user = await currentUser();
  const code = normalizeCode(raw);
  const p = pendingPairing(code);
  return (
    <main className={s.page}>
      <div className={s.narrow} style={{ maxWidth: 480, paddingTop: '8vh' }}>
        <div className={s.card}>
          <div className={s.head}>
            <h1>{done === 'allowed' ? 'The app is signed in' : done === 'refused' ? 'Refused' : 'Sign in the desktop app'}</h1>
            {done === 'allowed' && <p className={s.ok}>PLC OS on that Mac now acts as you. You can close this tab.</p>}
            {done === 'refused' && <p>Nothing was signed in. You can close this tab.</p>}
            {done === 'gone' && <p className={s.error} role="alert">That code has expired or was already used. Start again from the app.</p>}
            {!done && !p && <p className={s.error} role="alert">No app is waiting for code {code ?? raw ?? ''}. It may have expired; start again from the app.</p>}
            {!done && p && <>
              <p>The PLC OS app on <b>{p.device}</b> asks to act as <b>{user.name}</b>. Its actions will be yours, as in this browser.</p>
              <p>Check the app shows the same code:</p>
              <p style={{ fontFamily: 'var(--mono, monospace)', fontSize: 28, letterSpacing: 4, margin: '8px 0 0' }}>{p.userCode}</p>
            </>}
          </div>
          {!done && p && (
            <form action={decidePairingAction} className={s.body} style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
              <input type="hidden" name="code" value={p.userCode} />
              <button className={`${s.btn} ${s.primary}`} name="decision" value="allow" type="submit">Allow</button>
              <button className={s.btn} name="decision" value="refuse" type="submit">Refuse</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
