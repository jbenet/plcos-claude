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
  /** Null when the meeting was not about one vehicle in particular (N51). */
  vehicleName: string | null;
  kind: MeetingKind | null;
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

// ---------------------------------------------------------------- touchpoints (N51, docs/17)

/** What kind of contact it was. A meeting is the commonest touchpoint, not the only one. */
export type Channel = 'meeting' | 'call' | 'email' | 'message' | 'intro' | 'event' | 'research';
/** Who reached out: we did, they did, or both were in it (a meeting). */
export type Direction = 'ours' | 'theirs' | 'both';
/** Their read after a touchpoint, by whoever was there. Recorded, never computed. */
export type Read = 'very_interested' | 'interested' | 'not_very_interested';

export const CHANNELS: Channel[] = ['meeting', 'call', 'email', 'message', 'intro', 'event', 'research'];
export const CHANNEL_LABEL: Record<Channel, string> = {
  meeting: 'Meeting', call: 'Call', email: 'Email', message: 'Message', intro: 'Intro', event: 'Event',
  research: 'Research pass',
};
export const DIRECTION_LABEL: Record<Direction, string> = {
  ours: 'we reached out', theirs: 'they reached out', both: 'both sides',
};
export const READS: Read[] = ['very_interested', 'interested', 'not_very_interested'];
export const READ_LABEL: Record<Read, string> = {
  very_interested: 'Very interested', interested: 'Interested', not_very_interested: 'Not very interested',
};

export interface Touchpoint {
  touchpointId: string;
  entityId: string;
  entityName: string;
  /** About one vehicle, or none in particular — most of what Affinity records is the latter. */
  vehicleId: string | null;
  vehicleName: string | null;
  channel: Channel;
  kind: MeetingKind | null;
  /** When it happened. Null for one that is only scheduled. */
  on: Date | null;
  scheduledFor: Date | null;
  direction: Direction | null;
  ownerName: string;
  attendees: string[];
  summary: string | null;
  read: Read | null;
  readByName: string | null;
  /** 'us' when logged here; 'affinity' when read from a note or a list entry's dates. */
  source: string;
  sourceRef: string | null;
  /** Set when the touchpoint is with the LP's firm rather than with them: the firm's name. */
  viaOrganization: string | null;
  /**
   * What it is about (N59), decided when it was translated: 'raise', 'other', or null for one
   * logged here. With the vehicles it names, and the words the decision rests on.
   */
  about: 'raise' | 'other' | null;
  aboutVehicles: string[];
  aboutBasis: string | null;
}

/** When a vehicle is raising (N59), what a touchpoint's date is held against. */
export interface RaiseWindow { vehicleId: string; slug: string; name: string; opens: Date | null; closes: Date | null; note: string | null }

/**
 * Whether a touchpoint is about this vehicle's raise (N59, docs/18). One tied to the vehicle
 * is; one tied to another vehicle isn't; one logged here with no vehicle is about any raise.
 * One read from Affinity counts when it was read as about a raise, names this vehicle or none,
 * and falls inside the raise window. Anything else is contact history, kept for the LP's own
 * page. The same rule is written in SQL in the meetings repo for the lists; change both.
 */
export function aboutThisRaise(t: Touchpoint, w: RaiseWindow): boolean {
  if (t.vehicleId) return t.vehicleId === w.vehicleId;
  if (t.source === 'us') return true;
  if (t.about !== 'raise') return false;
  if (t.aboutVehicles.length && !t.aboutVehicles.includes(w.slug)) return false;
  // With no window known, a record about a raise in general can't be placed: only one that
  // names this vehicle counts for it.
  if (!w.opens && !w.closes && !t.aboutVehicles.includes(w.slug)) return false;
  const on = t.on ?? t.scheduledFor;
  if (!on) return false;
  if (w.opens && on.getTime() < w.opens.getTime()) return false;
  if (w.closes && on.getTime() >= w.closes.getTime() + 86_400_000) return false;
  return true;
}

/**
 * Whom the team is already in touch with (issue 0027, real): the latest meeting or call held with
 * them, or message from them — our own record of direct contact. A message only we sent is not
 * contact; nobody has answered it.
 */
export interface DirectContact {
  on: Date;
  how: 'met' | 'heard';
  /** For an organisation: the person acting for it whom the contact was with. Null when it was them. */
  via: string | null;
}

/** Derived from the log, never stored: what the twelve stages used to try to say. */
export interface TouchpointSummary {
  /** Meetings and calls held, oldest first — the first meeting, the second, and so on. */
  meetingDates: Date[];
  lastTouch: Date | null;
  lastTouchChannel: Channel | null;
  /** The last time they reached out, or were in a meeting. */
  lastFromThem: Date | null;
  /** Our outreach with nothing from them since: waiting on their reply since this date. */
  awaitingSince: Date | null;
  nextMeeting: Date | null;
  read: { read: Read; on: Date | null; byName: string | null } | null;
  lastResearched: Date | null;
  total: number;
  /**
   * Their firm's touchpoints, counted apart (N55): a meeting with a colleague at the same firm is
   * not a meeting with this LP, and counting it as one invented next meetings and second
   * meetings that were someone else's (Juan, 23 Sep).
   */
  withFirm: { total: number; lastTouch: Date | null; nextMeeting: Date | null };
}
