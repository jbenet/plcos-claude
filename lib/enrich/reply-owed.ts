import type { Touchpoint } from '@/modules/meetings';
import { isAutoReply } from '@/modules/meetings';

type Participant = { person?: { id: number; type: string } };
type Email = { type?: string; sentAt?: string; massMailing?: boolean; from?: Participant | Participant[];
  to?: Participant[]; cc?: Participant[]; toPreview?: { data: Participant[]; totalCount: number };
  ccPreview?: { data: Participant[]; totalCount: number }; subject?: string };
type Entry = { entity: { fields?: Array<{ value: { type: string; data: unknown } | null }> } };

/** Index the account-wide replica once; do not scan every email again for each LP. */
export function emailEntriesByPerson(payloads: unknown[]): Map<string, Entry[]> {
  const result = new Map<string, Entry[]>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const e = payload as Email;
    if (e.type !== 'email') continue;
    const from = Array.isArray(e.from) ? e.from : e.from ? [e.from] : [];
    const participants = [...from, ...(e.to ?? e.toPreview?.data ?? []), ...(e.cc ?? e.ccPreview?.data ?? [])];
    const keys = new Set(participants.filter(p => p?.person?.type === 'external' && p.person.id != null).map(p => `person:${p.person!.id}`));
    const entry = { entity: { fields: [{ value: { type: 'interaction', data: payload } }] } };
    for (const key of keys) {
      const list = result.get(key) ?? []; list.push(entry); result.set(key, list);
    }
  }
  return result;
}

/** GUESS: at most three recipients, all internal, is a small personal exchange. Missing metadata fails closed. */
export function replyOwedSince(entries: Entry[], sourceKey: string, touches: Touchpoint[], now = new Date()): string | null {
  const personId = sourceKey.match(/^person:(\d+)$/)?.[1];
  if (!personId) return null;
  let inbound = 0, outbound = 0;
  for (const entry of entries) for (const field of entry.entity.fields ?? []) {
    if (field.value?.type !== 'interaction' || !field.value.data) continue;
    const e = field.value.data as Email;
    const at = Date.parse(e.sentAt ?? '');
    if (e.type !== 'email' || !Number.isFinite(at) || at > now.getTime()) continue;
    const from = Array.isArray(e.from) ? e.from : e.from ? [e.from] : [];
    const to = e.to ?? e.toPreview?.data ?? [];
    const cc = e.cc ?? e.ccPreview?.data ?? [];
    const isLP = (p: Participant) => String(p.person?.id) === personId && p.person?.type === 'external';
    if (from.some(p => p.person?.type === 'internal') && [...to, ...cc].some(isLP)) outbound = Math.max(outbound, at);
    const count = Math.max(to.length, e.toPreview?.totalCount ?? 0) + Math.max(cc.length, e.ccPreview?.totalCount ?? 0);
    if (!from.some(isLP) || e.massMailing !== false || count < 1 || count > 3
      || count !== to.length + cc.length || !to.some(p => p.person?.type === 'internal')
      || ![...to, ...cc].every(p => p.person?.type === 'internal')
      || isAutoReply({ direction: 'theirs', aboutBasis: e.subject ?? '' })) continue;
    inbound = Math.max(inbound, at);
  }
  // Translated/local outbound records also count, even when their raw copy is no longer exported.
  for (const t of touches) if (!t.viaOrganization && t.channel === 'email' && t.direction === 'ours' && t.on && t.on <= now) outbound = Math.max(outbound, t.on.getTime());
  return inbound > outbound ? new Date(inbound).toISOString() : null;
}
