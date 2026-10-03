/**
 * Threading (docs/25 §Threading). A new email gets its own Message-ID and no thread; a reply or a
 * follow-up names the message it answers. Gmail puts a draft in an existing thread only when
 * all three hold: the threadId is given, In-Reply-To and References name a message of that
 * thread, and the Subject matches (Gmail API guide, "Managing threads").
 *
 * Client-safe and pure: the properties test it directly.
 */

export interface Original {
  /** The answered message's own Message-ID, with angle brackets. */
  messageId: string | null;
  references: string[];
  subject: string | null;
  /** Gmail's thread id, when known. */
  threadId: string | null;
}

export interface ThreadHeaders {
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
}

const MSGID = /^<[^<>\s@]+@[^<>\s@]+>$/;
/** GUESS: mail programs cut References at around twenty; the first and the latest matter most. */
const MAX_REFERENCES = 20;

export function replySubject(subject: string | null, fallback: string): string {
  const s = (subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) return fallback;
  return /^(re|aw|sv|antw)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** The headers for a new message: nothing that ties it to another. */
export function newThread(subject: string): ThreadHeaders {
  return { threadId: null, inReplyTo: null, references: [], subject };
}

/** The headers for a reply to `original`. */
export function replyTo(original: Original, fallbackSubject: string): ThreadHeaders {
  const refs: string[] = [];
  for (const r of [...original.references, ...(original.messageId ? [original.messageId] : [])]) {
    if (MSGID.test(r) && !refs.includes(r)) refs.push(r);
  }
  const references = refs.length > MAX_REFERENCES ? [refs[0]!, ...refs.slice(refs.length - (MAX_REFERENCES - 1))] : refs;
  return {
    threadId: original.threadId,
    inReplyTo: original.messageId && MSGID.test(original.messageId) ? original.messageId : null,
    references,
    subject: replySubject(original.subject, fallbackSubject),
  };
}

/** Of a thread's messages in Gmail's order (oldest first), the one a follow-up answers: the latest with a Message-ID. */
export function latestOf<T extends { messageId: string | null }>(messages: T[]): T | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.messageId) return messages[i]!;
  return null;
}
