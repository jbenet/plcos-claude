import type { DocNode } from '@/lib/email/doc';

export type DraftPurpose = 'first_message' | 'intro_ask' | 'follow_up';
export type DraftMode = 'rich' | 'plain';
export type DraftStatus = 'editing' | 'in_gmail' | 'discarded';

export const PURPOSE_LABEL: Record<DraftPurpose, string> = {
  first_message: 'First message',
  intro_ask: 'Intro ask',
  follow_up: 'Follow-up',
};

export interface Attachment {
  attachmentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  inline: boolean;
  contentId: string;
}

/** The kinds of email in docs/email-guidelines.md; the draft's purpose is how it is stored and checked. */
export type EmailKind = 'intro_ask' | 'after_intro' | 'cold' | 'follow_up' | 'reply';

export const KIND_LABEL: Record<EmailKind, string> = {
  intro_ask: 'Intro ask to the connector',
  after_intro: 'First message from the route holder',
  cold: 'Cold note',
  follow_up: 'Follow-up',
  reply: 'Reply owed',
};

/**
 * Where a new draft's first words came from. `strategy`: the strategy's own first message, as written
 * (W5's `firstMessage`). `empty`: nothing clean to start from, so the box starts empty and `steps`
 * lists the guideline's structure. `template` (before 3 Oct 2026) and `previous` (a follow-up) as before.
 */
export interface Prefill {
  source: 'strategy' | 'template' | 'previous' | 'empty';
  /** What a person should know before moving it. */
  note: string;
  /** The guideline's structure, for an empty box. */
  steps?: string[];
  kind?: EmailKind | null;
  /** Who the strategy says sends it: the route holder. */
  from?: string | null;
  suggestionId?: string | null;
  madeAt?: string | null;
}

export interface Draft {
  draftId: string;
  ownerId: string;
  ownerHandle: string;
  ownerName: string;
  purpose: DraftPurpose;
  vehicleId: string;
  vehicleName: string;
  pursuitId: string | null;
  entityId: string | null;
  entityName: string | null;
  connectorId: string | null;
  connectorName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  mode: DraftMode;
  doc: DocNode | null;
  bodyText: string;
  prefill: Prefill | null;
  messageId: string;
  replyToDraftId: string | null;
  inReplyTo: string | null;
  references: string[];
  status: DraftStatus;
  revision: number;
  gmailAccount: string | null;
  gmailDraftId: string | null;
  gmailThreadId: string | null;
  movedAt: Date | null;
  movedRevision: number | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: Attachment[];
}

/**
 * What the draft-time checks found (docs/25 §Domain rules). A warning never blocks a draft or a
 * move — nothing here sends — but it is shown beside the Move button and recorded in the audit
 * entry of the move. `stop` is for what a person must not send as it stands.
 */
export interface DraftWarning {
  level: 'stop' | 'check' | 'note';
  rule: 'restriction' | 'wrap' | 'grants' | 'intro_ticket' | 'other_vehicle' | 'recipients' | 'attachments' | 'size' | 'empty' | 'guidelines' | 'sender';
  text: string;
}

/** What blocks a move outright: Gmail would refuse it, or it would not be an email. */
export interface MoveBlock { field: 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'size' | 'connection'; text: string }
