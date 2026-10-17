import { config } from '@/config/deployment';
import { cookieAttributes, cookieFrom, readStateCookie, stateCookie } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import type { AppUser } from '@/lib/auth';
import { appendAudit } from '@/modules/platform';
import { finishConnect, LOOPBACK_REDIRECTS, startConnect } from './connection';
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

/** The callback and the pasted address share one ending: the state against its cookie, then the code exchanged. */
async function finishOutcome(user: AppUser, params: URLSearchParams, cookieHeader: string | null, secure: boolean): Promise<string> {
  const pending = readStateCookie(cookieFrom(cookieHeader, cookieName(secure)));
  const code = params.get('code');
  const fail = async (outcome: string, why: string) => {
    await appendAudit({ actorId: user.id, action: 'docsend.connect_failed', subjectType: 'connector', subjectId: 'docsend', detail: { step: 'finish', why } }).catch(() => undefined);
    return outcome;
  };
  if (params.get('error')) return fail('declined', 'docsend-error');
  if (!pending || params.get('state') !== pending.state) return fail('expired', 'state');
  if (!code || code.length > 2048) return fail('failed', 'code');
  try {
    await finishConnect(user.id, code, pending.verifier, await getDb());
  } catch (e) {
    return fail('failed', reason(e));
  }
  await appendAudit({ actorId: user.id, action: 'docsend.connected', subjectType: 'connector', subjectId: 'docsend', detail: {} }).catch(() => undefined);
  return 'connected';
}

export async function finishDocsendConnect(user: AppUser, base: string, request: Request): Promise<Response> {
  const secure = base.startsWith('https://');
  const outcome = await finishOutcome(user, new URL(request.url).searchParams, request.headers.get('cookie'), secure);
  return redirect(back(base, outcome), [cookieAttributes(cookieName(secure), '', 0, secure)]);
}

/**
 * The loopback ending (connection.ts LOOPBACK_REDIRECTS): the person pastes the address their browser ended on. Only
 * its query is read, and only from a loopback address. Returns the outcome word and the cookie to clear it with.
 */
export async function finishDocsendFromPaste(user: AppUser, base: string, pasted: string, cookieHeader: string | null): Promise<{ outcome: string; clear: { name: string; secure: boolean } }> {
  const secure = base.startsWith('https://');
  const clear = { name: cookieName(secure), secure };
  let u: URL | null = null;
  try { u = new URL(pasted.trim()); } catch { /* reported below */ }
  if (!u || !LOOPBACK_REDIRECTS.some((r) => r.startsWith(`${u!.protocol}//${u!.host}/`))) {
    await appendAudit({ actorId: user.id, action: 'docsend.connect_failed', subjectType: 'connector', subjectId: 'docsend', detail: { step: 'paste', why: 'not the address DocSend sent the browser to' } }).catch(() => undefined);
    return { outcome: 'pasted-wrong', clear };
  }
  return { outcome: await finishOutcome(user, u.searchParams, cookieHeader, secure), clear };
}
