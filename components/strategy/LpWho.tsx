'use client';

import type { ReactNode } from 'react';
import type { PipelineRow } from './pipeline-model';
import { cx, n } from './lp-view';
import u from './lp-units.module.css';

/**
 * Whose row it is (issues 0111, 0112; docs/23), for both LP tables. An organisation's row names its
 * people — its contacts on this pursuit first, in bold, with their roles — and marks anyone who is
 * also an individual LP here, with a jump to that row. An individual's row names their firms as
 * context and marks a firm that has its own LP row here. Names are text, not links: a tap on the row
 * is the row's own action.
 */
export function LpWho({ r, max = 3, onJump, showRoles }: {
  r: PipelineRow; max?: number;
  /** Roles, by default when two or fewer names are shown: more than that, names alone keep the row to a line or two. */
  showRoles?: boolean;
  /** Focus another row in this list: the same person's individual row, or a firm's. */
  onJump?: (pursuitId: string) => void;
}) {
  const jump = (id: string | null | undefined, label: string, title: string): ReactNode => id && onJump
    ? <button type="button" className={u.jump} title={title} onClick={(e) => { e.stopPropagation(); onJump(id); }}>{label}</button>
    : null;
  if (r.isOrg) {
    if (!r.people.length) return null;
    const shown = r.people.slice(0, max), roles = showRoles ?? r.people.length <= 2;
    return (
      <div className={u.who}>
        {shown.map((p) => (
          <span key={p.id}>
            <span className={cx(u.whoName, p.contact && u.contact)} title={p.contact ? 'A contact on this LP' : 'At this organisation'}>{p.name}</span>
            {roles && p.role && <span className={u.whoRole}>({p.role})</span>}
            {jump(p.individual, 'also individual ↓', `${p.name} is also an LP in their own capacity: go to that row`)}
          </span>
        ))}
        {r.people.length > max && <span>and {n(r.people.length - max)} more</span>}
      </div>
    );
  }
  if (!r.firms.length) return null;
  const shown = r.firms.slice(0, max), roles = showRoles ?? r.firms.length <= 2;
  return (
    <div className={u.who}>
      {shown.map((f) => (
        <span key={f.id}>
          <span className={u.whoName}>{f.name}</span>
          {roles && f.role && <span className={u.whoRole}>({f.role})</span>}
          {jump(f.lpRow, 'firm’s row ↑', `${f.name} is an LP here too: go to its row`)}
        </span>
      ))}
      {r.firms.length > max && <span>and {n(r.firms.length - max)} more</span>}
    </div>
  );
}

/** The capacity mark after an individual's name: personal on evidence, or a question for a person. */
export function CapacityTag({ r }: { r: PipelineRow }) {
  if (r.isOrg) return null;
  if (r.lpReview) return <span className={cx(u.tag, u.review)} title={r.lpReview}>firm or personal?</span>;
  if (r.lpCapacity === 'personal') return <span className={cx(u.tag, u.personal)} title="Evidence on file that they invest on their own account">personal</span>;
  return null;
}

/** "3 organisations · 1 individual". */
export const units = (orgs: number, people: number) =>
  `${n(orgs)} ${orgs === 1 ? 'organisation' : 'organisations'} · ${n(people)} ${people === 1 ? 'individual' : 'individuals'}`;
