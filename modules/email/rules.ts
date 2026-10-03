import { renderText, textToDoc, type DocNode } from '@/lib/email/doc';
import type { DraftPurpose, DraftWarning, Prefill } from './types';

/**
 * The pure parts of email drafts: what a new draft starts with, and what the draft-time checks
 * say (docs/25 §Where boxes appear, §Domain rules). The service gathers the records; these decide.
 */

const firstName = (name: string | null, isPerson: boolean) => {
  if (!name || !isPerson) return null;
  const first = name.trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}][\p{L}'’.-]*$/u.test(first) ? first : null;
};

const para = (...parts: Array<string | { br: true }>): DocNode => ({
  type: 'paragraph',
  content: parts.flatMap((p) => (typeof p === 'string' ? (p ? [{ type: 'text', text: p }] : []) : [{ type: 'hardBreak' }])),
});

export interface PrefillInput {
  purpose: DraftPurpose;
  senderName: string;
  vehicleName: string;
  lpName: string | null;
  lpIsPerson: boolean;
  connectorName?: string | null;
  connectorIsPerson?: boolean;
  /** The suggested strategy's angle and ask (W5), when there is one. Never its money range. */
  strategy?: { angle: string; askShape: string; suggestionId: string; madeAt: string } | null;
  previousSubject?: string | null;
}

/**
 * The first words of a new draft. Amounts are never filled in, and a strategy's angle — written
 * about them, for us — is marked to be rewritten before it goes anywhere.
 */
export function prefillDraft(p: PrefillInput): { subject: string; doc: DocNode; prefill: Prefill } {
  const sign = para('Best,', { br: true }, p.senderName);
  if (p.purpose === 'intro_ask') {
    const hi = firstName(p.connectorName ?? null, p.connectorIsPerson ?? true);
    const lp = p.lpName ?? 'them';
    return {
      subject: `Intro to ${lp}?`,
      doc: { type: 'doc', content: [
        para(hi ? `Hi ${hi},` : 'Hi,'),
        para(`Would you be open to introducing me to ${lp}? We are raising ${p.vehicleName}, and I think it could be of interest to them.`),
        para('If it helps, I can send a short note you can forward. And if the timing is wrong, no problem at all.'),
        sign,
      ] },
      prefill: { source: 'template', note: 'A starting point for an intro ask. Make it yours: why this connector, and why now.' },
    };
  }
  if (p.purpose === 'follow_up') {
    const hi = firstName(p.lpName, p.lpIsPerson);
    return {
      subject: p.previousSubject ?? p.vehicleName,
      doc: { type: 'doc', content: [para(hi ? `Hi ${hi},` : 'Hi,'), para(''), sign] },
      prefill: { source: 'previous', note: 'A follow-up in the same thread as the earlier draft.' },
    };
  }
  const hi = firstName(p.lpName, p.lpIsPerson);
  const content: DocNode[] = [para(hi ? `Hi ${hi},` : 'Hi,')];
  if (p.strategy?.angle) content.push(para(p.strategy.angle));
  content.push(para(`I would like to tell you about ${p.vehicleName}. Would you have time for a short call in the next couple of weeks?`));
  content.push(sign);
  return {
    subject: p.vehicleName,
    doc: { type: 'doc', content },
    prefill: p.strategy
      ? { source: 'strategy', suggestionId: p.strategy.suggestionId, madeAt: p.strategy.madeAt,
          note: 'The second paragraph is the suggested strategy’s angle. It was written about them, for us: rewrite it to them before moving the draft.' }
      : { source: 'template', note: 'No suggested strategy for this LP yet, so this is a plain opening. Make it yours.' },
  };
}

export const prefillText = (doc: DocNode) => renderText(doc);
export { textToDoc };

// ── Draft-time checks ────────────────────────────────────────────────────────────────────

export interface CheckInput {
  purpose: DraftPurpose;
  vehicle: { id: string; name: string; slug: string; kind: 'fund' | 'spv' | 'grant_rail'; exemption: string };
  otherVehicles: Array<{ name: string; slug: string }>;
  /** Restrictions on the LP (rule 8). For an intro ask, those naming this connector matter most. */
  lpRestrictions: Array<{ scope: 'connector' | 'channel' | 'blanket'; connectorId: string | null; connectorName: string | null; channel: string | null; instruction: string }>;
  connectorId: string | null;
  connectorName: string | null;
  /** Restrictions on the connector themselves, as a target. */
  connectorRestrictions: Array<{ scope: 'connector' | 'channel' | 'blanket'; channel: string | null; instruction: string }>;
  /** The wrap rule for this vehicle's exemption and instrument, if the matrix has one (rule 11). */
  wrap: { found: boolean; note: string | null; maxPermittedUse: string | null; instrument: string };
  /** Rule 12: grants-rail outreach needs a funder invitation. */
  grantGate: { blocked: boolean; reason: string | null } | null;
  /** For an intro ask: asks on file for this LP through this connector on this vehicle. */
  introAsks: Array<{ status: string; connectorId: string | null }>;
  subject: string;
  text: string;
  attachmentCount: number;
}

const mentions = (hay: string, needle: string) =>
  needle.trim().length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${needle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(hay);

export function draftWarnings(c: CheckInput): DraftWarning[] {
  const out: DraftWarning[] = [];
  // Rule 8: a restriction attaches to the target; another channel does not get round it.
  for (const r of c.lpRestrictions) {
    if (r.scope === 'blanket') out.push({ level: 'stop', rule: 'restriction', text: `Do not approach: “${r.instruction}” This applies to any channel, email included.` });
    else if (r.scope === 'channel' && /mail/i.test(r.channel ?? '')) out.push({ level: 'stop', rule: 'restriction', text: `Not by email: “${r.instruction}”` });
    else if (r.scope === 'connector' && c.purpose === 'intro_ask' && r.connectorId && r.connectorId === c.connectorId) {
      out.push({ level: 'stop', rule: 'restriction', text: `Not through ${r.connectorName ?? 'this connector'}: “${r.instruction}” Writing to them for the same introduction would get round it.` });
    } else if (r.scope === 'connector') {
      out.push({ level: 'note', rule: 'restriction', text: `On file: not through ${r.connectorName ?? 'one connector'} (“${r.instruction}”). This draft does not go through them.` });
    } else out.push({ level: 'check', rule: 'restriction', text: `Restriction on file: “${r.instruction}”` });
  }
  for (const r of c.connectorRestrictions) {
    if (r.scope === 'blanket' || (r.scope === 'channel' && /mail/i.test(r.channel ?? ''))) out.push({ level: 'stop', rule: 'restriction', text: `${c.connectorName ?? 'This connector'} has a restriction of their own: “${r.instruction}”` });
  }
  // Rule 11: what may be said depends on the vehicle's exemption and instrument.
  if (!c.wrap.found) out.push({ level: 'check', rule: 'wrap', text: `No wrap rule covers ${c.vehicle.exemption} × ${c.wrap.instrument} for ${c.vehicle.name}, so what this email may say about it has not been checked. Ask before sending material.` });
  else if (c.wrap.note) out.push({ level: 'note', rule: 'wrap', text: `${c.vehicle.name} (${c.vehicle.exemption}): ${c.wrap.note}` });
  if (/506\(b\)/i.test(c.vehicle.exemption) && c.purpose !== 'follow_up') out.push({ level: 'check', rule: 'wrap', text: `${c.vehicle.name} is a 506(b) offering: no general solicitation. Write only to someone the team already has a substantive relationship with.` });
  const hay = `${c.subject}\n${c.text}`;
  for (const v of c.otherVehicles) {
    if (mentions(hay, v.name)) out.push({ level: 'check', rule: 'other_vehicle', text: `This draft is for ${c.vehicle.name} and names ${v.name}. Material for one vehicle in another’s email is a wrong wrap: check each claim is in scope.` });
  }
  if (c.attachmentCount > 0) out.push({ level: 'note', rule: 'attachments', text: `${c.attachmentCount === 1 ? 'The attached file is' : `The ${c.attachmentCount} attached files are`} not checked against the materials matrix. Attach only material approved for ${c.vehicle.name}.` });
  // Rule 12.
  if (c.vehicle.kind === 'grant_rail' && c.grantGate?.blocked) out.push({ level: 'stop', rule: 'grants', text: c.grantGate.reason ?? 'Grants-rail outreach needs a funder invitation on file.' });
  // Rule 3: an intro ask is gated by an approved INTRO_ASK ticket. A draft is not the ask; sending it is.
  if (c.purpose === 'intro_ask') {
    const mine = c.introAsks.filter((a) => a.connectorId === c.connectorId);
    if (!mine.some((a) => a.status === 'approved' || a.status === 'made')) {
      out.push({ level: 'check', rule: 'intro_ticket', text: mine.some((a) => a.status === 'proposed')
        ? 'The intro ask for this route is proposed and not yet approved. Wait for the approval before sending this email.'
        : 'No intro ask is on file for this route. Propose it (INTRO_ASK) and have it approved before sending this email.' });
    }
  }
  return out;
}
