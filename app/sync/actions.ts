'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';
import type { MadeToken } from '@/app/settings/actions';

/**
 * Cloud sync tokens (docs/deploy/railway.md §6–§7), made in Preferences → MCP access beside MCP tokens
 * and revoked there the same way. A snapshot token reads the whole database, so only an Admin makes
 * one; a push token hands the server finished research, so a GP or an Admin. The service checks the
 * owner again (modules/platform/mcp-tokens.ts), and the endpoints check on every use.
 */
export async function createSyncTokenAction(formData: FormData): Promise<MadeToken> {
  const user = await requireAction('app/sync/actions.ts#createSyncTokenAction', formData);
  const { config } = await import('@/config/deployment');
  const { createSyncToken, listMcpTokens, maySyncScope, TokenRefused } = await import('@/modules/platform');
  const label = String(formData.get('label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!label) return { ok: false, error: 'Name the token after where it will live, e.g. “cloud-pull on the Mac”.' };
  const scope = String(formData.get('tools') ?? '');
  if (scope !== 'snapshot' && scope !== 'push') return { ok: false, error: 'Choose what the token may do.' };
  if (!maySyncScope(user, scope)) return { ok: false, error: scope === 'snapshot' ? 'Only an Admin can make a snapshot token.' : 'Only a GP or an Admin can make a push token.' };
  const live = (await listMcpTokens(user.id)).filter((t) => !t.revokedAt && new Date(t.expiresAt) > new Date());
  if (live.length >= 10) return { ok: false, error: 'You have ten live tokens. Revoke one you no longer use first.' }; // GUESS, as for MCP tokens
  try {
    const { token, secret } = await createSyncToken(user, { label, scope, days: config.sync.tokenDays });
    revalidatePath('/settings');
    return { ok: true, secret, prefix: token.prefix, label: token.label };
  } catch (e) {
    if (e instanceof TokenRefused) return { ok: false, error: e.message };
    throw e;
  }
}
