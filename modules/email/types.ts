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

export interface Prefill {
  source: 'strategy' | 'template' | 'previous';
  /** What a person should know before moving it: e.g. that a strategy's angle is written about them, not to them. */
  note: string;
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
  rule: 'restriction' | 'wrap' | 'grants' | 'intro_ticket' | 'other_vehicle' | 'recipients' | 'attachments' | 'size' | 'empty';
  text: string;
}

/** What blocks a move outright: Gmail would refuse it, or it would not be an email. */
export interface MoveBlock { field: 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'size' | 'connection'; text: string }
