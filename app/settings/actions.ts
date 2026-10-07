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
  if (!['read', 'draft', 'outreach-read', 'outreach-write', 'snapshot', 'push', 'admin'].includes(preset)) return { ok: false, error: 'Choose what the token may do.' };
  // Cloud sync (docs/deploy/railway.md §6–§7): the scope alone, no tools or vehicles; who may hold it is data in lib/sync/scopes.ts.
  const { grantRefusal, SYNC_ADMIN, SYNC_PUSH, SYNC_SNAPSHOT } = await import('@/lib/sync/scopes');
  const sync = preset === 'snapshot' ? [SYNC_SNAPSHOT] : preset === 'push' ? [SYNC_PUSH] : preset === 'admin' ? [SYNC_ADMIN] : null;
  const refused = sync && grantRefusal(user, sync);
  if (refused) return { ok: false, error: refused };
  // The mail desk's scope (docs/27-outreach-api.md): Admin only for now (Juan, 4 Oct 2026: the desk is his alone).
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('@/lib/outreach/scopes');
  if (preset.startsWith('outreach') && user.access !== 'admin') return { ok: false, error: 'Only an Admin makes outreach desk tokens for now.' };
  // Optional expiry, per device (docs/27 §2): a week, a month, a quarter or a year. GUESS: no device needs longer.
  const days = Number(formData.get('days') ?? config.mcp.tokenDays);
  if (![7, 30, 90, 365].includes(days)) return { ok: false, error: 'Choose when the token expires.' };
  const known = new Set((await listVehicles()).map((v) => v.id));
  const chosen = formData.getAll('vehicle').map(String).filter(Boolean);
  if (chosen.some((v) => !known.has(v))) return { ok: false, error: 'An unknown vehicle was chosen.' };
  // Narrowing only: a vehicle you cannot read cannot be granted to a token.
  if (user.vehicles !== null && chosen.some((v) => !user.vehicles!.includes(v))) return { ok: false, error: 'A token cannot see a vehicle you cannot.' };
  const live = (await listMcpTokens(user.id)).filter((t) => !t.revokedAt && new Date(t.expiresAt) > new Date());
  if (live.length >= 10) return { ok: false, error: 'You have ten live tokens. Revoke one you no longer use first.' }; // GUESS: plenty for one person's devices
  const { token, secret } = await createMcpToken(user, {
    label,
    tools: sync ? sync : preset === 'draft' ? [...TOOL_NAMES]
      : preset === 'outreach-read' ? [...READ_TOOLS, OUTREACH_READ]
        : preset === 'outreach-write' ? [...READ_TOOLS, OUTREACH_READ, OUTREACH_WRITE] : [...READ_TOOLS],
    vehicles: chosen.length && !sync ? chosen : null, callsPerDay: config.mcp.defaultCallsPerDay, days,
  });
  revalidatePath('/settings');
  return { ok: true, secret, prefix: token.prefix, label: token.label };
}

export type SavedVoice = { ok: true; samples: number; styleChars: number; deleted: boolean } | { ok: false; error: string };

/**
 * Your voice (docs/email-guidelines.md §Voice): notes on how you write and up to five emails of
 * yours, for whoever drafts for you. Your own only; saving it empty deletes it.
 */
export async function saveVoiceAction(formData: FormData): Promise<SavedVoice> {
  const user = await requireAction('app/settings/actions.ts#saveVoiceAction', formData);
  const { saveVoice, DraftRefused } = await import('@/modules/email');
  const wipe = formData.get('delete') === '1';
  try {
    const v = await saveVoice(user, {
      style: wipe ? '' : String(formData.get('voiceStyle') ?? ''),
      samples: wipe ? [] : formData.getAll('sample').map(String),
    });
    revalidatePath('/settings');
    return { ok: true, samples: v.samples.length, styleChars: v.style.length, deleted: !v.style && !v.samples.length };
  } catch (e) {
    if (e instanceof DraftRefused) return { ok: false, error: e.message };
    throw e;
  }
}

export async function revokeMcpTokenAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/settings/actions.ts#revokeMcpTokenAction', formData);
  const { revokeMcpToken } = await import('@/modules/platform');
  const id = String(formData.get('tokenId') ?? '');
  if (/^[0-9a-f-]{36}$/i.test(id)) await revokeMcpToken(user, id);
  revalidatePath('/settings');
}
