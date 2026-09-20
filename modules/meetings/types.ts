import type { LadderRung } from '@/modules/strategy/client';

export type MeetingKind = 'intro' | 'pitch' | 'diligence' | 'committee' | 'follow_up';
export type ObjectionClass =
  | 'team' | 'thesis' | 'track_record' | 'terms' | 'timing' | 'structure' | 'liquidity' | 'governance';
export type ObjectionStatus = 'open' | 'answered' | 'accepted' | 'fatal';
export type QuestionStatus = 'open' | 'answered' | 'blocked' | 'withdrawn';

export const MEETING_LABEL: Record<MeetingKind, string> = {
  intro: 'Intro call', pitch: 'Pitch', diligence: 'Diligence',
  committee: 'Committee', follow_up: 'Follow-up',
};

export const OBJECTION_LABEL: Record<ObjectionClass, string> = {
  team: 'Team', thesis: 'Thesis', track_record: 'Track record', terms: 'Terms',
  timing: 'Timing', structure: 'Structure', liquidity: 'Liquidity', governance: 'Governance',
};

export interface Meeting {
  meetingId: string;
  pursuitId: string | null;
  entityId: string;
  entityName: string;
  vehicleName: string;
  kind: MeetingKind;
  scheduledFor: Date | null;
  heldOn: Date | null;
  attendees: string[];
  ownerName: string;
  summary: string | null;
  justifiesRung: LadderRung | null;
  justification: string | null;
}

export interface Objection {
  objectionId: string;
  meetingId: string | null;
  entityId: string;
  entityName: string;
  class: ObjectionClass;
  statement: string;
  status: ObjectionStatus;
  answer: string | null;
  answerSource: string | null;
  answeredByName: string | null;
  answeredAt: Date | null;
}

export interface DiligenceQuestion {
  questionId: string;
  entityId: string;
  entityName: string;
  vehicleName: string;
  question: string;
  askedOn: Date | null;
  dueOn: Date | null;
  ownerName: string | null;
  status: QuestionStatus;
  answer: string | null;
  answerSource: string | null;
  overdue: boolean;
}

/** What a brief may say, and what it must refuse to say. */
export interface PrepBrief {
  entityId: string;
  entityName: string;
  vehicleName: string;
  meeting: Meeting | null;
  /** Claims with a complete provenance tuple. Everything else is excluded by construction. */
  supported: Array<{ field: string; value: string; source: string; asOf: Date; verifiedBy: string | null }>;
  /** Named, so the gap is visible rather than absent. */
  refused: Array<{ field: string; why: string }>;
  openObjections: Objection[];
  openQuestions: DiligenceQuestion[];
  currentRung: LadderRung | null;
  restriction: string | null;
}
