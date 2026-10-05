import { renderText, textToDoc, type DocNode } from '@/lib/email/doc';
import { greeted, lintEmail, mentions, type LintIssue, type VehicleKind } from '@/lib/email/lint';
import type { DraftPurpose, DraftWarning, EmailKind, Prefill } from './types';

/**
 * The pure parts of email drafts: what a new draft starts with, which email the LP page offers, and
 * what the draft-time checks say (docs/25 §Where boxes appear, §Domain rules; docs/email-guidelines.md).
 * The service gathers the records; these decide.
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

const tokens = (s: string) => s.toLowerCase().split(/[\s,]+/).filter(Boolean);

/** The strategy's first message (W5 `firstMessage`, lib/enrich/strategy.ts), as the prefill reads it. */
export interface FirstMessageInput {
  kind: EmailKind;
  from: string;
  to: { name: string; key?: string | null; isPerson?: boolean };
  subject: string;
  body: string;
  blurb?: string | null;
}

const KINDS: EmailKind[] = ['intro_ask', 'after_intro', 'cold', 'follow_up', 'reply'];
const str = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** The field as stored in a suggestion's data, or null when it is missing or malformed. */
export function readFirstMessage(x: unknown): FirstMessageInput | null {
  const m = x as Partial<FirstMessageInput> | null | undefined;
  if (!m || typeof m !== 'object') return null;
  if (!KINDS.includes(m.kind as EmailKind) || !str(m.from) || !m.to || typeof m.to !== 'object' || !str(m.to.name) || !str(m.subject) || !str(m.body)) return null;
  return {
    kind: m.kind as EmailKind, from: m.from.trim(), subject: m.subject.trim(), body: m.body.trim(),
    to: { name: m.to.name.trim(), key: str(m.to.key) ? m.to.key : null, isPerson: m.to.isPerson !== false },
    blurb: str(m.blurb) ? m.blurb.trim() : null,
  };
}

/** The guideline's structure, shown when the box starts empty (docs/email-guidelines.md §Structure). */
export const STEPS: Record<'intro_ask' | 'first_message', string[]> = {
  intro_ask: [
    'Why you are asking them: how they know the LP, in a line.',
    'Why the LP, in a sentence: what would make this matter to them.',
    'The ask: would they check with the LP first, and introduce you if the LP is glad to (double opt-in).',
    'Under your sign-off, a 3–4 sentence note they can forward, written for the LP to read.',
  ],
  first_message: [
    'Why them: one specific thing they did or said, in your own words. No sources, no dates of reading.',
    'The one thing: one vehicle, one point, said plainly.',
    'One clear ask that is easy to answer: a call, a time, a person to meet.',
    '80–150 words, in your voice. No amounts unless already discussed, no other LPs, no notes or scores.',
  ],
};

export interface PrefillInput {
  purpose: DraftPurpose;
  senderName: string;
  vehicleName: string;
  /** For the one-vehicle check on the strategy's draft. Omitted: only other vehicles' names are checked. */
  vehicleKind?: VehicleKind;
  otherVehicles?: Array<{ name: string }>;
  lpName: string | null;
  lpIsPerson: boolean;
  connectorName?: string | null;
  connectorIsPerson?: boolean;
  /**
   * The suggested strategy (W5), when there is one. Only its `firstMessage` is ever used; its angle,
   * reasoning and money range never reach a draft.
   */
  strategy?: { firstMessage: unknown; suggestionId: string; madeAt: string } | null;
  previousSubject?: string | null;
}

/** Why the strategy's first message can't start this draft; empty when it can. */
export function firstMessageProblems(fm: FirstMessageInput, p: PrefillInput): string[] {
  const out: string[] = [];
  const intro = p.purpose === 'intro_ask';
  if (intro !== (fm.kind === 'intro_ask')) out.push(intro ? 'it is written to the LP, not to the connector' : 'it is an intro ask to the connector, not a message to the LP');
  const recipient = intro ? p.connectorName ?? null : p.lpName;
  const recipientIsPerson = intro ? p.connectorIsPerson ?? true : p.lpIsPerson;
  const hi = greeted(fm.body);
  if (hi && recipient && recipientIsPerson && !tokens(recipient).includes(hi.toLowerCase())) out.push(`it greets ${hi}, but this email goes to ${recipient}`);
  if (intro && recipient && !tokens(recipient).some((w) => tokens(fm.to.name).includes(w))) out.push(`it is written to ${fm.to.name}, but this intro ask goes to ${recipient}`);
  const vehicle = p.vehicleKind ? { name: p.vehicleName, kind: p.vehicleKind } : null;
  const issues: LintIssue[] = [
    ...lintEmail(fm.body, { recipient: intro ? null : { name: p.lpName, isPerson: p.lpIsPerson }, vehicle, otherVehicles: p.otherVehicles }),
    ...(fm.blurb ? lintEmail(fm.blurb, { recipient: { name: p.lpName, isPerson: p.lpIsPerson }, vehicle, otherVehicles: p.otherVehicles }) : []),
    ...lintEmail(fm.subject, { vehicle, otherVehicles: p.otherVehicles }),
  ];
  for (const i of issues) out.push(`${i.text}${i.match ? ` (“${i.match}”)` : ''}`);
  if (intro && !fm.blurb) out.push('it has no note for the connector to forward');
  return out;
}

/**
 * The first words of a new draft (docs/email-guidelines.md). From the strategy's own first message
 * when it has a clean one for this kind of email; otherwise an empty box with the guideline's
 * structure beside it. Never the strategy's angle or analysis, never a template line, never an amount.
 */
export function prefillDraft(p: PrefillInput): { subject: string; doc: DocNode; prefill: Prefill } {
  if (p.purpose === 'follow_up') {
    const hi = firstName(p.lpName, p.lpIsPerson);
    return {
      subject: p.previousSubject ?? p.vehicleName,
      doc: { type: 'doc', content: [para(hi ? `Hi ${hi},` : 'Hi,'), para('')] },
      prefill: { source: 'previous', kind: 'follow_up', note: 'A follow-up in the same thread as the earlier draft.' },
    };
  }
  const intro = p.purpose === 'intro_ask';
  const fm = p.strategy ? readFirstMessage(p.strategy.firstMessage) : null;
  const problems = fm ? firstMessageProblems(fm, p) : [];
  if (fm && !problems.length) {
    const content = textToDoc(fm.body).content ?? [];
    // An intro ask's forwardable note goes under the sign-off, as written: no words of ours around it.
    const blurb = intro && fm.blurb ? textToDoc(fm.blurb).content ?? [] : [];
    return {
      subject: fm.subject,
      doc: { type: 'doc', content: [...content, ...blurb] },
      prefill: {
        source: 'strategy', kind: fm.kind, from: fm.from, suggestionId: p.strategy!.suggestionId, madeAt: p.strategy!.madeAt,
        note: `The suggested strategy’s ${intro ? 'intro ask, with the note to forward under the sign-off' : 'first message'}, for ${fm.from} to send. Read it as ${fm.from} would say it, and make it theirs before it goes anywhere.`,
      },
    };
  }
  const to = intro ? firstName(p.connectorName ?? null, p.connectorIsPerson ?? true) : firstName(p.lpName, p.lpIsPerson);
  const why = !p.strategy ? 'There is no suggested strategy for this LP yet'
    : !fm ? 'The suggested strategy has no first message written yet (a later strategy pass adds one)'
      : `The suggested strategy’s draft was set aside: ${problems.slice(0, 2).join('; ')}`;
  return {
    subject: intro ? `Intro to ${p.lpName ?? 'them'}?` : '',
    doc: { type: 'doc', content: [para(to ? `Hi ${to},` : 'Hi,'), para('')] },
    prefill: {
      source: 'empty', kind: intro ? 'intro_ask' : null, from: fm?.from ?? null,
      suggestionId: p.strategy?.suggestionId ?? null, madeAt: p.strategy?.madeAt ?? null,
      note: `${why}, so this starts empty. Write it to ${intro ? (p.connectorName ?? 'the connector') : (p.lpName ?? 'them')}, in this order:`,
      steps: STEPS[intro ? 'intro_ask' : 'first_message'],
    },
  };
}

// ── Which email the LP page offers ──────────────────────────────────────────────────────

/** The best route on file for an LP, as the LP page's warm-intro box ranks them. */
export interface RouteHint {
  /** The team member at the start of the route: who holds it. */
  holder: string | null;
  /** The first person between us and the LP, when there is one. */
  connector: { entityId: string; name: string } | null;
  tier: 'A' | 'B' | 'C' | 'D';
}

export interface EmailPlan {
  purpose: 'first_message' | 'intro_ask';
  kind: EmailKind;
  /** For an intro ask: the connector it goes to. */
  connector: { entityId: string; name: string } | null;
  /** Who should send it: the strategy's sender, or the route holder. */
  sender: string | null;
  why: string;
}

/**
 * The email to offer first (docs/email-guidelines.md §Kinds). The strategy's own first message
 * decides when it has one; otherwise the route does: through someone, to an LP who has not met us,
 * the first email is the intro ask to that connector, never a cold note to the LP.
 */
export function chooseFirstEmail(i: { firstMessage: unknown; best: RouteHint | null; metUs: boolean }): EmailPlan {
  const fm = readFirstMessage(i.firstMessage);
  const strong = i.best && (i.best.tier === 'A' || i.best.tier === 'B') ? i.best : null;
  if (fm?.kind === 'intro_ask') {
    // The connector the strategy names, by key; else the best route's, when it is the same person by name.
    const named = fm.to.key ? { entityId: fm.to.key, name: fm.to.name }
      : strong?.connector && strong.connector.name.toLowerCase() === fm.to.name.toLowerCase() ? strong.connector : null;
    if (named) return { purpose: 'intro_ask', kind: 'intro_ask', connector: named, sender: fm.from, why: `The strategy’s route goes through ${named.name}: ask them for the introduction first.` };
  }
  if (fm && fm.kind !== 'intro_ask') {
    return {
      purpose: 'first_message', kind: fm.kind, connector: null, sender: fm.from,
      why: fm.kind === 'after_intro' ? `The strategy’s first message, for ${fm.from} to send after the introduction.` : `The strategy’s ${fm.kind.replace('_', ' ')}, for ${fm.from} to send.`,
    };
  }
  if (i.metUs) return { purpose: 'first_message', kind: 'follow_up', connector: null, sender: null, why: 'They have met us or written to us, so no introduction is needed.' };
  if (strong?.connector) {
    return {
      purpose: 'intro_ask', kind: 'intro_ask', connector: strong.connector, sender: strong.holder,
      why: `The best route goes through ${strong.connector.name}${strong.holder ? `, held by ${strong.holder}` : ''}: ask them for the introduction rather than writing cold.`,
    };
  }
  if (strong) return { purpose: 'first_message', kind: 'after_intro', connector: null, sender: strong.holder, why: `${strong.holder ?? 'A team member'} knows them directly, so the first message comes from them.` };
  return { purpose: 'first_message', kind: 'cold', connector: null, sender: null, why: 'No strong route on file, so this would be a cold note: keep it short and specific, and look for a route first.' };
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
  /** Who the words go to, for the guideline checks: the LP of a first message, the connector of an intro ask. */
  recipient?: { name: string | null; isPerson: boolean } | null;
  /** Who the strategy says sends it (the route holder), and who owns this draft. */
  intendedSender?: string | null;
  ownerName?: string | null;
}

const nameTokens = (s: string) => s.toLowerCase().split(/[\s,.]+/).filter((w) => w.length > 1);

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
  // Rule 3 since 5 Oct 2026: a person needs no INTRO_ASK ticket — sending this email is the ask, theirs to
  // make with the context in front of them. What is on file is said, so the sender sees it; never a gate.
  if (c.purpose === 'intro_ask') {
    const mine = c.introAsks.filter((a) => a.connectorId === c.connectorId);
    const others = c.introAsks.filter((a) => a.connectorId !== c.connectorId && (a.status === 'proposed' || a.status === 'approved' || a.status === 'made'));
    if (mine.some((a) => a.status === 'blocked')) {
      out.push({ level: 'check', rule: 'intro_ticket', text: 'The ask on file for this route is blocked by a guard. Read why on the asks page before you send.' });
    } else if (!mine.length) {
      out.push({ level: 'note', rule: 'intro_ticket', text: 'No ask is on file for this route; sending this email is the ask. No approval is needed.' });
    }
    if (others.length) out.push({ level: 'note', rule: 'intro_ticket', text: `${others.length} other ${others.length === 1 ? 'ask is' : 'asks are'} on file for them, through someone else.` });
  }
  // The email guidelines (docs/email-guidelines.md): what never goes in an email, and one vehicle.
  // A warning, never a block: the person may have discussed an amount, say. Another vehicle by name
  // is already said above.
  const named = out.some((w) => w.rule === 'other_vehicle');
  const issues = lintEmail(hay, {
    recipient: c.purpose === 'intro_ask' ? null : c.recipient ?? null,
    vehicle: { name: c.vehicle.name, kind: c.vehicle.kind },
  }).filter((i) => i.rule !== 'other_vehicle' && !(named && i.rule === 'mixed_vehicles'));
  if (issues.length) {
    out.push({ level: 'check', rule: 'guidelines', text: `Against the email guidelines: ${issues.slice(0, 3).map((i) => `${i.text}${i.match ? ` (“${i.match}”)` : ''}`).join('; ')}${issues.length > 3 ? `; and ${issues.length - 3} more` : ''}.` });
  }
  // Who sends: the route holder (docs/email-guidelines.md §Who sends).
  if (c.intendedSender && c.ownerName && !nameTokens(c.intendedSender).some((w) => nameTokens(c.ownerName!).includes(w))) {
    out.push({ level: 'check', rule: 'sender', text: `The strategy has ${c.intendedSender} sending this, as the route holder. Pass it to them rather than sending it yourself, unless you hold the relationship.` });
  }
  return out;
}
