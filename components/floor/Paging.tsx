'use client';

import { useState, type ReactNode } from 'react';

// Presentation limits, not domain thresholds: bound DOM size while keeping every row reachable.
export const DETAIL_PAGE_SIZE = 20;
export function usePage<T>(rows: T[], size = DETAIL_PAGE_SIZE, initialPage = 0) {
  const [index, setIndex] = useState(initialPage);
  const page = Math.min(index, Math.max(0, Math.ceil(rows.length / size) - 1));
  return { rows: rows.slice(page * size, (page + 1) * size), page, size, total: rows.length, setPage: setIndex };
}
export function Pager({ page, size, total, setPage, label = 'records', quiet = false }: {
  page: number; size: number; total: number; setPage: (page: number) => void; label?: string;
  /** Say nothing when everything fits on one page: "1–3 of 3" is noise above three rows. */
  quiet?: boolean;
}) {
  if (quiet && total <= size) return null;
  return <nav className="vizpager" aria-label={`${label} pages`}>
    <span aria-live="polite">{total ? (page * size + 1).toLocaleString('en-US') : 0}–{Math.min((page + 1) * size, total).toLocaleString('en-US')} of {total.toLocaleString('en-US')} {label}</span>
    <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
    <button className="btn" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>Next</button>
  </nav>;
}
export function PagedRows<T>({ rows, children, label, size, quiet }: {
  rows: T[]; children: (rows: T[]) => ReactNode; label: string; size?: number; quiet?: boolean;
}) {
  const paging = usePage(rows, size);
  return <><Pager {...paging} label={label} quiet={quiet} />{children(paging.rows)}</>;
}
