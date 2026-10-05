import { cookies } from 'next/headers';
import { config } from '@/config/deployment';
import { USER_COOKIE } from './cookie';

/**
 * Who files a piece of feedback, captured without the database (the feedback routes journal first and
 * resolve the person at ingest). On the Mac: the switcher's handle. Behind Google sign-in: the signed
 * session's user id, as `uid:<id>` — and no valid session means no feedback, so a stranger on the
 * internet cannot file issues. The signature is checked here; the epoch and the person at ingest.
 */
export async function feedbackReporter(): Promise<{ reporter: string | null } | { refused: Response }> {
  const jar = await cookies();
  if (config.auth.provider !== 'google') return { reporter: jar.get(USER_COOKIE)?.value || null };
  const { SESSION_COOKIE, sessionClaims } = await import('./session');
  const claims = sessionClaims(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return { refused: Response.json({ error: 'Sign in to send feedback.' }, { status: 401 }) };
  return { reporter: `uid:${claims.uid}` };
}
