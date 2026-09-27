/**
 * How every LP list groups its rows (issues 0111, 0112; docs/23-lp-units.md). The LP is the
 * committing unit, and each row is one: an organisation, or a person in their own capacity. So
 * nothing is nested: an organisation is listed once, with its people named inside its row, and
 * individuals are listed apart, never under a pseudo-organisation such as "Personal". A person who
 * invests both ways is named in their firm's row and has an individual row of their own.
 *
 * Read-only: sections neither invent a pursuit nor move a status, evidence or money.
 */
export interface LpSections<T> { organisations: T[]; individuals: T[] }

export function lpSections<T>(rows: T[], isOrg: (row: T) => boolean, compare: (a: T, b: T) => number): LpSections<T> {
  const organisations: T[] = [], individuals: T[] = [];
  for (const row of rows) (isOrg(row) ? organisations : individuals).push(row);
  return { organisations: organisations.sort(compare), individuals: individuals.sort(compare) };
}

/** A list's row as a one-unit group, for lists that page by group (the fit list). */
export interface LpGroup<T> { id: string; section: 'organisation' | 'individual'; people: T[] }
export function unitGroups<T>(rows: T[], id: (row: T) => string, isOrg: (row: T) => boolean, compare: (a: T, b: T) => number): LpGroup<T>[] {
  const { organisations, individuals } = lpSections(rows, isOrg, compare);
  return [
    ...organisations.map(r => ({ id: id(r), section: 'organisation' as const, people: [r] })),
    ...individuals.map(r => ({ id: id(r), section: 'individual' as const, people: [r] })),
  ];
}
