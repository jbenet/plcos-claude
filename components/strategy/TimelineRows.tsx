import { Fragment, type ReactNode } from 'react';
import Link from '@/components/ui/AppLink';

export interface TimelineRow {
  key: string;
  /** What the row is about, for the filter: vehicle slugs, 'unclear', or 'none'. */
  groups: string[];
  /** Built only for the rows shown: an LP can have a thousand. */
  node: () => ReactNode;
}

export interface TimelineOption {
  id: string;
  label: string;
  n: number;
  /** A word for whoever needs it: "counted for this pursuit", "counted for none". */
  hint?: string;
}

/** Rows shown before "more": enough for a year of an active LP, few enough to load fast. */
export const TIMELINE_PAGE = 40;

/**
 * The rows of an LP's timeline, with a filter by fund (N81). Juan, 24 Sep: "Timeline for an LP
 * probably should show all events (w/ clear vehicle labels in the row), but let you filter by Fund
 * (to hide noise). Important to be able to see everything going on with an LP from there, but be
 * able to distinguish it." So everything shows until someone narrows it. The filter and the page
 * size are in the address — `tl` and `tln` — so the server builds only the rows asked for: one LP on
 * the real account has over a thousand, and building them all made a ten-megabyte page.
 */
export function TimelineRows({ rows, options, filter, limit, path }: {
  rows: TimelineRow[]; options: TimelineOption[]; filter: string; limit: number;
  /** The page's own path, for the filter's links. */
  path: string;
}) {
  const known = filter === 'all' || options.some((o) => o.id === filter);
  const active = known ? filter : 'all';
  const matching = active === 'all' ? rows : rows.filter((r) => r.groups.includes(active));
  const shown = matching.slice(0, limit);
  const href = (tl: string, tln?: number) => {
    const q = new URLSearchParams();
    if (tl !== 'all') q.set('tl', tl);
    if (tln) q.set('tln', String(tln));
    const s = q.toString();
    return `${path}${s ? `?${s}` : ''}#timeline`;
  };
  return (
    <>
      {options.length > 1 && (
        <nav className="tl-filter" aria-label="Show the rows about">
          <Link href={href('all')} scroll={false} aria-current={active === 'all' ? 'true' : undefined}>
            All <span className="n">{rows.length}</span>
          </Link>
          {options.map((o) => (
            <Link key={o.id} href={href(active === o.id ? 'all' : o.id)} scroll={false} title={o.hint} aria-current={active === o.id ? 'true' : undefined}>
              {o.label} <span className="n">{o.n}</span>
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 && rows.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Nothing on record about that.</p>}
      {shown.map((r) => <Fragment key={r.key}>{r.node()}</Fragment>)}
      {matching.length > shown.length && (
        <p className="tl-more">
          {shown.length} of {matching.length} shown ·{' '}
          <Link href={href(active, limit + TIMELINE_PAGE * 5)} scroll={false}>{Math.min(TIMELINE_PAGE * 5, matching.length - shown.length)} older</Link>
          {matching.length - shown.length > TIMELINE_PAGE * 5 && <> · <Link href={href(active, matching.length)} scroll={false}>all {matching.length}</Link></>}
        </p>
      )}
    </>
  );
}
