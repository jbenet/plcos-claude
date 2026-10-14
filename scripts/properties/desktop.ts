/** The desktop app's pairing and build excludes (docs/31). Pure: no database, no network. */
import { createHash, randomBytes } from 'node:crypto';
import { buildExcludes } from '../../lib/desktop/build';
import { claimPairing, decidePairing, normalizeCode, resetPairings, startPairing } from '../../lib/desktop/pair';
import type { AppUser } from '../../modules/platform';
import type { Check } from './harness';

export async function desktopProperties(check: Check) {
  const user = { id: '00000000-0000-4000-8000-000000000001', handle: 'juan', name: 'Juan', initials: 'J', role: 'GP', access: 'admin', vehicles: null, approves: [], email: 'j@example.com' } as AppUser;
  const pkce = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };
  const grantOf = (url: string | null) => new URL(url!).searchParams.get('grant')!;
  resetPairings();

  let refused = '';
  try { startPairing('Mac', 'short', 47100); } catch (e) { refused = String(e); }
  check('desktop pairing needs a PKCE challenge', refused.includes('PKCE'), refused);

  const a = pkce();
  const s = startPairing('Juan’s Mac <script>', a.challenge, 47100);
  check('desktop pairing short code has the readable shape', /^[A-Z]{4}-[A-Z]{4}$/.test(s.userCode) && normalizeCode(s.userCode.toLowerCase().replace('-', ' ')) === s.userCode, s.userCode);
  const d = decidePairing(s.userCode, user, true);
  check('desktop pairing sends the browser to the app’s own loopback port', Boolean(d?.redirect?.startsWith('http://127.0.0.1:47100/__desktop/callback?grant=')), d?.redirect ?? 'none');
  check('desktop pairing keeps only a plain device label', d?.pending.device === 'Juan’s Mac script', d?.pending.device ?? '');
  check('desktop pairing is decided once', decidePairing(s.userCode, user, true) === null, 'second decision');
  const grant = grantOf(d!.redirect);
  check('desktop pairing refuses a wrong verifier', claimPairing(grant, pkce().verifier) === null, 'wrong verifier');
  check('desktop pairing burns a grant tried with a wrong verifier', claimPairing(grant, a.verifier) === null, 'after a wrong try');

  const b = pkce();
  const s2 = startPairing('Mac', b.challenge, 47100);
  const g2 = grantOf(decidePairing(s2.userCode, user, true)!.redirect);
  const won = claimPairing(g2, b.verifier);
  check('desktop pairing hands the approving person over with the right verifier', won?.user.id === user.id, JSON.stringify(won?.user.handle));
  check('desktop pairing grant works once', claimPairing(g2, b.verifier) === null, 'replay');

  const c = pkce();
  const s3 = startPairing('Mac', c.challenge, 47100);
  check('desktop pairing refused gives no grant', decidePairing(s3.userCode, user, false)?.redirect === null, 'refused');

  const e = pkce();
  const s4 = startPairing('Mac', e.challenge, 47100, 0);
  const g4 = grantOf(decidePairing(s4.userCode, user, true, 1000)!.redirect);
  check('desktop pairing expires after ten minutes', claimPairing(g4, e.verifier, 10 * 60_000 + 1) === null, 'expired');
  resetPairings();

  const ex = buildExcludes('data/real');
  check('desktop build leaves out dependencies, data, git, env and source maps',
    ['./node_modules', './data', './.git', './.env', './.next/cache', '*.map'].every((x) => ex.includes(x)), ex.join(' '));
}
