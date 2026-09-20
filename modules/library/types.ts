export type AnswerStatus = 'draft' | 'approved' | 'needs_review' | 'superseded' | 'withdrawn';

export const ANSWER_STATUS_LABEL: Record<AnswerStatus, string> = {
  draft: 'Draft', approved: 'Approved', needs_review: 'Needs review',
  superseded: 'Superseded', withdrawn: 'Withdrawn',
};

export interface Answer {
  answerId: string;
  question: string;
  answer: string;
  version: number;
  status: AnswerStatus;
  approvedByName: string | null;
  approvedOn: Date | null;
  expiresOn: Date | null;
  supersedes: string | null;
  ownerName: string;
  sources: Array<{ claimId: string | null; docId: string | null; label: string; note: string | null }>;
  uses: Array<{ context: string; entityName: string | null; usedOn: Date }>;
  /** Expired by date, or resting on a claim that has since been superseded. */
  stale: boolean;
  staleReason: string | null;
}

/**
 * A question that keeps coming up with no approved answer behind it. This is module 13's
 * backlog generator: the gap analysis is a query, not a page of its own.
 */
export interface CoverageGap {
  question: string;
  kind: 'objection' | 'diligence';
  occurrences: number;
  entities: string[];
  /** The closest thing in the library, if there is one. */
  nearest: { answerId: string; question: string; status: AnswerStatus } | null;
}
