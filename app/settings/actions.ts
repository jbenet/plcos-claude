'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * MCP tokens (docs/26-mcp.md): made and revoked by their owner, in Preferences. A token can be
 * narrower than its owner — fewer tools, fewer vehicles — never wider. The secret is answered once,
 * to this page, and only its hash is kept.
 */

export type MadeToken = { ok: true; secret: string; prefix: string; label: string } | { ok: false; error: string };

export async function createMcpTokenAction(formData: FormData): Promise<MadeToken> {
  const user = await requireAction('app/settings/actions.ts#createMcpTokenAction', formData);
  const { config } = await import('@/config/deployment');
  const { createMcpToken, listVehicles, listMcpTokens } = await import('@/modules/platform');
  const { READ_TOOLS, TOOL_NAMES } = await import('@/lib/mcp/tools');
  const label = String(formData.get('label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!label) return { ok: false, error: 'Name the token after where it will live, e.g. “Claude Code on the Mac”.' };
  const preset = String(formData.get('tools') ?? 'read');
  if (!['read', 'draft'].includes(preset)) return { ok: false, error: 'Choose what the token may do.' };
  const known = new Set((await listVehicles()).map((v) => v.id));
  const chosen = formData.getAll('vehicle').map(String).filter(Boolean);
  if (chosen.some((v) => !known.has(v))) return { ok: false, error: 'An unknown vehicle was chosen.' };
  // Narrowing only: a vehicle you cannot read cannot be granted to a token.
  if (user.vehicles !== null && chosen.some((v) => !user.vehicles!.includes(v))) return { ok: false, error: 'A token cannot see a vehicle you cannot.' };
  const live = (await listMcpTokens(user.id)).filter((t) => !t.revokedAt && new Date(t.expiresAt) > new Date());
  if (live.length >= 10) return { ok: false, error: 'You have ten live tokens. Revoke one you no longer use first.' }; // GUESS: plenty for one person's devices
  const { token, secret } = await createMcpToken(user, {
    label, tools: preset === 'draft' ? [...TOOL_NAMES] : [...READ_TOOLS],
    vehicles: chosen.length ? chosen : null, callsPerDay: config.mcp.defaultCallsPerDay, days: config.mcp.tokenDays,
  });
  revalidatePath('/settings');
  return { ok: true, secret, prefix: token.prefix, label: token.label };
}

export async function revokeMcpTokenAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/settings/actions.ts#revokeMcpTokenAction', formData);
  const { revokeMcpToken } = await import('@/modules/platform');
  const id = String(formData.get('tokenId') ?? '');
  if (/^[0-9a-f-]{36}$/i.test(id)) await revokeMcpToken(user, id);
  revalidatePath('/settings');
}
