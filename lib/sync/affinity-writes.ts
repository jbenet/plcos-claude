import { getDb } from '@/lib/db';
import { cappedText } from '@/lib/body-cap';
import { openWriteBatch, proposeAffinityWrites } from '@/lib/affinity-writes';
import { checkParties, MAX_PARTIES } from '@/lib/outreach/parties';
import { auditSync, type SyncCaller } from './auth';
import type { PushAnswer } from './push';

/**
 * GET|POST /api/sync/affinity: the Affinity writes Juan approves by batch (lib/affinity-writes.ts), by an Admin's token
 * (sync:admin; Juan, 15 Oct 2026: "update affinity"). JuanMail proposes from the mail it reads; this proposes from the
 * mail PLC OS already holds (email.comms_message, the token owner's own sent mail), so a cloud session can fill the
 * batch without JuanMail. Proposing writes nothing to Affinity: a person still decides the batch in Approvals, and
 * nothing here can decide it (the decide file stays out of reach, scripts/properties/mcp.ts).
 *
 *   GET                                         → 200 { batch } the open batch: per plan counts and its items
 *   POST { since: 'YYYY-MM-DD', dryRun? }       → 200 { considered, proposed, left } the owner's sent mail since that day,
 *                                                 by recipient: internal and covered addresses are left out, and so is
 *                                                 anyone neither on file here, in Affinity, nor sent mail about a raise
 *
 * Names and addresses go back to the token's holder only; the audit row carries counts.
 */

const MAX_BYTES = 1024;
const SUBJECT_MAX = 300;
const THREAD = /^[\w-]{1,100}$/;

type Row = { sent_at: Date; subject: string | null; thread_id: string | null; to_addrs: string[]; cc_addrs: string[]; from_addr: string };
type Msg = { at: string; subject?: string; gmailThreadId?: string; to: boolean };

export async function readAffinityBatch(caller: SyncCaller): Promise<PushAnswer> {
  const open = await openWriteBatch();
  const count = (p: string) => open?.items.filter((i) => i.plan === p).length ?? 0;
  await auditSync(caller, 'affinity', 'ok', { op: 'read', count: open?.items.length ?? 0 });
  return { status: 200, body: { ok: true, batch: open && {
    batchId: open.batchId, openedAt: open.openedAt,
    plans: { 'person+note': count('person+note'), note: count('note'), skip: count('skip') },
    items: open.items.map((i) => ({ address: i.address, name: i.name, firm: i.firm, plan: i.plan, reason: i.reason, state: i.state,
      messages: i.messages.length, lastSent: i.messages.at(-1)?.at ?? null })),
  }, approve: 'A person decides the batch in PLC OS: Approvals → Affinity writes.' } };
}

export async function proposeFromSentMail(caller: SyncCaller, request: Request): Promise<PushAnswer> {
  const raw = await cappedText(request, MAX_BYTES);
  if (raw === null) return bad(caller, 413, 'size', `At most ${MAX_BYTES} bytes.`);
  let input: { since?: unknown; dryRun?: unknown };
  try { input = JSON.parse(raw); } catch { return bad(caller, 400, 'json', 'The call is not JSON.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(caller, 422, 'shape', 'Send { since, dryRun? }.');
  const extra = Object.keys(input).filter((k) => k !== 'since' && k !== 'dryRun');
  if (extra.length) return bad(caller, 422, 'shape', `Unknown fields: ${extra.join(', ')}.`);
  if (typeof input.since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.since) || Number.isNaN(Date.parse(input.since))) {
    return bad(caller, 422, 'since', 'since is a day, YYYY-MM-DD.');
  }
  const dryRun = input.dryRun === true;

  const db = await getDb();
  const rows = await db.query<Row>(`select sent_at, subject, thread_id, to_addrs, cc_addrs, from_addr from email.comms_message
      where direction = 'ours' and (mailbox_of = $1 or $1 = any(seen_by)) and sent_at >= $2::date order by sent_at`, [caller.user.id, input.since]);
  const byAddress = new Map<string, Msg[]>();
  for (const r of rows) {
    const from = r.from_addr.trim().toLowerCase();
    const m = { at: new Date(r.sent_at).toISOString(), ...(r.subject ? { subject: r.subject.slice(0, SUBJECT_MAX) } : {}),
      ...(r.thread_id && THREAD.test(r.thread_id) ? { gmailThreadId: r.thread_id } : {}) };
    const seen = new Set<string>();
    for (const [list, to] of [[r.to_addrs, true], [r.cc_addrs, false]] as const) {
      for (const a of list) {
        const address = a.trim().toLowerCase();
        if (!address || address === from || seen.has(address)) continue;
        seen.add(address);
        byAddress.set(address, [...(byAddress.get(address) ?? []), { ...m, to }]);
      }
    }
  }

  // What PLC OS knows of each recipient, in calls of at most MAX_PARTIES.
  const addresses = [...byAddress.keys()];
  const left = { internal: 0, covered: 0, unknown: 0, invalid: 0 };
  const items: Array<{ address: string; name?: string; messages: Array<{ at: string; subject?: string; gmailThreadId?: string }> }> = [];
  for (let i = 0; i < addresses.length; i += MAX_PARTIES) {
    const chunk = addresses.slice(i, i + MAX_PARTIES).filter((a) => {
      const ok = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(a) && a.length <= 254;
      if (!ok) left.invalid++;
      return ok;
    });
    if (!chunk.length) continue;
    const check = (await checkParties(caller.user, { parties: chunk.map((address) => ({ address,
      sends: byAddress.get(address)!.slice(-500).map((m) => ({ at: m.at, ...(m.subject ? { subject: m.subject } : {}), to: m.to })) })) })).data;
    for (const p of check.parties) {
      if (p.internal) { left.internal++; continue; }
      if (p.affinity?.covered) { left.covered++; continue; }
      // Only people this work is about: on file here, already in Affinity, or sent mail about a raise.
      if (!p.onFile && !p.affinity?.person && !p.raiseVehicles?.length) { left.unknown++; continue; }
      const name = p.onFile?.name ?? p.affinity?.name ?? p.name ?? undefined;
      items.push({ address: p.address, ...(name ? { name: name.slice(0, 200) } : {}),
        messages: byAddress.get(p.address)!.slice(-100).map(({ to: _to, ...m }) => m) });
    }
  }

  if (dryRun || !items.length) {
    await auditSync(caller, 'affinity', 'ok', { op: 'propose', dryRun, considered: addresses.length, items: items.length });
    return { status: 200, body: { ok: true, dryRun, considered: addresses.length, left,
      proposed: items.map((i) => ({ address: i.address, name: i.name ?? null, messages: i.messages.length, lastSent: i.messages.at(-1)!.at })) } };
  }
  const proposed: Array<{ address: string; itemId: string; plan: string; reason: string }> = [];
  for (let i = 0; i < items.length; i += 200) {
    const out = await proposeAffinityWrites({ owner: caller.user, principal: caller.user, tokenId: caller.token.tokenId }, { items: items.slice(i, i + 200) });
    proposed.push(...out.data.items);
  }
  await auditSync(caller, 'affinity', 'ok', { op: 'propose', considered: addresses.length, items: proposed.length });
  return { status: 200, body: { ok: true, considered: addresses.length, left, proposed,
    approve: 'Nothing is written to Affinity until a person approves the batch in PLC OS: Approvals → Affinity writes.' } };
}

async function bad(caller: SyncCaller, status: number, reason: string, error: string): Promise<PushAnswer> {
  await auditSync(caller, 'affinity', 'invalid', { op: 'propose', reason });
  return { status, body: { ok: false, error } };
}
