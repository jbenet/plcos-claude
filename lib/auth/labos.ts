import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Queryable } from '@/lib/db';
import { resolveLabosUser } from '@/modules/platform';
import { MutationGuardError } from '@/lib/mutation-policy';
import type { AuthProvider } from './index';

const members = new Map<string, { uid: string; name: string; until: number }>();
export const LABOS_SIGN_IN = 'Open Capital OS from LabOS → AI Apps';

export async function labosUser(cookie: string | undefined, q?: Queryable) {
  let token: string;
  try { token = decodeURIComponent(cookie ?? '').replace(/^"|"$/g, ''); }
  catch { throw new MutationGuardError(LABOS_SIGN_IN, 401); }
  if (!token) throw new MutationGuardError(LABOS_SIGN_IN, 401);
  const key = createHash('sha256').update(token).digest('hex');
  let member = members.get(key);
  if (!member || member.until <= Date.now()) {
    members.delete(key);
    let response: Response;
    try {
      response = await fetch(process.env.LABOS_ME_URL!, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new Error('LabOS identity service unavailable.'); }
    if (response.status === 401) throw new MutationGuardError(LABOS_SIGN_IN, 401);
    if (!response.ok) throw new Error('LabOS identity service unavailable.');
    const body = await response.json().catch(() => null);
    if (typeof body?.uid !== 'string' || !body.uid || typeof body.name !== 'string' || !body.name.trim()) {
      throw new Error('LabOS returned an invalid identity.');
    }
    member = { uid: body.uid, name: body.name, until: Date.now() + 5 * 60_000 };
    if (members.size >= 100) members.delete(members.keys().next().value!);
    members.set(key, member);
  }
  const user = await resolveLabosUser(member.uid, member.name, q);
  if (!user) throw new MutationGuardError('This app user is inactive.', 403);
  return user;
}

export function labosAuth(): AuthProvider {
  return {
    kind: 'labos', switchable: false,
    currentUser: async q => labosUser((await cookies()).get('authToken')?.value, q),
    listUsers: async () => [],
    switchUser: async () => { throw new MutationGuardError('This deployment does not allow switching users.', 403); },
  };
}
