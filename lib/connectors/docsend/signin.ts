import { config } from '@/config/deployment';
import { cookieAttributes, cookieFrom, readStateCookie, stateCookie } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import type { AppUser } from '@/lib/auth';
import { appendAudit } from '@/modules/platform';
import { finishConnect, startConnect } from './connection';
import { DocsendSignInError } from './oauth';

/**
 * Connect DocSend from Settings → Connections (docs/32-docsend.md §4 E), Admins only (lib/authz/route-rules.ts):
 *
 *   /api/connectors/docsend/connect   register with DocSend's sign-in, PKCE, a signed state cookie (ten minutes), then DocSend.
 *   /api/connectors/docsend/callback  the state must match its cookie; the code is exchanged and the sync uses this sign-in.
 *
 * Every way back lands on Settings → Connections with a word for what happened, never a token or a code.
 */
const cookieName = (secure: boolean) => `${secure ? '__Host-' : ''}${config.data.cookiePrefix}docsend`;
/** What went wrong, for the audit log and Settings: our own errors say it in words; anything else gives its name and message. */
const reason = (e: unknown) => e instanceof DocsendSignInError ? e.message : `${e instanceof Error ? `${e.name}: ${e.message}` : 'error'}`.slice(0, 300);
const back = (base: string, outcome: string) => `${base}/settings/connections?docsend=${outcome}#docsend`;

function redirect(to: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}

export async function startDocsendConnect(user: AppUser, base: string): Promise<Response> {
  const secure = base.startsWith('https://');
  try {
    const { url, state, verifier } = await startConnect(user.id, base);
    return redirect(url, [cookieAttributes(cookieName(secure), stateCookie(state, verifier), config.auth.stateSeconds, secure)]);
  } catch (e) {
    await appendAudit({ actorId: user.id, action: 'docsend.connect_failed', subjectType: 'connector', subjectId: 'docsend', detail: { step: 'start', why: reason(e) } }).catch(() => undefined);
    return redirect(back(base, 'unavailable'));
  }
}

export async function finishDocsendConnect(user: AppUser, base: string, request: Request): Promise<Response> {
  const secure = base.startsWith('https://');
  const clear = cookieAttributes(cookieName(secure), '', 0, secure);
  const u = new URL(request.url);
  const pending = readStateCookie(cookieFrom(request.headers.get('cookie'), cookieName(secure)));
  const code = u.searchParams.get('code');
  const fail = async (outcome: string, why: string) => {
    await appendAudit({ actorId: user.id, action: 'docsend.connect_failed', subjectType: 'connector', subjectId: 'docsend', detail: { step: 'finish', why } }).catch(() => undefined);
    return redirect(back(base, outcome), [clear]);
  };
  if (u.searchParams.get('error')) return fail('declined', 'docsend-error');
  if (!pending || u.searchParams.get('state') !== pending.state) return fail('expired', 'state');
  if (!code || code.length > 2048) return fail('failed', 'code');
  try {
    await finishConnect(user.id, code, pending.verifier, await getDb());
  } catch (e) {
    return fail('failed', reason(e));
  }
  await appendAudit({ actorId: user.id, action: 'docsend.connected', subjectType: 'connector', subjectId: 'docsend', detail: {} }).catch(() => undefined);
  return redirect(back(base, 'connected'), [clear]);
}
