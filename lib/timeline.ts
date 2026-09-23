import { listPeriods } from '@/modules/calendar';
import { conditionsFor, listCycles, spvRooms } from '@/modules/close';
import { listAsks } from '@/modules/coordination';
import { listOpenTickets } from '@/modules/governance';
import { listFunders } from '@/modules/grants';
import { listMeetings, listQuestions } from '@/modules/meetings';
import { listAccreditation } from '@/modules/compliance';

/**
 * The plan, projected rather than kept.
 *
 * Nothing on the calendar is stored here. Every bar and every mark is a dated record that
 * already exists somewhere else — a close target, an SPV seat, an ask, a ticket expiry, a
 * condition due date. **A second copy of the plan is the copy that goes stale**, so the
 * calendar reads the same rows the close room and the ask log read, and cannot disagree
 * with them.
 *
 * The cost is that anything nobody has dated does not appear. The page says so.
 */

export type Lane =
  | 'close' | 'spv' | 'outreach' | 'meetings' | 'deadlines' | 'sprint' | 'grants';

export const LANE_LABEL: Record<Lane, string> = {
  sprint: 'Sprints & dead weeks',
  close: 'Close',
  spv: 'SPV seats',
  outreach: 'Asks',
  meetings: 'Meetings',
  deadlines: 'Expiries & due dates',
  grants: 'Grants rail',
};

export const LANE_MEANS: Record<Lane, string> = {
  sprint: 'Periods from the sprint calendar, including the weeks that are structurally dead.',
  close: 'Close targets and the conditions that gate them.',
  spv: 'One bar per seat, invite through wire. An open seat runs to today.',
  outreach: 'Asks with a date on them. An ask nobody scheduled has no mark.',
  meetings: 'Scheduled and held. A held meeting is a fact; a scheduled one is an intention.',
  deadlines: 'Things that expire: tickets, accreditation letters, answers, diligence questions.',
  grants: 'Funder invitations. Outreach is blocked until one exists, so the date is the gate.',
};

export type MarkKind = 'span' | 'point' | 'deadline';

export interface Mark {
  id: string;
  lane: Lane;
  kind: MarkKind;
  label: string;
  detail: string;
  from: Date;
  /** Same as `from` for a point. */
  to: Date;
  vehicleName: string | null;
  /** Renders in the alert colour: overdue, expiring, or structurally dead. */
  alert: boolean;
  /** Renders muted: already done, or a period that suppresses urgency. */
  past: boolean;
  href: string | null;
}

const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function timeline(vehicleName: string | null, now = new Date()): Promise<Mark[]> {
  const [periods, cycles, rooms, asks, tickets, meetings, questions, accreditation, funders] =
    await Promise.all([
      listPeriods(), listCycles(), spvRooms(), listAsks(null), listOpenTickets(),
      listMeetings(), listQuestions(), listAccreditation(), listFunders(),
    ]);

  const marks: Mark[] = [];
  const push = (m: Mark) => {
    if (vehicleName && m.vehicleName && m.vehicleName !== vehicleName) return;
    if (vehicleName && !m.vehicleName && m.lane !== 'sprint') return;
    marks.push(m);
  };

  for (const p of periods) {
    push({
      id: `period:${p.periodId}`, lane: 'sprint', kind: 'span',
      label: p.label, detail: p.detail ?? `${p.kind.replace(/_/g, ' ')}`,
      from: day(p.startsOn), to: day(p.endsOn), vehicleName: p.vehicleName,
      alert: p.suppressUrgency, past: p.suppressUrgency, href: '/calendar',
    });
  }

  for (const c of cycles) {
    push({
      id: `cycle:${c.cycleId}`, lane: 'close', kind: 'deadline',
      label: `${c.label} — close target`,
      detail: c.workingDaysLeft === null
        ? 'No working-day count available.'
        : `${c.workingDaysLeft} working days left, holidays applied.`,
      from: day(c.targetDate), to: day(c.targetDate), vehicleName: c.vehicleName,
      alert: (c.workingDaysLeft ?? 99) < 30, past: false, href: '/close',
    });
    for (const cond of await conditionsFor(c.cycleId)) {
      if (!cond.dueOn) continue;
      push({
        id: `cond:${cond.conditionId}`, lane: 'close', kind: 'deadline',
        label: cond.label,
        detail: `${cond.status}${cond.ownerName ? ` · ${cond.ownerName}` : ''}${cond.compliance ? ' · compliance condition' : ''}`,
        from: day(cond.dueOn), to: day(cond.dueOn), vehicleName: c.vehicleName,
        alert: cond.overdue, past: cond.status === 'satisfied', href: '/close',
      });
    }
  }

  for (const room of rooms) {
    for (const seat of room.seats) {
      const end = seat.wiredAt ?? now;
      push({
        id: `seat:${seat.seatId}`, lane: 'spv', kind: 'span',
        label: seat.entityName,
        detail: seat.wired
          ? `Invite to wire in ${seat.days} days.`
          : `${seat.stage.replace(/_/g, ' ')} · ${seat.days} days open, and still running.`,
        from: day(seat.invitedAt), to: day(end), vehicleName: room.vehicleName,
        alert: !seat.wired && seat.days > 30, past: seat.wired, href: '/spv',
      });
    }
  }

  for (const a of asks) {
    if (!a.scheduledFor && !a.madeAt) continue;
    const when = a.madeAt ?? a.scheduledFor!;
    push({
      id: `ask:${a.askId}`, lane: 'outreach', kind: 'point',
      label: `${a.entityName}${a.connectorName ? ` via ${a.connectorName}` : ''}`,
      detail: `${a.status}${a.outcome ? ` · ${a.outcome}` : ''} · ${a.ownerName}`,
      from: day(when), to: day(when), vehicleName: a.vehicleName,
      alert: false, past: Boolean(a.madeAt), href: '/asks',
    });
  }

  for (const m of meetings) {
    const when = m.heldOn ?? m.scheduledFor;
    if (!when) continue;
    push({
      id: `meet:${m.meetingId}`, lane: 'meetings', kind: 'point',
      label: `${m.entityName} — ${(m.kind ?? 'meeting').replace(/_/g, ' ')}`,
      detail: m.heldOn ? (m.justification ?? 'Held.') : 'Scheduled. An intention, not a fact.',
      from: day(when), to: day(when), vehicleName: m.vehicleName,
      alert: false, past: Boolean(m.heldOn), href: '/meetings',
    });
  }

  for (const t of tickets) {
    if (!t.expiresAt) continue;
    push({
      id: `ticket:${t.id}`, lane: 'deadlines', kind: 'deadline',
      label: `${t.kind} expires — ${t.subjectLabel}`,
      detail: 'An expired ticket fails closed. The command refuses rather than proceeding.',
      from: day(t.expiresAt), to: day(t.expiresAt), vehicleName: t.vehicleName,
      alert: t.expiresAt.getTime() - now.getTime() < 5 * 86_400_000, past: false,
      href: '/approvals',
    });
  }

  for (const q of questions) {
    if (!q.dueOn || q.status === 'answered') continue;
    push({
      id: `dq:${q.questionId}`, lane: 'deadlines', kind: 'deadline',
      label: `Diligence — ${q.question.slice(0, 54)}${q.question.length > 54 ? '…' : ''}`,
      detail: `${q.ownerName ?? 'unowned'} · ${q.entityName}`,
      from: day(q.dueOn), to: day(q.dueOn), vehicleName: q.vehicleName,
      alert: q.dueOn.getTime() < now.getTime(), past: false, href: '/decisions',
    });
  }

  for (const a of accreditation) {
    if (!a.expiresOn) continue;
    push({
      id: `acc:${a.recordId}`, lane: 'deadlines', kind: 'deadline',
      label: `Accreditation expires — ${a.entityName}`,
      detail: `${a.method.replace(/_/g, ' ')} · ${a.vehicleName}`,
      from: day(a.expiresOn), to: day(a.expiresOn), vehicleName: a.vehicleName,
      alert: a.expiresOn.getTime() - now.getTime() < 30 * 86_400_000, past: false,
      href: '/compliance',
    });
  }

  for (const f of funders) {
    if (!f.invitedOn) continue;
    push({
      id: `grant:${f.funderId}`, lane: 'grants', kind: 'point',
      label: `${f.entityName} — invitation on file`,
      detail: 'Outreach is unblocked from this date and not before it.',
      from: day(f.invitedOn), to: day(f.invitedOn), vehicleName: 'Grants rail',
      alert: false, past: true, href: '/grants',
    });
  }

  return marks.sort((a, b) => a.from.getTime() - b.from.getTime());
}
