'use client';

import type { ReactNode, Ref } from 'react';
import { Glyph } from '@/components/ui/Glyph';

/** Shared table controls for Pipeline, Selection and vehicle Strategy. */
export function TableFilters({ query, onQuery, searchRef, children, placeholder = 'Names, organisations, next steps… /' }: {
  query: string; onQuery: (value: string) => void; searchRef?: Ref<HTMLInputElement>;
  children: ReactNode; placeholder?: string;
}) {
  return <div className="lp-filters">
    <label className="lp-search"><span><Glyph name="search" title="Search" />Search</span>
      <input ref={searchRef} type="search" aria-label="Search LPs" placeholder={placeholder} value={query} onChange={e => onQuery(e.target.value)} />
    </label>
    {children}
  </div>;
}

export function SortHeader<K extends string>({ column, sort, numeric = false, onSort, children }: {
  column: K; sort: { key: K; dir: 1 | -1 }; numeric?: boolean;
  onSort: (sort: { key: K; dir: 1 | -1 }) => void; children: ReactNode;
}) {
  return <th aria-sort={sort.key === column ? sort.dir === 1 ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="thsort" onClick={() => onSort({ key: column, dir: sort.key === column ? sort.dir === 1 ? -1 : 1 : numeric ? -1 : 1 })}>
      {children}{sort.key === column ? sort.dir === -1 ? ' ↓' : ' ↑' : ''}
    </button>
  </th>;
}
