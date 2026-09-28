import type { ReactNode } from 'react';
import { currentUser } from '@/lib/auth';
import { can, type Action, type Scope } from '@/lib/authz';
/** Cosmetic only: the server action repeats authorization against authoritative targets. */
export async function AuthorizedControl({ action, scope = {}, children }: { action: Action; scope?: Scope; children: ReactNode }) {
  return can(await currentUser(), action, scope) ? children : null;
}
