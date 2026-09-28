import type { ReactNode } from 'react';
import type { IssueGroup, LinearIssue } from '@/modules/linear';
import { Avatar, CalendarIcon, PriorityIcon, ProjectIcon, StatusIcon } from './icons';
import s from './linear.module.css';

/**
 * A Linear issue list, laid out the way Linear lays it out: priority, identifier, status, title,
 * then labels, project and due date to the right, and the assignee last. Rows are grouped (by
 * status in Linear's order, or however the caller groups them). Every row opens the issue in
 * Linear in a new tab; nothing here edits it.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

function Due({ due, today }: { due: string; today: string }) {
  const overdue = due < today, isToday = due === today;
  const word = overdue ? 'Overdue' : isToday ? 'Due today' : 'Due';
  return (
    <span className={`${s.chip} ${overdue ? s.overdue : isToday ? s.dueToday : ''}`} title={`${word} · ${dayMonth(due)}`}>
      <CalendarIcon overdue={overdue} />
      <span>{dayMonth(due)}</span>
      <span className="sr-only">{overdue ? ', overdue' : isToday ? ', due today' : ''}</span>
    </span>
  );
}

export function IssueRow({ issue: i, today, date = 'due', assignee = true }: { issue: LinearIssue; today: string; date?: 'due' | 'completed'; assignee?: boolean }) {
  const body = (
    <>
      <span className={s.prio}><PriorityIcon priority={i.priority} /></span>
      <span className={s.ident}>{i.identifier}</span>
      <span className={s.status}><StatusIcon type={i.state.type} name={i.state.name} /></span>
      <span className={s.title}>{i.title}</span>
      <span className={s.meta}>
        {i.labels.length > 0 && (
          <span className={s.labels}>
            {i.labels.slice(0, 2).map((l) => (
              <span key={l.name} className={s.pill}><i style={{ background: l.color ?? 'var(--muted)' }} />{l.name}</span>
            ))}
            {i.labels.length > 2 && <span className={s.pill} title={i.labels.slice(2).map((l) => l.name).join(', ')}>+{i.labels.length - 2}</span>}
          </span>
        )}
        {i.project && <span className={`${s.chip} ${s.project}`} title={i.project.name}><ProjectIcon color={i.project.color} /><span>{i.project.name}</span></span>}
        {date === 'due' && i.dueDate && i.state.type !== 'completed' && i.state.type !== 'canceled' && <Due due={i.dueDate} today={today} />}
        {date === 'completed' && i.completedAt && (
          <span className={s.chip} title={`Done ${i.completedAt.toISOString().slice(0, 10)}`}>{dayMonth(i.completedAt.toISOString().slice(0, 10))}</span>
        )}
      </span>
      {assignee && <span className={s.av}><Avatar person={i.assignee} /></span>}
    </>
  );
  if (!i.url) return <div className={s.row} aria-label={`${i.identifier} ${i.title}`}>{body}</div>;
  return (
    <a className={s.row} href={i.url} target="_blank" rel="noopener noreferrer">
      {body}
      <span className="sr-only"> (opens in Linear, in a new tab)</span>
    </a>
  );
}

function GroupIcon({ g, today }: { g: IssueGroup; today: string }) {
  if (g.icon.kind === 'state') return <StatusIcon type={g.icon.type} name={g.title} />;
  if (g.icon.kind === 'person') return <Avatar person={g.icon.person} size={16} />;
  const late = g.issues.some((i) => i.dueDate && i.dueDate < today);
  return <span className={late ? s.overdueInk : s.mutedInk}><CalendarIcon overdue={late} size={13} /></span>;
}

export function IssueList({ groups, issues, today, date, assignee, empty, moreHref, moreLabel }: {
  groups?: IssueGroup[]; issues?: LinearIssue[]; today: string; date?: 'due' | 'completed'; assignee?: boolean;
  empty?: ReactNode; moreHref?: string | null; moreLabel?: string;
}) {
  const flat = issues ?? [];
  const count = groups ? groups.reduce((n, g) => n + g.issues.length, 0) : flat.length;
  if (count === 0 && !(groups ?? []).some((g) => g.more)) return <div className={s.empty}>{empty ?? 'No issues.'}</div>;
  return (
    <div className={s.list}>
      {groups
        ? groups.map((g) => (
            <section key={g.key} aria-label={`${g.title}, ${g.issues.length + (g.more ?? 0)}`}>
              <div className={s.ghead}>
                <GroupIcon g={g} today={today} />
                <b>{g.title}</b>
                <span className={s.count}>{g.issues.length + (g.more ?? 0)}</span>
              </div>
              {g.issues.map((i) => <IssueRow key={i.id} issue={i} today={today} date={date} assignee={assignee} />)}
              {Boolean(g.more) && (
                moreHref
                  ? <a className={s.more} href={moreHref} target="_blank" rel="noopener noreferrer">{g.more} more in Linear ↗</a>
                  : <div className={s.more}>{g.more} more in Linear</div>
              )}
            </section>
          ))
        : flat.map((i) => <IssueRow key={i.id} issue={i} today={today} date={date} assignee={assignee} />)}
      {moreHref && moreLabel && <a className={s.more} href={moreHref} target="_blank" rel="noopener noreferrer">{moreLabel} ↗</a>}
    </div>
  );
}
