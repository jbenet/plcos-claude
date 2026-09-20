export type ApprovalKind = 'SEND' | 'INTRO_ASK' | 'MONEY' | 'STAGE' | 'ALLOCATION_EXCEPTION';
export type ApprovalDecision = 'approve' | 'reject' | 'request_changes' | 'defer';

/** The bounded action a ticket authorizes. Stated, never an opaque bundle. */
export interface TicketScope {
  /** One sentence: exactly what may happen if this is approved. */
  authorizes: string;
  /** What it explicitly does not authorize. The half people forget. */
  excludes: string[];
  /** Named facts the approver should weigh, each with where it came from. */
  basis?: Array<{ label: string; value: string; source?: string }>;
  /**
   * The bounded action as data. Approving the ticket runs exactly this and nothing else,
   * which is what makes "a specific bounded action" checkable rather than a promise.
   */
  apply?: { command: string; args: Record<string, unknown> };
}

export interface ApprovalTicket {
  id: string;
  kind: ApprovalKind;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  scope: TicketScope;
  vehicleId: string | null;
  vehicleName: string | null;
  requestedBy: string;
  requestedByName: string;
  decidedByName: string | null;
  decision: ApprovalDecision | null;
  decisionNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export const KIND_CLASS: Record<ApprovalKind, string> = {
  SEND: 'k-send',
  INTRO_ASK: 'k-intro',
  MONEY: 'k-money',
  STAGE: 'k-stage',
  ALLOCATION_EXCEPTION: 'k-alloc',
};

export const KIND_GATES: Record<ApprovalKind, string> = {
  SEND: 'Any material leaving the building.',
  INTRO_ASK: 'Asking a connector to make an introduction.',
  MONEY: 'Recording a commitment or a receipt.',
  STAGE: 'Advancing a target along the consent ladder.',
  ALLOCATION_EXCEPTION: 'Breaking an allocation rule on purpose.',
};
