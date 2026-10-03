import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppUser } from '@/modules/platform';

/**
 * Who a request acts as when it carries no browser cookie: an MCP call, authenticated by its
 * token (docs/26-mcp.md). Inside `actAs`, `auth().currentUser()` answers with this user, so the
 * read facades in lib/authz/read redact for the token's owner — never for the local provider's
 * fallback (the roster's first user), which is what a cookie-less request would otherwise get.
 */
const store = new AsyncLocalStorage<AppUser>();

export function actingUser(): AppUser | null {
  return store.getStore() ?? null;
}

export function actAs<T>(user: AppUser, work: () => Promise<T>): Promise<T> {
  return store.run(user, work);
}
