'use client';

import { useState, type ReactNode } from 'react';

// Presentation limits, not domain thresholds: bound DOM size while keeping every row reachable.
export const DETAIL_PAGE_SIZE = 20;
export function usePage<T>(rows: T[], size = DETAIL_PAGE_SIZE, initialPage = 0) {
  const [index, setIndex] = useState(initialPage);
  const page = Math.min(index, Math.max(0, Math.ceil(rows.length / size) - 1));
  return { rows: rows.slice(page * size, (page + 1) * size), page, size, total: rows.length, setPage: setIndex };
}
export function Pager({ page, size, total, setPage, label = 'records' }: {
  page: number; size: number; total: number; setPage: (page: number) => void; label?: string;
}) {
  return <nav className="vizpager" aria-label={`${label} pages`}>
    <span aria-live="polite">{total ? page * size + 1 : 0}–{Math.min((page + 1) * size, total)} of {total} {label}</span>
    <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
    <button className="btn" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>Next</button>
  </nav>;
}
export function PagedRows<T>({ rows, children, label, size }: {
  rows: T[]; children: (rows: T[]) => ReactNode; label: string; size?: number;
}) {
  const paging = usePage(rows, size);
  return <><Pager {...paging} label={label} />{children(paging.rows)}</>;
}
