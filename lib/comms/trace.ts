import { isAutoReply, summarize, type Direction, type Touchpoint, type TouchpointSummary } from '@/modules/meetings';

/**
 * The comms trace (Juan, 5 Oct 2026): "as much as possible we should record all this stuff from events
 * directly in email and let email be the state. we may need to record info happened outside of email but
 * that should be a note ... let the actual comms trace reveal what happened ... im not against logging this
 * stuff, but you'll have to reconcile with actual comms anyway".
 *
 * One merged trace per LP: the touchpoints (Affinity's emails, meetings and calls, the calendar, what was
 * logged here) and the messages juanmail reports from Gmail (`comms_ingest`), each labelled by source. A
 * Gmail message Affinity also has is one row, not two: matched by Message-ID when both sides carry it,
 * otherwise by date, participants and subject, and the match says how sure it is. Last touch, who owes a
 * reply and who holds the thread are read from the merged trace. What the app logged — a message juanmail
 * linked (`outreach_link_message`), an email logged by hand — is an audit of actions, not the state: where
 * it and the trace disagree, the trace is shown and the disagreement flagged.
 *
 * This file is pure: no database, the same input in any order gives the same output (a property).
 */

export type TraceSource = 'affinity' | 'gmail' | 'plcos' | 'linear';
export const SOURCE_LABEL: Record<TraceSource, string> = {
  affinity: 'Affinity', gmail: 'Gmail, via juanmail', plcos: 'PLC OS', linear: 'Linear',
};
export type Confidence = 'exact' | 'high' | 'medium' | 'low';

/** A message juanmail saw in a team mailbox, sent or received: metadata only, never a body. */
export interface CommsMessage {
  /** The RFC 5322 Message-ID, lower-cased without its angle brackets; or `gmail:<id>` when the message had none. */
  messageId: string;
  /** True when messageId is a real Message-ID (the de-duplication key across mailboxes and sources). */
  hasMessageId: boolean;
  gmailId: string | null;
  threadId: string | null;
  sentAt: Date;
  /** Ours: from someone on the team. Theirs: to us. */
  direction: 'ours' | 'theirs';
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  /** The LP the trace is being read for, and how the message reaches them. */
  entityId: string;
  entityName: string;
  /** Null when it is with the LP (or a contact of theirs); else with their firm, named. */
  viaOrganization: string | null;
  viaContact: string | null;
  /** The pursuit juanmail named when it reported it, and that pursuit's vehicle. */
  pursuitId: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  /** What it is about, read from its subject and addresses when it was ingested (the Affinity rule, N59). */
  about: 'raise' | 'other' | null;
  aboutVehicles: string[];
  aboutBasis: string | null;
  /** The team on it — sender and recipients — by name. */
  team: string[];
  /** Whose mailbox reported it first. */
  mailboxOf: string;
}

/** What juanmail linked after a send or a read (`outreach_link_message`): an action logged, not the state. */
export interface CommsLink {
  messageId: string;
  sentAt: Date;
  direction: 'ours' | 'theirs';
  subject: string | null;
  pursuitId: string | null;
  ticketId: string | null;
  linkedByName: string;
  autonomous: boolean;
  linkedAt: Date;
}

/** Another source's record of the same event, and how sure the match is. */
export interface SameAs {
  source: TraceSource;
  ref: string;
  by: 'message-id' | 'date, participants and subject' | 'date and participants' | 'date';
  confidence: Confidence;
}

export interface TraceFlag {
  kind: 'linked_not_in_trace' | 'logged_not_in_trace' | 'agent_send_without_ticket';
  at: Date;
  ref: string;
  text: string;
}

export interface Merged {
  /** Every touchpoint, with each Gmail message no other source has added as its own row; newest first. */
  touches: Touchpoint[];
  /** For a touchpoint: the other sources' records of it (a Gmail message Affinity also has). */
  sameAs: Map<string, SameAs[]>;
  /** For a row that is, or matched, a Gmail message: the message. */
  messageOf: Map<string, CommsMessage>;
  /** Where the app's log and the trace disagree. The trace is what is shown. */
  flags: TraceFlag[];
}

export const sourceOf = (t: Pick<Touchpoint, 'source' | 'sourceRef'>): TraceSource =>
  t.source === 'gmail' ? 'gmail' : t.source === 'us' ? 'plcos' : t.source === 'linear' ? 'linear' : 'affinity';

const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const at = (t: Touchpoint) => (t.on ?? t.scheduledFor)?.getTime() ?? 0;
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
const rank: Record<Confidence, number> = { exact: 3, high: 2, medium: 1, low: 0 };
const byMessage = (a: CommsMessage, b: CommsMessage) => a.sentAt.getTime() - b.sentAt.getTime() || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0);
const byTouch = (a: Touchpoint, b: Touchpoint) => at(a) - at(b) || (a.touchpointId < b.touchpointId ? -1 : a.touchpointId > b.touchpointId ? 1 : 0);

/** A Gmail message as a touchpoint row: an email, ours or theirs, from the trace itself. */
export function gmailTouch(m: CommsMessage, now = new Date()): Touchpoint {
  const future = m.sentAt.getTime() > now.getTime();
  return {
    touchpointId: `gmail:${m.messageId}`, entityId: m.entityId, entityName: m.entityName,
    vehicleId: m.vehicleId, vehicleName: m.vehicleName, channel: 'email', kind: null,
    on: future ? null : m.sentAt, scheduledFor: future ? m.sentAt : null, direction: m.direction as Direction,
    ownerName: m.team[0] ?? m.mailboxOf, attendees: m.team, summary: m.subject, read: null, readByName: null,
    source: 'gmail', sourceRef: `gmail:${m.messageId}`, viaOrganization: m.viaOrganization, viaContact: m.viaContact,
    about: m.about, aboutVehicles: m.aboutVehicles, aboutBasis: m.aboutBasis, aboutBy: m.about ? 'rule' : null, groupSize: 1,
  };
}

/** How well a touchpoint matches a message: null when it is not the same event. */
function matchOf(t: Touchpoint, m: CommsMessage): SameAs | null {
  if (t.channel !== 'email' || !t.on) return null;
  if (t.sourceRef && t.sourceRef === `gmail:${m.messageId}`) return { source: 'gmail', ref: m.messageId, by: 'message-id', confidence: 'exact' };
  // Affinity keeps the day of an email (held_on), not its minute; a logged email, the day it was logged for.
  if (Math.abs(new Date(`${dayOf(t.on)}T00:00:00Z`).getTime() - new Date(`${dayOf(m.sentAt)}T00:00:00Z`).getTime()) > (t.source === 'us' ? DAY : 0)) return null;
  if (t.direction && t.direction !== 'both' && t.direction !== m.direction) return null;
  const team = new Set(m.team.map((x) => x.toLowerCase()));
  const shared = t.attendees.some((a) => team.has(a.toLowerCase())) || (t.ownerName && team.has(t.ownerName.toLowerCase()));
  const subject = t.summary && m.subject && norm(t.summary) === norm(m.subject);
  if (shared && subject) return { source: 'gmail', ref: m.messageId, by: 'date, participants and subject', confidence: 'high' };
  if (shared) return { source: 'gmail', ref: m.messageId, by: 'date and participants', confidence: 'medium' };
  return { source: 'gmail', ref: m.messageId, by: 'date', confidence: 'low' };
}

/** Two reports of one message without a Message-ID (two mailboxes): the same minute, sender, recipients and subject. */
function sameMessage(a: CommsMessage, b: CommsMessage): boolean {
  if (a.hasMessageId && b.hasMessageId) return a.messageId === b.messageId;
  const set = (m: CommsMessage) => [...new Set([...m.to, ...m.cc].map((x) => x.toLowerCase()))].sort().join(',');
  return Math.abs(a.sentAt.getTime() - b.sentAt.getTime()) <= 2 * 60_000 && a.from.toLowerCase() === b.from.toLowerCase()
    && set(a) === set(b) && norm(a.subject) === norm(b.subject);
}

/**
 * Merge the touchpoints with the Gmail messages and the links. Deterministic: inputs are put in a total
 * order first, each touchpoint matches at most one message, and a message goes to the best match (the
 * surest, then the nearest, then the lowest id). Logged-here emails (source 'us') never absorb a Gmail
 * message — they are the app's log — but a match clears them of the "not in the trace" flag.
 */
export function mergeTrace(touches: Touchpoint[], messages: CommsMessage[], links: CommsLink[] = [], now = new Date()): Merged {
  const sameAs = new Map<string, SameAs[]>();
  const messageOf = new Map<string, CommsMessage>();
  const flags: TraceFlag[] = [];
  const add = (id: string, s: SameAs) => sameAs.set(id, [...(sameAs.get(id) ?? []), s]);

  // One row per message, even when two mailboxes reported it without a Message-ID.
  const unique: CommsMessage[] = [];
  for (const m of [...messages].sort(byMessage)) {
    const twin = unique.find((u) => sameMessage(u, m));
    if (twin) { if (twin.messageId !== m.messageId) add(`gmail:${twin.messageId}`, { source: 'gmail', ref: m.messageId, by: 'date, participants and subject', confidence: 'high' }); continue; }
    unique.push(m);
  }

  const sorted = [...touches].sort(byTouch);
  const affinityEmails = sorted.filter((t) => t.source !== 'us' && t.source !== 'gmail' && t.channel === 'email');
  const taken = new Set<string>();
  const rows: Touchpoint[] = sorted.filter((t) => t.source !== 'gmail');
  for (const m of unique) {
    let best: { t: Touchpoint; s: SameAs } | null = null;
    for (const t of affinityEmails) {
      if (taken.has(t.touchpointId)) continue;
      const s = matchOf(t, m);
      if (!s) continue;
      const d = Math.abs(at(t) - m.sentAt.getTime()), bd = best ? Math.abs(at(best.t) - m.sentAt.getTime()) : Infinity;
      if (!best || rank[s.confidence] > rank[best.s.confidence] || (rank[s.confidence] === rank[best.s.confidence] && d < bd)) best = { t, s };
    }
    if (best) {
      taken.add(best.t.touchpointId);
      add(best.t.touchpointId, best.s);
      messageOf.set(best.t.touchpointId, m);
    } else {
      const g = gmailTouch(m, now);
      rows.push(g);
      messageOf.set(g.touchpointId, m);
    }
  }

  // The app's log against the trace.
  const traced = new Set(unique.map((m) => m.messageId));
  for (const l of [...links].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (a.messageId < b.messageId ? -1 : 1))) {
    if (!traced.has(l.messageId)) {
      flags.push({ kind: 'linked_not_in_trace', at: l.sentAt, ref: l.messageId,
        text: `${l.linkedByName}'s mail desk linked a message ${l.direction === 'ours' ? 'sent' : 'received'} ${dayOf(l.sentAt)} that the mail trace has not shown yet.` });
    }
    if (l.autonomous && l.direction === 'ours' && !l.ticketId) {
      flags.push({ kind: 'agent_send_without_ticket', at: l.sentAt, ref: l.messageId, text: `An autonomous send on ${dayOf(l.sentAt)} has no approved ticket linked.` });
    }
  }
  // Only where the trace covers them: with no message from Gmail at all, an absence says nothing.
  if (unique.length) {
    for (const t of sorted.filter((x) => x.source === 'us' && x.channel === 'email' && x.on)) {
      if (!unique.some((m) => matchOf(t, m))) flags.push({ kind: 'logged_not_in_trace', at: t.on!, ref: t.touchpointId, text: `An email logged here for ${dayOf(t.on!)} is not in the mail trace.` });
    }
  }
  flags.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.kind < b.kind ? -1 : 1));
  rows.sort((a, b) => at(b) - at(a) || (a.touchpointId < b.touchpointId ? -1 : a.touchpointId > b.touchpointId ? 1 : 0));
  return { touches: rows, sameAs, messageOf, flags };
}

/** Who owes the next word, from the trace: us (they spoke last), them (we did), or nobody yet. */
export interface TraceState {
  summary: TouchpointSummary;
  owes: { by: 'us' | 'them'; since: Date } | null;
  /** The latest exchange: its subject, the team on it, and who holds it (sent our latest message in it). */
  thread: { subject: string | null; team: string[]; holder: string | null; messages: number; last: Date } | null;
  /** The latest touches, newest first, each with its source. */
  last: Array<{ on: Date; channel: Touchpoint['channel']; direction: Touchpoint['direction']; source: TraceSource; subject: string | null; team: string[]; sameAs: SameAs[] }>;
}

export function traceState(m: Merged, now = new Date(), lastN = 4): TraceState {
  const summary = summarize(m.touches, now);
  const owes = summary.awaitingSince ? { by: 'them' as const, since: summary.awaitingSince }
    : summary.lastFromThem ? { by: 'us' as const, since: summary.lastFromThem } : null;
  const msgs = [...m.messageOf.values()].filter((x) => !x.viaOrganization && x.sentAt.getTime() <= now.getTime()).sort(byMessage);
  const latest = msgs.at(-1) ?? null;
  let thread: TraceState['thread'] = null;
  if (latest) {
    const same = msgs.filter((x) => (latest.threadId && x.threadId ? x.threadId === latest.threadId : norm(x.subject) === norm(latest.subject)));
    const ours = same.filter((x) => x.direction === 'ours').at(-1);
    thread = {
      subject: latest.subject, team: [...new Set(same.flatMap((x) => x.team))].sort(),
      holder: ours ? ours.team[0] ?? ours.mailboxOf : latest.team[0] ?? latest.mailboxOf, messages: same.length, last: latest.sentAt,
    };
  }
  const own = m.touches.filter((t) => !t.viaOrganization && t.on && t.on.getTime() <= now.getTime() && t.channel !== 'research' && !isAutoReply(t));
  const last = own.slice(0, lastN).map((t) => ({
    on: t.on!, channel: t.channel, direction: t.direction, source: sourceOf(t),
    subject: m.messageOf.get(t.touchpointId)?.subject ?? (t.source === 'gmail' ? t.summary : null),
    team: m.messageOf.get(t.touchpointId)?.team ?? t.attendees, sameAs: m.sameAs.get(t.touchpointId) ?? [],
  }));
  return { summary, owes, thread, last };
}

/** Message-IDs as RFC 5322 writes them, `<abc@host>`, kept lower-cased without the brackets. */
export function normalizeMessageId(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, '').trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>]+$/.test(s) && s.length <= 400 ? s : null;
}
